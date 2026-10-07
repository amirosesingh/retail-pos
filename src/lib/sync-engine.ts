import { externalClientSnapshot, supabaseExternal } from "@/integrations/supabase/external-client";
import { logSync } from "./sync-log";
import { hasRequiredPlatformConfig } from "./platform-config-ready";
import { hasSignedInIdentity } from "./session-presence";
import { createSerialChannelReplacer } from "./realtime-channel-replacer";

import { tableSyncAllowed } from "./sync-policy";
import { canRelay, hasStaffSession, relayOp } from "@/core/api/sync-relay";
import { preferRelay } from "./pos-auth-route";
import {
  effectiveDatabaseMode,
  isConnectionError,
  subscribeDatabaseMode,
} from "@/core/local-db/db-mode";
import {
  lastSuccessfulPull,
  setLastSuccessfulPull,
  lastTablePull,
  setLastTablePull,
  setSyncState,
  syncState,
} from "./sync-status";
import { recordSync } from "./sync-audit";
import { activeBranchId } from "./active-branch";
import { beginSyncRun, endSyncRun, markTableSync } from "./sync-progress";

/**
 * The central project rejecting this device's keys (HTTP 401, "Invalid
 * API key", an expired JWT). Never a row fault: queued writes keep their
 * place, sync parks, and the badge points at Settings → Database & Cloud
 * Connection. Saving fresh keys clears the flag and wakes the engine.
 */
const CREDENTIAL_ERROR_RE = /invalid api ?key|bad jwt|jwt expired|invalid token/i;

function isCredentialError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: unknown; message?: unknown };
  const status = Number(e.status ?? 0);
  // 403 is an authorised caller being denied a particular action (RLS,
  // branch, or role). It must remain a row-level sync error, not falsely park
  // every table as though the API key were invalid.
  if (status === 401) return true;
  return CREDENTIAL_ERROR_RE.test(String(e.message ?? ""));
}

function noteCredentialsInvalid(detail: string) {
  setSyncState({
    credentialsInvalid: true,
    lastError:
      "Sync paused — the central database rejected this device's keys. " +
      "Update them in Settings → Database & Cloud Connection.",
  });
  recordSync({ direction: "system", entity: "credentials", status: "failed", error: detail });
}

import { localDb, type LocalSyncStatus } from "@/core/local-db/local-db";
import {
  checkHealth,
  subscribeConnectivity,
  type Connectivity,
} from "@/core/activation/connection-health";
import { subscribeSyncConfig, syncConfig } from "./sync-config";
import {
  acknowledgeBrowserBatch,
  browserPendingCount,
  failBrowserBatch,
  pendingBrowserBatches,
} from "./browser-sync-outbox";
import { withRelativeStock } from "./sync-stock";
import { applyStockDeltaBatch } from "./stock-recovery";
import { TOMBSTONE_TABLES } from "./tombstones";
import { isOnline, isOnlineSyncEnabled, markSynced, type SyncOp } from "./sync-outbox";

/** Columns some older databases are missing; dropped on a schema-cache error. */
const OPTIONAL_COLUMNS: Record<string, string[]> = {
  pos_settings: [
    "company_name",
    "tax_number",
    "reg_number",
    "phone",
    "website",
    "fonts",
    "custom_lines",
    "qr",
    "whatsapp_settings",
    "ui_visibility",
  ],
};

/**
 * PostgREST reports unknown optional settings columns through its schema cache.
 * Pull the column name out so the row can be retried without it.
 */
const missingColumn = (message: string): string | null =>
  /Could not find the '([^']+)' column/i.exec(message)?.[1] ?? null;

const strip = (rows: Record<string, unknown>[], columns: string[]) =>
  rows.map((r) => {
    const copy = { ...r };
    for (const c of columns) delete copy[c];
    return copy;
  });

type PostgrestError = { message: string; code?: string };

/** True when the database refused the write because of who the caller is. */
const isPermissionError = (error: PostgrestError) =>
  error.code === "42501" ||
  error.code === "PGRST301" ||
  /row-level security|permission denied|jwt/i.test(error.message);

/**
 * Tables the central database refused for this account in this session.
 *
 * Once a direct write is refused there is no point attempting it again — the
 * answer will not change until the account is signed in again. Remembering the
 * refusal sends later writes for that table straight through the server relay,
 * which keeps the console clean and saves a round trip. Accounts that are
 * allowed keep the faster direct path.
 */
const refusedTables = new Set<string>();

/**
 * Wording for a server that has lost the central database key. It is a server
 * setup task, not something the person at the till can fix.
 */
const KEY_MISSING =
  "Syncing paused — an administrator must re-save the central database key on the server. " +
  "Your work is saved on this device and will upload automatically.";

/** Relay the operation and report the outcome in plain language. */
async function viaRelay(context: string, op: SyncOp): Promise<{ ok: boolean; error?: string }> {
  const relayed = await relayOp(op);
  // The server relay cannot write without its key. Anyone signed in with a real
  // staff account still can, using their own session, so try that before giving
  // up and leaving the change in the queue.
  if (!relayed.ok && relayed.code === "NO_SERVICE_KEY") {
    if (hasStaffSession()) {
      const direct = await execute(op);
      if (!direct.error) {
        logSync("push", op.table, true, `${context} (direct — server key missing)`);
        return { ok: true };
      }
      logSync("push", op.table, false, `${context}: ${describeError(op.table, direct.error)}`);
      return { ok: false, error: describeError(op.table, direct.error) };
    }
    logSync("push", op.table, false, `${context}: ${KEY_MISSING}`);
    return { ok: false, error: KEY_MISSING };
  }
  logSync(
    "push",
    op.table,
    relayed.ok,
    relayed.ok
      ? `${context} (via server)`
      : `${context}: ${relayed.error ?? "the server could not save this change"}`,
  );
  return relayed;
}

/** Plain-language message for a failed push. */
const describeError = (table: string, error: PostgrestError) => {
  if (error.code === "PGRST205") {
    return `The "${table}" table is missing on the central database — an administrator needs to run the database setup script once.`;
  }
  if (isPermissionError(error)) {
    if (!hasStaffSession() && !canRelay()) {
      return `Not signed in to the central database, so "${table}" could not be saved. Sign in again (or activate this till) and the queued changes will go through.`;
    }
    if (/permission denied for function/i.test(error.message)) {
      return `The central database refused a permission check while saving "${table}" (${error.message}). An administrator needs to run supabase/schema.sql once.`;
    }
    return `The central database's access rules refused to save "${table}" for this account (${error.message}). Check the account's branch assignment and role.`;
  }
  return error.message;
};

/** Table names are dynamic here, so the generated row types don't apply. */
type LooseQuery = {
  insert: (rows: unknown) => PromiseLike<QueryResult>;
  upsert: (rows: unknown, opts: { onConflict: string }) => PromiseLike<QueryResult>;
  update: (values: unknown) => LooseFilter;
  delete: () => LooseFilter;
};
type LooseFilter = PromiseLike<QueryResult> & { eq: (col: string, val: unknown) => LooseFilter };
type QueryResult = { error: { message: string; code?: string } | null };

const from = (table: string) =>
  (supabaseExternal as unknown as { from: (t: string) => LooseQuery }).from(table);

async function execute(op: SyncOp): Promise<QueryResult> {
  switch (op.kind) {
    case "insert": {
      // Replaying a queued insert must never create a second copy: when every
      // row carries its own id, that id is the idempotency key, so a retry on
      // a flaky link lands on the same row instead of duplicating a sale or a
      // shift.
      const keyed =
        op.rows.length > 0 &&
        op.rows.every(
          (r) => typeof (r as { id?: unknown }).id === "string" && (r as { id: string }).id,
        );
      return keyed
        ? from(op.table).upsert(op.rows, { onConflict: "id" })
        : from(op.table).insert(op.rows);
    }
    case "upsert":
      return from(op.table).upsert(op.rows, { onConflict: op.onConflict ?? "id" });
    case "update": {
      let q = from(op.table).update(op.values);
      for (const [k, v] of Object.entries(op.match)) q = q.eq(k, v);
      return q;
    }
    case "delete": {
      // Reference tables are stamped, not erased: an absent row cannot travel
      // down a delta pull, so every till would keep its stale copy forever.
      if (TOMBSTONE_TABLES.has(op.table)) {
        const stamp = new Date().toISOString();
        let q = from(op.table).update({ deleted_at: stamp, updated_at: stamp });
        for (const [k, v] of Object.entries(op.match)) q = q.eq(k, v);
        return q;
      }
      let q = from(op.table).delete();
      for (const [k, v] of Object.entries(op.match)) q = q.eq(k, v);
      return q;
    }
    case "rpc": {
      // The database works the change out itself; we only send identifiers.
      const client = supabaseExternal as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<QueryResult>;
      };
      return client.rpc(op.fn, op.args);
    }
  }
}

/**
 * Live write for the Android build: send the operation to the backend now and
 * report the result. Nothing is stored or retried on the device.
 */
export async function runOpLive(context: string, op: SyncOp): Promise<void> {
  // Shift rows intentionally expose only a safe SELECT projection, while a
  // generic PostgREST upsert requires table-wide SELECT. Day-end summaries
  // also need to work for PIN sessions that have no Supabase Auth token. Both
  // already have a branch-scoped server relay, so avoid a guaranteed 403/401
  // direct attempt before using it.
  if (
    (op.table === "stores" ||
      op.table === "shifts" ||
      op.table === "shift_notifications" ||
      refusedTables.has(op.table) ||
      preferRelay()) &&
    canRelay()
  ) {
    const relayed = await viaRelay(context, op);
    if (relayed.ok) {
      await broadcastSettingsChange(op.table);
      return;
    }
    throw new Error(relayed.error ?? "The server could not save this change");
  }

  let res = await execute(op);
  // Older databases are missing newer columns. Drop whichever column the
  // error names and retry until the core row saves, exactly like the queued
  // path does, so a direct (online-first) write never fails on schema drift.
  if (op.kind === "upsert" || op.kind === "insert") {
    const dropped: string[] = [];
    let guard = 0;
    while (res.error?.code === "PGRST204" && guard++ < 12) {
      const named = missingColumn(res.error.message);
      const next = named ? [named] : (OPTIONAL_COLUMNS[op.table] ?? []);
      if (!next.length || next.every((c) => dropped.includes(c))) break;
      dropped.push(...next);
      res = await execute({ ...op, rows: strip(op.rows, dropped) } as SyncOp);
    }
  }
  if (res.error) {
    if (isPermissionError(res.error) && canRelay()) {
      refusedTables.add(op.table);
      const relayed = await viaRelay(context, op);
      if (relayed.ok) {
        await broadcastSettingsChange(op.table);
        return;
      }
      throw new Error(
        relayed.error
          ? `The central database refused this change and the server relay could not save it either: ${relayed.error}`
          : "The server could not save this change",
      );
    }
    const message = describeError(op.table, res.error);
    logSync("push", op.table, false, `${context}: ${message}`);
    throw new Error(message);
  }
  logSync("push", op.table, true, context);
  await broadcastSettingsChange(op.table);
}

export async function drainOutbox(): Promise<{ pushed: number; failed: number }> {
  if (localDb()) return { pushed: 0, failed: 0 };
  let pushed = 0;
  let failed = 0;
  for (const batch of await pendingBrowserBatches(25)) {
    try {
      const cloud = withRelativeStock(batch.ops);
      for (const op of cloud.ops) await runOpLive(batch.context, op);
      if (cloud.deltas.length) await applyStockDeltaBatch(cloud.deltas);
      await acknowledgeBrowserBatch(batch.id);
      pushed += batch.ops.length;
    } catch (error) {
      failed += 1;
      await failBrowserBatch(batch.id, error);
      if (isConnectionError(error)) break;
    }
  }
  setSyncState({ pending: browserPendingCount() });
  if (pushed) markSynced();
  return { pushed, failed };
}

/* ---------------------------- downward sync ---------------------------- */

/** Tables the central database owns; a till only ever reads these back. */
const PULL_TABLES = [
  "products",
  "members",
  "membership_tiers",
  "promotions",
  "stores",
  "suppliers",
  "bookings",
  "stock_transfers",
  "held_orders",
] as const;

let pulling = false;

/**
 * Which timestamp column each table actually carries. Probed once, then
 * remembered, so a table without `updated_at` doesn't fire a failing request
 * (HTTP 400) on every polling cycle.
 */
const stampColumn = new Map<string, "updated_at" | "created_at">();

async function readChangedPage(
  client: ReturnType<typeof externalClientSnapshot>,
  table: (typeof PULL_TABLES)[number],
  since: string,
  through: string,
  from: number,
) {
  const ask = (column: string) =>
    client
      .from(table)
      .select(`id,${column}`)
      .gt(column, since)
      .lte(column, through)
      .order(column)
      .order("id")
      .range(from, from + 499);

  const known = stampColumn.get(table);
  if (known) return { ...(await ask(known)), column: known };

  let res = await ask("updated_at");
  if (!res.error) {
    stampColumn.set(table, "updated_at");
    return { ...res, column: "updated_at" as const };
  }
  // A denied request or connection failure says nothing about the schema.
  // Only retry when Postgres/PostgREST actually reports a missing column.
  if (res.error.code !== "42703" && res.error.code !== "PGRST204") {
    return { ...res, column: "updated_at" as const };
  }
  res = await ask("created_at");
  if (!res.error) stampColumn.set(table, "created_at");
  return { ...res, column: "created_at" as const };
}

/**
 * Bring down everything changed centrally since the last clean pull, so a
 * price edited at head office reaches this till without a restart.
 */
export async function pullDelta(): Promise<{ merged: number }> {
  if (pulling || !isOnline() || !isOnlineSyncEnabled()) return { merged: 0 };
  // This is a direct Data API change probe, not the terminal's durable pull.
  // PIN credentials do not authorize SELECT on business tables. Electron's
  // worker owns its pull; only cloud staff sessions can run this probe.
  if (localDb() || !hasStaffSession()) return { merged: 0 };
  // Local storage can briefly retain a revoked session while GoTrue is
  // finishing its sign-out/refresh callback. Prove the user once before the
  // table loop; otherwise every protected table repeats the same anonymous
  // 401/42501 failure and floods the database log.
  const client = externalClientSnapshot();
  let verified: Awaited<ReturnType<typeof client.auth.getUser>>;
  let session: Awaited<ReturnType<typeof client.auth.getSession>>;
  try {
    // Capture one concrete access token, then prove that exact token. Running
    // getUser/getSession in parallel can straddle a refresh-token rotation:
    // getUser succeeds with the old token while the following table requests
    // leave as anon, producing one 42501 error for every pull table.
    session = await client.auth.getSession();
    const accessToken = session.data.session?.access_token;
    if (session.error || !accessToken) return { merged: 0 };
    verified = await client.auth.getUser(accessToken);
  } catch {
    // A rejected promise is a connectivity failure, not proof that the token
    // is invalid. Keep the signed-in session and retry on the next sync pass.
    return { merged: 0 };
  }
  if (
    verified.error ||
    !verified.data.user ||
    session.error ||
    !session.data.session?.access_token
  ) {
    const { isTokenRejection, notifySessionExpired } = await import("./session-expiry");
    const rejected = verified.error
      ? isTokenRejection(
          Number((verified.error as { status?: unknown }).status ?? 0),
          verified.error.message ?? "",
        )
      : !verified.data.user;
    if (rejected) notifySessionExpired();
    return { merged: 0 };
  }
  // Authentication alone is not POS authorization. A customer member also
  // has a valid Supabase user, but may never probe staff-only business tables.
  // Only ask for the staff profile after the JWT itself has been proven, so an
  // expired token cannot create one extra rejected RPC in the database logs.
  const staff = await client.rpc("current_app_user");
  const staffProfile = (staff.data?.[0] ?? null) as { is_active?: boolean } | null;
  if (staff.error || !staffProfile?.is_active) return { merged: 0 };
  // Keys rejected: stay parked until fresh ones are saved.
  if (syncState().credentialsInvalid) return { merged: 0 };
  pulling = true;
  const fallbackSince = lastSuccessfulPull() ?? "1970-01-01T00:00:00.000Z";
  const startedAt = new Date().toISOString();
  let changed = 0;
  const clean: string[] = [];
  try {
    beginSyncRun(PULL_TABLES.filter((table) => tableSyncAllowed(table)));
    for (const table of PULL_TABLES) {
      if (!tableSyncAllowed(table)) continue;
      markTableSync(table, "syncing", "Checking for changes…");
      // Each table resumes from its own mark, so one failing table never
      // drags the rest back or hides their changes.
      const since = lastTablePull(table) ?? fallbackSince;
      let tableChanged = 0;
      let offset = 0;
      let tableError: { message: string; status?: number } | null = null;
      for (;;) {
        const page = await readChangedPage(client, table, since, startedAt, offset);
        if (page.error) {
          tableError = page.error;
          break;
        }
        const rows = (page.data ?? []) as unknown as Array<Record<string, unknown>>;
        for (const row of rows) {
          const entityId = String(row.id ?? "").trim() || null;
          announceDataChange({ reason: `pull:${table}`, table, storeId: null, entityId });
        }
        tableChanged += rows.length;
        if (rows.length < 500) break;
        offset += rows.length;
      }
      if (tableError) {
        if (isCredentialError(tableError)) {
          noteCredentialsInvalid(tableError.message);
          return { merged: changed };
        }
        logSync("pull", table, false, tableError.message);
        recordSync({
          direction: "pull",
          entity: table,
          status: "failed",
          error: tableError.message,
        });
        markTableSync(
          table,
          /does not exist|not found|schema cache/i.test(tableError.message) ? "missing" : "failed",
          tableError.message,
        );
        continue;
      }
      clean.push(table);
      if (!tableChanged) {
        markTableSync(table, "synced", "Already up to date");
        continue;
      }
      changed += tableChanged;
      logSync("pull", table, true, `${tableChanged} row(s) changed centrally`);
      recordSync({ direction: "pull", entity: table, records: tableChanged, status: "success" });
      markTableSync(table, "synced", `${tableChanged} row(s) updated`);
    }
    // Marks only advance for tables that answered and were merged cleanly.
    for (const table of clean) setLastTablePull(table, startedAt);
    setLastSuccessfulPull(startedAt);
    // A clean pull proves the saved keys work — clear any earlier rejection.
    setSyncState({ lastSyncAt: startedAt, credentialsInvalid: false });
    endSyncRun();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (isCredentialError(e) || CREDENTIAL_ERROR_RE.test(message)) noteCredentialsInvalid(message);
    setSyncState({ lastError: message });
    recordSync({ direction: "pull", entity: "catalogue", status: "failed", error: message });
    endSyncRun(message);
  } finally {
    pulling = false;
  }
  return { merged: changed };
}

let started = false;

/**
 * One sync at a time, and never on a flapping network.
 *
 * `runExclusive` is the mutex: a cycle that is already running absorbs any
 * request that arrives while it works, so a wobbling connection can't stack
 * up overlapping pushes. `wake` is debounced by five seconds for the same
 * reason — an access point that drops and returns three times in a row
 * produces exactly one catch-up.
 */
let cycleRunning = false;
let cycleQueued = false;

async function runCycle() {
  await drainOutbox();
  await pullDelta();
  await checkHealth(true);
}

export async function runExclusive(reason: string = "timer"): Promise<void> {
  // Electron has one sync owner: the main-process worker. The renderer may
  // request a cycle and display its status, but it never runs a competing
  // cloud push/pull pipeline of its own.
  const desktopBridge = localDb();
  if (desktopBridge) {
    if (cycleRunning) {
      cycleQueued = true;
      return;
    }
    cycleRunning = true;
    setSyncState({ phase: "syncing" });
    try {
      const cycle = desktopBridge.sync?.auto
        ? await desktopBridge.sync.auto()
        : desktopBridge.syncNow
          ? await desktopBridge.syncNow()
          : await desktopBridge.status();
      setSyncState({
        phase: cycle?.phase === "pushing" || cycle?.phase === "pulling" ? "syncing" : "idle",
        pending: cycle?.businessBatches?.pending ?? cycle?.pending ?? cycle?.queue?.length ?? 0,
        lastSyncAt: cycle?.lastPushAt ?? cycle?.lastPullAt ?? undefined,
        credentialsInvalid: cycle?.credentialsInvalid ?? false,
        lastError:
          cycle?.error === "central-config" || cycle?.lastBusinessPush?.reason === "central-config"
            ? null
            : (cycle?.error ?? cycle?.lastError ?? null),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSyncState({ phase: "idle", lastError: message });
      recordSync({ direction: "system", entity: reason, status: "failed", error: message });
    } finally {
      cycleRunning = false;
      if (cycleQueued) {
        cycleQueued = false;
        void runExclusive("queued");
      }
    }
    return;
  }

  // An unconfigured terminal has no central database to talk to. That is a
  // normal state, not a failure: no request is attempted and nothing is
  // inherited from the web deployment.
  const readiness = await hasRequiredPlatformConfig();
  if (!readiness.ready) return;
  // Nobody signed in means nothing this device sends would be accepted: the
  // central tables are protected per user. Staying quiet on the sign-in screen
  // is correct, and it keeps rejected requests out of the logs.
  if (!hasSignedInIdentity()) return;

  if (cycleRunning) {
    cycleQueued = true;
    return;
  }
  cycleRunning = true;
  setSyncState({ phase: "syncing" });

  try {
    await runCycle();
    setSyncState({ phase: isOnline() ? "idle" : "offline" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setSyncState({ phase: "idle", lastError: message });
    recordSync({ direction: "system", entity: reason, status: "failed", error: message });
  } finally {
    cycleRunning = false;
    if (cycleQueued) {
      cycleQueued = false;
      void runExclusive("queued");
    }
  }
}

/** True while a sync cycle holds the mutex. */
export const syncBusy = () => cycleRunning;

/**
 * Tables whose changes must reach this shop's own database at once rather
 * than on the next timer tick: staff accounts, roles and settings.
 */
const LIVE_SETTINGS_TABLES = [
  "integration_settings",
  "pos_settings",
  "pos_store_settings",
  "secure_settings",
  "settings_overrides",
  "settings_locks",
  "settings_scoped",
  "authorization_actions",
] as const;

/**
 * Control-plane changes contain no row data in the broadcast; they only wake
 * the authenticated, scoped pull. Include staff identity tables so a global
 * account or PIN change reaches every activated till instead of depending on
 * a branch-filtered Postgres Changes event or the next timer tick.
 */
const LIVE_CONTROL_TABLES = [
  ...LIVE_SETTINGS_TABLES,
  "app_users",
  "cashiers",
  "staff_roles",
  "user_roles",
] as const;

const ORGANIZATION_LIVE_TABLES = ["staff_roles", "stores", "members", "promotions"] as const;

/**
 * Realtime is only a wake-up hint; the durable scoped pull remains the source
 * of truth. Keep every operational subscription at the active branch so a
 * till never receives another branch's change payload merely to discard it.
 * Child rows without a branch column are deliberately omitted: their scoped
 * parent event or the reconciliation timer wakes the durable pull.
 */
const BRANCH_LIVE_TABLES = [
  { table: "app_users", column: "store_id" },
  { table: "sales", column: "store_id" },
  { table: "sale_items", column: "branch_id" },
  { table: "payment_transactions", column: "store_id" },
  { table: "products", column: "owner_store_id" },
  { table: "purchase_orders", column: "store_id" },
  // Approval rows are cloud-owned while online. Their Realtime event wakes
  // the desktop worker so SQL Server becomes a background mirror, never a
  // prerequisite for submitting or deciding the request.
  { table: "authorization_requests", column: "store_id" },
] as const;

export type LiveChange = {
  reason: string;
  table: string;
  storeId: string | null;
  entityId?: string | null;
};

/**
 * Listeners told when centrally controlled settings changed, so the running
 * POS re-reads its rules instead of waiting for a screen to be reopened.
 * This reuses the one live channel below — no second subscription.
 */
const settingsListeners = new Set<(change: LiveChange) => void>();
const salesListeners = new Set<(change: LiveChange) => void>();
const dataListeners = new Set<(change: LiveChange) => void>();
let settingsLiveChannel: ReturnType<typeof supabaseExternal.channel> | null = null;
const SETTINGS_BROADCAST_TIMEOUT_MS = 1_500;

/**
 * Wake connected tills after a browser has committed a settings change.
 *
 * Settings rows are intentionally invisible to anonymous Realtime clients,
 * including an Electron cashier that authenticates through the signed relay.
 * This public broadcast contains no setting value or identity; it is only a
 * hint to run the existing authenticated pull. A forged hint can therefore
 * cause at most a harmless, debounced sync and can never change local data.
 */
export async function broadcastSettingsChange(table: string): Promise<boolean> {
  if (localDb()) return false;
  if (!(LIVE_CONTROL_TABLES as readonly string[]).includes(table)) return false;
  const channel = settingsLiveChannel;
  if (!channel) return false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      channel.send({
        type: "broadcast",
        event: "settings_changed",
        payload: { table },
      }),
      new Promise<"timed_out">((resolve) => {
        timeout = setTimeout(() => resolve("timed_out"), SETTINGS_BROADCAST_TIMEOUT_MS);
      }),
    ]);
    return outcome === "ok";
  } catch {
    // Realtime is an acceleration path. The normal sync poll remains the
    // durable fallback when the socket is reconnecting.
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function subscribeSettingsChange(fn: (change: LiveChange) => void): () => void {
  settingsListeners.add(fn);
  return () => settingsListeners.delete(fn);
}

export function subscribeSalesChange(fn: (change: LiveChange) => void): () => void {
  salesListeners.add(fn);
  return () => salesListeners.delete(fn);
}

/** Subscribe to targeted catalogue/member/purchasing invalidations. */
export function subscribeDataChange(fn: (change: LiveChange) => void): () => void {
  dataListeners.add(fn);
  return () => dataListeners.delete(fn);
}

function announceSettingsChange(
  reason: string,
  storeId: string | null = null,
  table = "pos_store_settings",
): void {
  for (const fn of settingsListeners) {
    try {
      fn({ reason, table, storeId });
    } catch {
      /* one bad listener must not stop the others */
    }
  }
}

function announceSalesChange(table: string, storeId: string | null): void {
  for (const fn of salesListeners) {
    try {
      fn({ reason: `live:${table}`, table, storeId });
    } catch {
      /* one bad listener must not stop the others */
    }
  }
}

function announceDataChange(change: LiveChange): void {
  for (const fn of dataListeners) {
    try {
      fn(change);
    } catch {
      /* one bad listener must not stop the others */
    }
  }
}

/** Refresh the offline staff roster so a PIN sign-in works without the cloud. */
async function refreshStaffMirror(): Promise<void> {
  // PIN sessions deliberately have no Data API JWT. Their roster is refreshed
  // through the activated-terminal endpoint during sign-in instead.
  if (!hasStaffSession()) return;
  const { data, error } = await supabaseExternal.rpc("list_app_users");
  if (error) throw new Error(error.message);
  const { cacheStaffRoster } = await import("@/core/local-db/local-staff");
  await cacheStaffRoster((data ?? []) as Record<string, unknown>[]);
}

const RETRY_DELAYS_MS = [2000, 10000, 30000];
let liveTimer: number | undefined;
const pendingLiveChanges = new Map<string, LiveChange>();

function flushLiveChanges(): void {
  liveTimer = undefined;
  const changes = [...pendingLiveChanges.values()];
  pendingLiveChanges.clear();
  // Embedded terminals need a durable offline mirror. Online-only clients can
  // consume the changed records directly without reloading the whole dataset.
  if (localDb())
    void syncNow(`live:${[...new Set(changes.map((change) => change.table))].join(",")}`);
  for (const change of changes) {
    if ((LIVE_SETTINGS_TABLES as readonly string[]).includes(change.table)) {
      announceSettingsChange(change.reason, change.storeId, change.table);
    }
    if (["sales", "sale_items", "payment_transactions"].includes(change.table)) {
      announceSalesChange(change.table, change.storeId);
    }
    if (
      [
        "products",
        "product_barcodes",
        "members",
        "promotions",
        "purchase_orders",
        "purchase_order_items",
      ].includes(change.table)
    ) {
      announceDataChange(change);
    }
  }
}

function queueLiveChange(change: LiveChange): void {
  pendingLiveChanges.set(
    `${change.table}:${change.storeId ?? ""}:${change.entityId ?? ""}`,
    change,
  );
  if (liveTimer) window.clearTimeout(liveTimer);
  // One catch-up for a burst of related edits.
  liveTimer = window.setTimeout(flushLiveChanges, 400);
}

/**
 * Push a just-made change straight through instead of waiting for the timer.
 * Failures are retried with growing gaps and every attempt is logged, so a
 * record that never reaches the shop database is visible rather than silent.
 */
export async function syncNow(reason: string, attempt = 0): Promise<void> {
  try {
    await runExclusive(reason);
    const completed = syncState();
    if (completed.credentialsInvalid) throw new Error("Cloud credentials were rejected");
    if (completed.lastError) throw new Error(completed.lastError);
    await refreshStaffMirror();
    logSync("push", reason, true, "sent to this shop's database");
    recordSync({ direction: "push", entity: reason, status: "success" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logSync("push", reason, false, message);
    recordSync({ direction: "push", entity: reason, status: "failed", error: message });
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined || typeof window === "undefined") return;
    window.setTimeout(() => void syncNow(reason, attempt + 1), delay);
  }
}

const NETWORK_DEBOUNCE_MS = 250;

/** Start the background sync loop (called once from the app shell). */
export function startSyncEngine() {
  if (started || typeof window === "undefined") return () => {};
  started = true;
  // Push queued work first, then bring central changes down, then converge the
  // terminal's own database in both directions — one cycle at a time.
  const desktopBridge = localDb();
  let lastDesktopPullAt: string | null | undefined;
  const applyDesktopStatus = (status: LocalSyncStatus) => {
    const completedNewPull =
      lastDesktopPullAt !== undefined &&
      Boolean(status.lastPullAt) &&
      status.lastPullAt !== lastDesktopPullAt;
    lastDesktopPullAt = status.lastPullAt ?? null;
    const batches = status.businessBatches;
    const failedRow = batches?.rows?.find((row) => row.status !== "pending");
    const centralPending =
      status.lastBusinessPush?.reason === "central-config" ||
      status.error === "central-config" ||
      failedRow?.error_message === "central-config";
    setSyncState({
      phase: status.phase === "pushing" || status.phase === "pulling" ? "syncing" : "idle",
      pending: batches
        ? batches.pending + batches.failed
        : (status.pending ?? status.queue?.length ?? 0),
      lastSyncAt: status.lastPushAt ?? status.lastPullAt ?? null,
      lastError: centralPending
        ? null
        : (status.error ?? status.lastError ?? failedRow?.error_message ?? null),
      credentialsInvalid: status.credentialsInvalid ?? false,
      cloudConfigured: status.cloudConfigured ?? null,
    });
    // The Electron worker has now committed its cloud pull into SQL Server.
    // Re-read cached rules/settings only after that commit, so the running
    // till cannot keep using the value that preceded the sync cycle.
    if (completedNewPull) announceSettingsChange("desktop:pull-complete");
  };
  const offDesktopStatus =
    desktopBridge?.sync?.subscribe?.(applyDesktopStatus) ??
    desktopBridge?.onStatus?.(applyDesktopStatus);
  if (desktopBridge) {
    const status = desktopBridge.sync?.getStatus?.() ?? desktopBridge.status();
    void status.then(applyDesktopStatus).catch(() => {});
  }
  const tick = () => {
    if (!desktopBridge) void runExclusive("timer");
  };
  // Web/Android retain the renderer timer. Electron already has the worker's
  // own interval, so the renderer only wakes it for explicit/live/reconnect
  // events and never installs a second periodic sync loop.
  let timer = desktopBridge ? 0 : window.setInterval(tick, syncConfig().intervalMs);
  let appliedInterval = syncConfig().intervalMs;
  const offConfig = subscribeSyncConfig(() => {
    const cfg = syncConfig();
    if (cfg.intervalMs !== appliedInterval) {
      appliedInterval = cfg.intervalMs;
      if (!desktopBridge) {
        window.clearInterval(timer);
        timer = window.setInterval(tick, appliedInterval);
      }
    }
  });
  let debounce: number | undefined;
  // A short debounce collapses duplicate browser/network events without
  // leaving completed till work waiting behind the periodic safety poll.
  const wake = () => {
    if (debounce) window.clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      debounce = undefined;
      if (!isOnline()) return;
      void runExclusive("network");
    }, NETWORK_DEBOUNCE_MS);
  };
  const sleep = () => {
    if (debounce) window.clearTimeout(debounce);
    debounce = undefined;
    setSyncState({ phase: "offline" });
  };
  // Flipping the switch back to online catches up immediately instead of
  // waiting for the next timer tick.
  let lastMode = effectiveDatabaseMode();
  const offMode = subscribeDatabaseMode(() => {
    const mode = effectiveDatabaseMode();
    if (mode === lastMode) return;
    lastMode = mode;
    if (mode === "online") wake();
  });
  // One heartbeat for the whole app decides whether we are online — the
  // browser's own flag lies on captive networks. A confirmed reconnect forces
  // a catch-up pass at once instead of waiting for the next tick.
  const offConnectivity = subscribeConnectivity((state: Connectivity) => {
    if (state === "offline") sleep();
    else if (state === "online") {
      wake();
      // A terminal that was offline while an administrator changed a rule
      // must not wait for a live event it already missed: reconnecting
      // re-reads the central configuration straight away.
      announceSettingsChange("reconnect");
    }
  });
  const wakeOutbox = () => void runExclusive("local-write");
  const flushBeforeBackground = () => {
    if (document.visibilityState === "hidden" && isOnline()) void runExclusive("background");
  };
  window.addEventListener("pos:browser-outbox-changed", wakeOutbox);
  document.addEventListener("visibilitychange", flushBeforeBackground);

  // Live listener: an account or settings change made anywhere lands in this
  // shop's own database within a second instead of waiting for the timer.
  // Auth can become ready after this engine starts, so rebuild the channel at
  // that boundary instead of permanently choosing anonymous or staff mode.
  let liveHasStaffSession = hasStaffSession();
  const liveChannels = createSerialChannelReplacer<ReturnType<typeof supabaseExternal.channel>>({
    remove: (channel) => supabaseExternal.removeChannel(channel),
    onCurrentChange: (channel) => {
      settingsLiveChannel = channel;
    },
    onError: (error) => {
      console.warn("[sync] Realtime channel replacement failed", error);
    },
  });
  const installLiveChannel = (staffPresent: boolean) => {
    void liveChannels.replace(() => {
      const next = supabaseExternal.channel("pos-live-settings");
      next.on("broadcast", { event: "settings_changed" }, (message) => {
        const table = String((message as { payload?: { table?: unknown } }).payload?.table ?? "");
        if (!(LIVE_CONTROL_TABLES as readonly string[]).includes(table)) return;
        queueLiveChange({ reason: `broadcast:${table}`, table, storeId: null });
      });
      // Database-change subscriptions require table SELECT privileges. PIN-only
      // Electron sessions intentionally have no cloud staff JWT, so they rely on
      // durable local SQL synchronization and polling instead of opening invalid
      // anon subscriptions. Authenticated web users retain scoped live wake-ups.
      if (staffPresent) {
        for (const table of ORGANIZATION_LIVE_TABLES) {
          next.on("postgres_changes", { event: "*", schema: "public", table }, (payload) => {
            const changed = ((
              payload as { new?: Record<string, unknown>; old?: Record<string, unknown> }
            ).new ??
              (payload as { old?: Record<string, unknown> }).old ??
              {}) as Record<string, unknown>;
            const storeId = String(changed.store_id ?? changed.branch_id ?? "").trim() || null;
            const entityId = String(changed.id ?? "").trim() || null;
            queueLiveChange({ reason: `live:${table}`, table, storeId, entityId });
          });
        }
        const liveBranchId = activeBranchId();
        if (liveBranchId) {
          for (const { table, column } of BRANCH_LIVE_TABLES) {
            next.on(
              "postgres_changes",
              {
                event: "*",
                schema: "public",
                table,
                filter: `${column}=eq.${liveBranchId}`,
              },
              (payload) => {
                const changed = ((
                  payload as { new?: Record<string, unknown>; old?: Record<string, unknown> }
                ).new ??
                  (payload as { old?: Record<string, unknown> }).old ??
                  {}) as Record<string, unknown>;
                const entityId = String(changed.id ?? "").trim() || null;
                queueLiveChange({
                  reason: `live:${table}`,
                  table,
                  storeId: liveBranchId,
                  entityId,
                });
              },
            );
          }
        }
      }
      next.subscribe((status) => {
        // A resubscribe after a dropped socket may have missed events while it
        // was down, so treat a fresh join as a reason to re-read the rules.
        if (status === "SUBSCRIBED") announceSettingsChange("realtime:subscribed");
      });
      return next;
    });
  };
  installLiveChannel(liveHasStaffSession);
  const { data: authListener } = supabaseExternal.auth.onAuthStateChange((_event, session) => {
    const staffPresent = Boolean(session?.access_token);
    if (staffPresent === liveHasStaffSession) return;
    liveHasStaffSession = staffPresent;
    installLiveChannel(staffPresent);
  });

  tick();
  return () => {
    window.clearInterval(timer);
    offConfig();
    offConnectivity();
    if (debounce) window.clearTimeout(debounce);
    if (liveTimer) window.clearTimeout(liveTimer);
    pendingLiveChanges.clear();
    authListener.subscription.unsubscribe();
    void liveChannels.stop();
    offDesktopStatus?.();
    offMode();
    window.removeEventListener("pos:browser-outbox-changed", wakeOutbox);
    document.removeEventListener("visibilitychange", flushBeforeBackground);
    started = false;
  };
}
