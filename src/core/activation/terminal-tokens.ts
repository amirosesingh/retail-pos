/**
 * Windows terminal activation tokens.
 *
 * An administrator issues one token per till from Settings → Terminal
 * Activation. The till redeems the code once, then keeps checking the token
 * status so management can disconnect a machine remotely.
 */
import {
  createTenantClient,
  resetExternalClient,
  supabaseExternal,
} from "@/integrations/supabase/external-client";
import {
  ACTIVATION_TTL_MS,
  decryptActivation,
  decryptActivationV1,
  encryptActivationV1,
  isEncryptedV1,
} from "@/lib/terminal-crypto";
import { clearDeviceSecret, getDeviceSecret, setDeviceSecret } from "@/lib/device-secrets";
import { recordActivationAttempt } from "@/core/activation/terminal-activation-log";
import { resetHealthCache } from "@/core/activation/connection-health";
import { canRelay, relayOp } from "@/core/api/sync-relay";
import { saveBackendUrl } from "@/lib/backend-config";

import {
  clearTerminalSupabaseOverride,
  setTerminalSupabaseOverride,
  supabaseConfig,
} from "@/lib/external-supabase-config";

export type TokenStatus = "active" | "used" | "revoked";

/** Which shell is claiming the code — recorded for troubleshooting. */
function claimPlatform(): string {
  if (typeof window === "undefined") return "server";
  const cap = (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  if (cap?.getPlatform) return cap.getPlatform();
  return (window as { pos?: unknown }).pos ? "electron" : "web";
}

/** Best-effort operating system name from the browser/shell. */
function claimOs(): string {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iOS/i.test(ua)) return "ios";
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac OS/i.test(ua)) return "macos";
  if (/Linux/i.test(ua)) return "linux";
  return "unknown";
}

/** Which kind of machine the code was issued for. */
export type TerminalPlatform = "pc" | "mobile";

export type TerminalToken = {
  id: string;
  locationId: string | null;
  locationName: string;
  deviceName: string;
  platform: TerminalPlatform;
  status: TokenStatus;
  createdAt: string;
  activatedAt: string | null;
  revokedAt: string | null;
  lastSeenAt: string | null;
  reissuedAt: string | null;
  replacedBy: string | null;
  claimedByDevice: string | null;
  claimedAt: string | null;
  /** single-use flag — true the moment a till redeems the code */
  isClaimed: boolean;
  /** the 15 minute redemption deadline */
  expiresAt: string | null;
  /** app version reported by the device on its last check-in */
  appVersion: string | null;
  /** last time the device finished a successful sync */
  lastSyncAt: string | null;
};

/** The table is not in the generated types, so queries go through a loose view. */
type LooseClient = {
  from: (table: string) => {
    select: (cols: string) => any;
    insert: (rows: unknown) => PromiseLike<{ error: { message: string } | null }>;
    upsert: (
      rows: unknown,
      options?: { onConflict?: string },
    ) => PromiseLike<{ error: { message: string } | null }>;
    update: (values: unknown) => any;
    delete: () => any;
  };
};

const table = () => (supabaseExternal as unknown as LooseClient).from("terminal_tokens");
const storesTable = () => (supabaseExternal as unknown as LooseClient).from("stores");

/** Narrow SECURITY DEFINER helpers — the only token access an unregistered till has. */
const rpc = (fn: string, args: Record<string, unknown>) =>
  (supabaseExternal as unknown as { rpc: (n: string, a: unknown) => PromiseLike<any> }).rpc(
    fn,
    args,
  );

import { deviceProofHash } from "@/core/activation/device-proof";

/** Same helper against a throwaway client for a tenant we are not paired to. */
const rpcOn = (client: unknown, fn: string, args: Record<string, unknown>) =>
  (client as { rpc: (n: string, a: unknown) => PromiseLike<any> }).rpc(fn, args);

/**
 * Point every later call at the tenant this till was activated against, so a
 * packaged terminal needs no environment variables of its own.
 */
function applyTenantOverride(config: TerminalConfig | null): void {
  if (config?.supabaseUrl && config?.supabaseKey) {
    setTerminalSupabaseOverride(config.supabaseUrl, config.supabaseKey);
  } else {
    clearTerminalSupabaseOverride();
  }
  resetExternalClient();
  // A probe made for the previous tenant must never make the newly activated
  // tenant look offline for the cache window.
  resetHealthCache();
}

export type TokenLocation = {
  id: string;
  code: string;
  name: string;
  address?: string;
  phone?: string;
};

/**
 * The token row references the central stores table. Locations may still live
 * only in local state (older installs, or a queued sync that never drained),
 * so mirror them up before anything depends on the reference.
 */
export async function ensureLocations(locations: TokenLocation[]): Promise<void> {
  if (!locations.length) return;
  const rows = locations.map((l) => ({
    id: l.id,
    code: l.code,
    name: l.name,
    address: l.address || null,
    phone: l.phone || null,
  }));
  if (canRelay()) {
    const relayed = await relayOp({ kind: "upsert", table: "stores", rows, onConflict: "id" });
    if (!relayed.ok) throw new Error(relayed.error ?? "Could not save branch locations");
    return;
  }
  const { error } = await storesTable().upsert(
    rows,
    { onConflict: "id" },
  );
  if (error) throw error;
}

const asStatus = (value: unknown): TokenStatus =>
  value === "revoked" ? "revoked" : value === "used" ? "used" : "active";

/**
 * Older POS databases predate the `platform` column, and PostgREST then rejects
 * the write with "could not find the platform column ... in the schema cache".
 * Run supabase/schema25.sql to add it; until then those rows are plain PC tills.
 */
const isMissingColumn = (error: { message?: string; code?: string } | null, column: string) =>
  !!error &&
  (error.code === "PGRST204" || /schema cache|does not exist/i.test(error.message ?? "")) &&
  (error.message ?? "").includes(column);

/**
 * Insert a token row, dropping columns an older database does not have yet
 * (`platform`, `is_claimed`, `expires_at` arrive with schema25/schema26).
 */
const UNSUPPORTED_KEY = "pos.terminal_tokens.unsupported.v1";

/** Columns this database has already rejected — remembered so we ask once. */
function unsupportedColumns(): Set<string> {
  const url = supabaseConfig().url;
  if (typeof window === "undefined") return new Set();
  try {
    const saved = JSON.parse(window.localStorage.getItem(UNSUPPORTED_KEY) ?? "{}") as Record<
      string,
      string[]
    >;
    return new Set(saved[url] ?? []);
  } catch {
    return new Set();
  }
}

function rememberUnsupported(column: string): void {
  if (typeof window === "undefined") return;
  const url = supabaseConfig().url;
  try {
    const saved = JSON.parse(window.localStorage.getItem(UNSUPPORTED_KEY) ?? "{}") as Record<
      string,
      string[]
    >;
    const list = new Set(saved[url] ?? []);
    list.add(column);
    saved[url] = [...list];
    window.localStorage.setItem(UNSUPPORTED_KEY, JSON.stringify(saved));
  } catch {
    /* storage unavailable */
  }
}

async function insertTokenRow(row: Record<string, unknown>): Promise<void> {
  const optional = ["platform", "is_claimed", "expires_at"];
  const attempt: Record<string, unknown> = { ...row };
  // Skip straight past the columns this database told us it does not have.
  for (const column of unsupportedColumns()) delete attempt[column];
  for (let i = 0; i <= optional.length; i += 1) {
    const { error } = await table().insert([attempt]);
    if (!error) return;
    const missing = optional.find((c) => c in attempt && isMissingColumn(error, c));
    if (!missing) throw error;
    rememberUnsupported(missing);
    delete attempt[missing];
  }
  throw new Error("Could not save the activation token");
}

const rowToToken = (r: Record<string, any>): TerminalToken => ({
  id: r.id,
  locationId: r.location_id ?? null,
  locationName: r.location_name ?? "",
  deviceName: r.device_name ?? "",
  platform: r.platform === "mobile" || r.platform === "android" ? "mobile" : "pc",
  status: asStatus(r.status),
  createdAt: r.created_at,
  activatedAt: r.activated_at ?? null,
  revokedAt: r.revoked_at ?? null,
  lastSeenAt: r.last_seen_at ?? null,
  reissuedAt: r.reissued_at ?? null,
  replacedBy: r.replaced_by ?? null,
  claimedByDevice: r.claimed_by_device ?? null,
  claimedAt: r.claimed_at ?? null,
  isClaimed: r.is_claimed === true || asStatus(r.status) === "used",
  expiresAt: r.expires_at ?? null,
  appVersion: r.app_version ?? null,
  lastSyncAt: r.last_sync_at ?? null,
});

/* ----------------------------- admin surface ---------------------------- */

export async function listTerminalTokens(): Promise<TerminalToken[]> {
  const { data, error } = await table()
    .select(
      "id,location_id,location_name,device_name,platform,status,created_at,activated_at,revoked_at,last_seen_at,reissued_at,replaced_by,claimed_by_device,claimed_at,is_claimed,expires_at,app_version,last_sync_at",
    )
    .is("revoked_at", null)
    .in("status", ["active", "used"])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToToken);
}

/** Create the token row and return the base64 activation code for the till. */
export async function issueTerminalToken(input: {
  location: TokenLocation;
  locationName: string;
  deviceName: string;
  /** Defaults to a desktop till. */
  platform?: TerminalPlatform;
  /** reserved id when approving a pairing request scanned off a PC screen */
  tokenId?: string;
}): Promise<{ token: TerminalToken; code: string }> {
  // Self-healing: guarantee the referenced location row exists.
  await ensureLocations([input.location]);
  const id = input.tokenId || crypto.randomUUID();
  const issuedAt = Date.now();
  const row = {
    id,
    location_id: input.location.id,
    location_name: input.locationName,
    device_name: input.deviceName,
    platform: input.platform ?? "pc",
    status: "active" as const,
    created_at: new Date(issuedAt).toISOString(),
    is_claimed: false,
    expires_at: new Date(issuedAt + ACTIVATION_TTL_MS).toISOString(),
  };
  await insertTokenRow(row);

  return {
    token: rowToToken(row),
    code: await encryptActivationV1({
      supabaseUrl: supabaseConfig().url,
      supabaseAnonKey: supabaseConfig().key,
      backendUrl: typeof window !== "undefined" ? window.location.origin : undefined,
      pairToken: id,
      ts: issuedAt,
      deviceName: input.deviceName,
      platform: input.platform ?? "pc",
    }),
  };
}

export async function revokeTerminalToken(id: string): Promise<void> {
  const { error } = await table()
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Replace the code of an existing terminal without creating a second entry for
 * the same counter: the old row is retired and a new row inherits the device
 * name and location, so the branch keeps one row in the table.
 */
export async function reissueTerminalToken(
  token: TerminalToken,
): Promise<{ token: TerminalToken; code: string }> {
  const id = crypto.randomUUID();
  const issuedAt = Date.now();
  const now = new Date(issuedAt).toISOString();
  const row = {
    id,
    location_id: token.locationId,
    location_name: token.locationName,
    device_name: token.deviceName,
    platform: token.platform,
    status: "active" as const,
    created_at: now,
    reissued_at: now,
    is_claimed: false,
    expires_at: new Date(issuedAt + ACTIVATION_TTL_MS).toISOString(),
  };
  await insertTokenRow(row);

  const { error: retireError } = await table()
    .update({ status: "revoked", revoked_at: now, replaced_by: id })
    .eq("id", token.id);
  if (retireError) throw retireError;

  return {
    token: rowToToken(row),
    code: await encryptActivationV1({
      supabaseUrl: supabaseConfig().url,
      supabaseAnonKey: supabaseConfig().key,
      backendUrl: typeof window !== "undefined" ? window.location.origin : undefined,
      pairToken: id,
      ts: issuedAt,
      deviceName: token.deviceName,
      platform: token.platform,
    }),
  };
}

/* --------------------------- terminal surface --------------------------- */

export type TerminalConfig = {
  tokenId: string;
  /** human-readable name of this physical machine, shown everywhere */
  deviceName?: string;
  /** pc or mobile, as recorded when the code was issued */
  deviceType?: "pc" | "mobile";
  locationId: string;
  locationName: string;
  supabaseUrl: string;
  supabaseKey: string;
  backendUrl?: string;
  activatedAt: string;
};

const CONFIG_KEY = "pos.terminal.config";
const EVENT = "pos:terminal-config-changed";

/**
 * The activation is device identity, so it is kept sealed (AES-256-GCM with
 * the per-device key) instead of readable text, and mirrored into the phone's
 * persistent store. Readers stay synchronous through this in-memory copy,
 * which `hydrateTerminalConfig()` fills before the first screen renders.
 */
const SEALED_NAME = "terminal.config";
let cachedConfig: TerminalConfig | null = null;
let hydrated = false;

const parseConfig = (raw: string | null): TerminalConfig | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TerminalConfig;
    if (!parsed?.tokenId) return null;
    const shell = claimPlatform();
    return {
      ...parsed,
      deviceType: shell === "android" ? "mobile" : shell === "electron" ? "pc" : parsed.deviceType,
    };
  } catch {
    return null;
  }
};

/** True once the sealed activation has been read back into memory. */
export const isTerminalConfigHydrated = () => hydrated;

/**
 * Unseal the saved activation (migrating an older plain copy) so the till
 * comes back registered after a relaunch, an update or an Android low-memory
 * restart. Safe to call repeatedly.
 */
export async function hydrateTerminalConfig(): Promise<TerminalConfig | null> {
  if (typeof window === "undefined") return null;
  if (hydrated) return cachedConfig;
  const legacy = parseConfig(window.localStorage.getItem(CONFIG_KEY));
  if (legacy) {
    cachedConfig = legacy;
    hydrated = true;
    applyTenantOverride(legacy);
    // Keep Electron's synchronization process on the same activation as the
    // renderer. An update or storage recovery may restore only this sealed
    // renderer copy; without the mirror the UI looks activated while native
    // SQL synchronization incorrectly reports that no terminal is registered.
    await desktopBridge()?.writeTerminalConfig(legacy).catch(() => undefined);
    // One-time upgrade: seal it and drop the readable copy.
    try {
      await setDeviceSecret(SEALED_NAME, legacy);
      window.localStorage.removeItem(CONFIG_KEY);
    } catch {
      /* keep the plain copy rather than losing the activation */
    }
    window.dispatchEvent(new CustomEvent(EVENT));
    return cachedConfig;
  }
  try {
    const sealed = await getDeviceSecret<TerminalConfig>(SEALED_NAME);
    if (sealed?.tokenId) {
      const shell = claimPlatform();
      cachedConfig = {
        ...sealed,
        deviceType: shell === "android" ? "mobile" : shell === "electron" ? "pc" : sealed.deviceType,
      };
      applyTenantOverride(cachedConfig);
      await desktopBridge()?.writeTerminalConfig(cachedConfig).catch(() => undefined);
    }
  } catch {
    /* unreadable seal — treat as not activated */
  }
  hydrated = true;
  window.dispatchEvent(new CustomEvent(EVENT));
  return cachedConfig;
}

export function readTerminalConfig(): TerminalConfig | null {
  if (typeof window === "undefined") return null;
  if (cachedConfig) return cachedConfig;
  // Before hydration finishes an older plain copy is still authoritative.
  return parseConfig(window.localStorage.getItem(CONFIG_KEY));
}

export function writeTerminalConfig(config: TerminalConfig) {
  if (typeof window === "undefined") return;
  cachedConfig = config;
  hydrated = true;
  applyTenantOverride(config);
  // The desktop mirror writes the token and the bound branch into the branch
  // SQL database; the sealed browser store is the fallback for a machine with
  // no local database engine.
  void desktopBridge()?.writeTerminalConfig(config);
  void setDeviceSecret(SEALED_NAME, config).catch(() => {
    // Last resort so the till is not left unregistered after a restart.
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  });
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Called when a token is revoked — the till loses its credentials entirely. */
export function clearTerminalConfig() {
  if (typeof window === "undefined") return;
  cachedConfig = null;
  hydrated = true;
  applyTenantOverride(null);
  clearDeviceSecret(SEALED_NAME);
  window.localStorage.removeItem(CONFIG_KEY);
  // Clearing goes through its own channel: saving an activation is an
  // administrator action, but erasing a dead one is housekeeping the machine
  // must be able to do with a cashier — or nobody — signed in.
  const bridge = desktopBridge();
  if (bridge?.clearTerminalConfig) void bridge.clearTerminalConfig();
  else void bridge?.writeTerminalConfig(null);
  window.dispatchEvent(new CustomEvent(EVENT));
}

/* --------------- desktop mirror (survives app updates) ------------------ */

type TerminalBridge = {
  readTerminalConfig: () => Promise<{ ok: boolean; config?: TerminalConfig | null }>;
  writeTerminalConfig: (config: TerminalConfig | null) => Promise<{ ok: boolean; code?: string; error?: string }>;
  clearTerminalConfig?: () => Promise<{ ok: boolean }>;
};

const desktopBridge = (): TerminalBridge | null => {
  if (typeof window === "undefined") return null;
  const api = (window as unknown as { pos?: Partial<TerminalBridge> }).pos;
  return api && typeof api.writeTerminalConfig === "function" ? (api as TerminalBridge) : null;
};

/**
 * Repair the Electron main-process activation mirror after the signed-in POS
 * administrator has been adopted. Boot hydration happens before that adoption
 * and its protected `terminal:write` can therefore be refused legitimately.
 * Database and sync actions call this again inside their authorised click so a
 * terminal that is already activated never needs a second activation code.
 */
export async function mirrorTerminalConfigToDesktop(): Promise<void> {
  const bridge = desktopBridge();
  if (!bridge) return;
  const config = readTerminalConfig() ?? (await hydrateTerminalConfig());
  if (!config?.tokenId) {
    throw new Error("The POS activation could not be read on this device. Sign out and reopen the POS before retrying.");
  }
  const result = await bridge.writeTerminalConfig(config);
  if (!result?.ok) {
    throw new Error(
      result?.error ??
        "Windows secure storage could not save the existing terminal activation.",
    );
  }
  const verified = await bridge.readTerminalConfig();
  if (!verified?.ok || verified.config?.tokenId !== config.tokenId) {
    throw new Error("Windows secure storage did not retain the terminal activation. Restart Windows and retry.");
  }
}

/**
 * An installer refresh can wipe the renderer's storage. The desktop shell keeps
 * a copy of the activation in its user-data folder, so the till comes back
 * already registered instead of asking for a new code.
 */
export async function restoreTerminalConfigFromDisk(): Promise<TerminalConfig | null> {
  const bridge = desktopBridge();
  if (!bridge || readTerminalConfig()) return readTerminalConfig();
  try {
    const result = await bridge.readTerminalConfig();
    const config = result?.config;
    if (!config?.tokenId) return null;
    writeTerminalConfig(config);
    return config;
  } catch {
    return null;
  }
}

export function subscribeTerminalConfig(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

export const TERMINAL_CONFIG_EVENT = EVENT;

/**
 * Forget this machine entirely: the sealed activation, the desktop mirror, the
 * tenant connection details and the machine account session all go, so the app
 * comes back on the activation screen.
 */
export async function unpairTerminal(): Promise<void> {
  clearTerminalConfig();
  clearPairingRequest();
  clearDeviceSecret("terminal-account");
  try {
    await supabaseExternal.auth.signOut({ scope: "local" });
  } catch {
    /* nothing else to clean up */
  }
}

/** Look the token up by id. `null` means the network answered "no such token". */
export async function fetchTokenStatus(
  tokenId: string,
): Promise<{
  status: TokenStatus;
  locationName: string;
  locationId: string;
  isClaimed: boolean;
  expiresAt: string | null;
} | null> {
  const { data, error } = await rpc("terminal_token_status", { p_token_id: tokenId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    status: asStatus(row.status),
    locationName: row.location_name ?? "",
    locationId: row.location_id ?? "",
    isClaimed: row.is_claimed === true || asStatus(row.status) === "used",
    expiresAt: row.expires_at ?? null,
  };
}

export async function stampHeartbeat(
  tokenId: string,
  _opts: { version?: string; synced?: boolean } = {},
): Promise<void> {
  // Current heartbeat functions accept UUIDs. Old desktop profiles can carry
  // an opaque pre-v1 token; sending it to PostgREST produces a noisy 400 on
  // every revocation interval without updating anything.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tokenId)) return;
  // Keep the call compatible with databases that still expose the original
  // two-argument function. The current four-argument function supplies
  // defaults for both omitted telemetry fields.
  await rpc("terminal_token_heartbeat", { p_token_id: tokenId, p_activate: false });
}

export class ActivationError extends Error {}

/**
 * Turn a failed status lookup into a message an operator can act on. The old
 * blanket "cannot reach the server" hid the common case: the database is
 * missing the activation helpers (PGRST202).
 */
function activationFailureMessage(e: unknown): string {
  const err = e as { code?: string; message?: string } | null;
  const code = err?.code ?? "";
  const message = err?.message ?? "";
  // Verdicts the database itself reached, so a till that skipped the client
  // pre-checks still gets refused — and still reads a plain reason.
  if (/TERMINAL_TOKEN_REVOKED/.test(message)) {
    return "This activation code has been revoked by management.";
  }
  if (/TERMINAL_PLATFORM_MISMATCH/.test(message)) {
    return "This code is for a different device type. Ask a supervisor for the correct PC or mobile activation code.";
  }
  if (/TERMINAL_TOKEN_EXPIRED/.test(message)) {
    return "This activation code has expired. Ask an administrator to generate a new one.";
  }
  if (/TERMINAL_BRANCH_INACTIVE/.test(message)) {
    return "The branch this code belongs to is no longer active. Ask an administrator for a code on a live branch.";
  }
  if (/TERMINAL_BRANCH_REQUIRED/.test(message)) {
    return "This activation code is not linked to a branch. Ask an administrator to reissue it.";
  }
  if (code === "PGRST203" || /could not choose the best candidate/i.test(message)) {
    return "This POS database has two versions of the terminal activation routine. Run supabase/schema33.sql on the POS database, then try again.";
  }

  if (code === "PGRST202" && /terminal_token_claim/.test(message)) {
    return "This POS database is missing the one-time terminal claim helper. Run supabase/schema.sql on the POS database, then try again.";
  }
  if (code === "PGRST202" && /terminal_token_status/.test(message)) {
    return "This POS database is missing the terminal status helper. Run supabase/schema.sql on the POS database, then try again.";
  }
  if (code === "PGRST202" && /terminal_token_heartbeat/.test(message)) {
    return "This POS database is missing the terminal heartbeat helper. Run supabase/schema.sql on the POS database, then try again.";
  }
  if (code === "PGRST202") {
    return "This POS database has an incomplete terminal activation setup. Run supabase/schema.sql on the POS database, then try again.";
  }
  if (
    e instanceof TypeError ||
    /failed to fetch|network|load failed/i.test(message)
  ) {
    return "Cannot reach the server to verify this code. Check the connection.";
  }
  return message
    ? `Could not verify this activation code: ${message}`
    : "Could not verify this activation code. Try again in a moment.";
}

/** Decrypt, verify against the server and register this machine. */
export async function activateTerminal(code: string): Promise<TerminalConfig> {
  // Two shapes travel in the wild: the current `ENC_V1:` one-time token and
  // the older self-contained payload still held by tills not yet re-issued.
  let payload: {
    token_id: string;
    location_id: string;
    location_name: string;
    supabase_url: string;
    supabase_key: string;
    backend_url?: string;
    device_name?: string;
    platform?: TerminalPlatform;
  };
  try {
    if (isEncryptedV1(code)) {
      const v1 = await decryptActivationV1(code);
      if (Number.isFinite(v1.ts) && Date.now() - v1.ts > ACTIVATION_TTL_MS) {
        const expired = new ActivationError(
          "This activation code has expired. Ask an administrator to generate a new one.",
        );
        void recordActivationAttempt(
          createTenantClient(v1.supabaseUrl, v1.supabaseAnonKey),
          {
            outcome: "expired",
            terminalId: v1.pairToken,
            reason: expired.message,
          },
        );
        throw expired;
      }
      payload = {
        token_id: v1.pairToken,
        location_id: "",
        location_name: "",
        supabase_url: v1.supabaseUrl,
        supabase_key: v1.supabaseAnonKey,
        backend_url: v1.backendUrl,
        device_name: v1.deviceName,
        platform: v1.platform,
      };
    } else {
      payload = await decryptActivation(code);
    }
  } catch (e) {
    if (e instanceof ActivationError) throw e;
    void recordActivationAttempt(null, {
      outcome: "invalid_code",
      terminalId: null,
      reason: "The activation code could not be read.",
    });
    throw new ActivationError("This activation code is not valid.");
  }

  const shell = claimPlatform();
  if (
    (payload.platform === "mobile" && shell !== "android") ||
    (payload.platform === "pc" && shell !== "electron")
  ) {
    throw new ActivationError(
      "This code is for a different device type. Ask a supervisor for the correct PC or mobile activation code.",
    );
  }

  // The claim runs against the tenant named inside the token, not against
  // whatever this machine happens to be pointed at — an unprovisioned till has
  // no connection details at all until this succeeds.
  const tenant = createTenantClient(payload.supabase_url, payload.supabase_key);
  const note = (
    outcome: Parameters<typeof recordActivationAttempt>[1]["outcome"],
    reason: string,
    branch?: { id?: string | null; name?: string | null },
  ) =>
    void recordActivationAttempt(tenant, {
      outcome,
      terminalId: payload.token_id,
      branchId: branch?.id ?? payload.location_id ?? null,
      branchName: branch?.name ?? payload.location_name ?? null,
      reason,
    });
  const statusOf = async () => {
    const { data, error } = await rpcOn(tenant, "terminal_token_status", {
      p_token_id: payload.token_id,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return {
      status: asStatus(row.status),
      locationName: row.location_name ?? "",
      locationId: row.location_id ?? "",
      isClaimed: row.is_claimed === true || asStatus(row.status) === "used",
      expiresAt: (row.expires_at ?? null) as string | null,
    };
  };
  const remote = await statusOf().catch((e: unknown) => {
    const message = activationFailureMessage(e);
    note("unreachable", message);
    throw new ActivationError(message);
  });
  if (!remote) {
    note("invalid_code", "This activation code is not recognised.");
    throw new ActivationError("This activation code is not recognised.");
  }
  const branch = { id: remote.locationId, name: remote.locationName };
  if (remote.status === "revoked") {
    note("revoked", "This activation code has been revoked by management.", branch);
    throw new ActivationError("This activation code has been revoked by management.");
  }
  if (remote.status === "used" || remote.isClaimed) {
    note("already_claimed", "This activation token has already been used.", branch);
    throw new ActivationError("This activation token has already been used or expired.");
  }
  if (remote.expiresAt && new Date(remote.expiresAt).getTime() < Date.now()) {
    note("expired", "This activation code passed its redemption deadline.", branch);
    throw new ActivationError(
      "This activation code has expired. Ask an administrator to generate a new one.",
    );
  }

  // One-time use: only the till that wins this atomic claim may register.
  const deviceName =
    typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 120) : null;
  const { data: claimed, error: claimError } = await rpcOn(tenant, "terminal_token_claim", {
    p_token_id: payload.token_id,
    p_device: deviceName,
    p_proof_hash: await deviceProofHash(),
    p_platform: claimPlatform(),
    p_os: claimOs(),
  });
  if (claimError) {
    const message = activationFailureMessage(claimError);
    note("unreachable", message, branch);
    throw new ActivationError(message);
  }
  if (claimed !== true) {
    note("already_claimed", "Another device won the one-time claim.", branch);
    throw new ActivationError("This activation token has already been used or expired.");
  }

  const config: TerminalConfig = {
    tokenId: payload.token_id,
    deviceName: payload.device_name?.trim() || remote.locationName || "",
    deviceType: claimPlatform() === "android" ? "mobile" : "pc",
    locationId: payload.location_id || remote.locationId,
    locationName: remote.locationName || payload.location_name,
    supabaseUrl: payload.supabase_url,
    supabaseKey: payload.supabase_key,
    backendUrl: payload.backend_url,
    activatedAt: new Date().toISOString(),
  };
  if (config.backendUrl) await saveBackendUrl(config.backendUrl);
  writeTerminalConfig(config);
  note("succeeded", "This till claimed the code and registered.", {
    id: config.locationId,
    name: config.locationName,
  });
  await rpcOn(tenant, "terminal_token_heartbeat", {
    p_token_id: config.tokenId,
    p_activate: true,
  });
  // Give this till its own machine account so its writes are accepted by the
  // central database even when a cashier signs in with a PIN.
  void import("@/lib/terminal-session").then((m) => m.provisionTerminalAccount(config.tokenId)).catch(() => null);
  return config;
}


/* ------------------------- phone-assisted pairing ------------------------ */

export type PairingRequest = {
  /** the token id the terminal reserved for itself */
  tokenId: string;
  deviceName: string;
};

const PAIR_KEY = "pos.terminal.pairing";
const PAIR_PREFIX = "POSPAIR1:";

/** Stable pairing request for this machine — reused across reloads. */
export function getPairingRequest(): PairingRequest {
  const suggested =
    typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent)
      ? "Windows till"
      : "POS terminal";
  if (typeof window === "undefined") return { tokenId: crypto.randomUUID(), deviceName: suggested };
  try {
    const raw = window.localStorage.getItem(PAIR_KEY);
    const parsed = raw ? (JSON.parse(raw) as PairingRequest) : null;
    if (parsed?.tokenId) return parsed;
  } catch {
    /* fall through and mint a new request */
  }
  const request: PairingRequest = { tokenId: crypto.randomUUID(), deviceName: suggested };
  try {
    window.localStorage.setItem(PAIR_KEY, JSON.stringify(request));
  } catch {
    /* non-fatal: the request simply changes on the next reload */
  }
  return request;
}

export function clearPairingRequest() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PAIR_KEY);
}

/** Text placed in the QR shown on the terminal for the phone to scan. */
export function encodePairingRequest(request: PairingRequest): string {
  return `${PAIR_PREFIX}${btoa(JSON.stringify(request))}`;
}

export function decodePairingRequest(value: string): PairingRequest | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const fromJson = (raw: string): PairingRequest | null => {
    try {
      const parsed = JSON.parse(raw) as PairingRequest;
      return parsed?.tokenId ? { tokenId: parsed.tokenId, deviceName: parsed.deviceName ?? "" } : null;
    } catch {
      return null;
    }
  };

  // Preferred form: the prefixed base64 payload the till renders.
  if (trimmed.startsWith(PAIR_PREFIX)) {
    const body = trimmed.slice(PAIR_PREFIX.length);
    try {
      const decoded = fromJson(atob(body));
      if (decoded) return decoded;
    } catch {
      /* fall through to the tolerant paths below */
    }
    return uuid.test(body) ? { tokenId: body, deviceName: "" } : null;
  }

  // A phone camera sometimes hands back the raw JSON, a bare token id, or a
  // link that carries the token. Accept all of them rather than failing.
  const asJson = fromJson(trimmed);
  if (asJson) return asJson;
  if (uuid.test(trimmed)) return { tokenId: trimmed, deviceName: "" };
  try {
    const url = new URL(trimmed);
    const fromQuery = url.searchParams.get("pair") ?? url.searchParams.get("token");
    if (fromQuery && uuid.test(fromQuery)) return { tokenId: fromQuery, deviceName: "" };
  } catch {
    /* not a URL */
  }
  const embedded = trimmed.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
  return embedded ? { tokenId: embedded[0], deviceName: "" } : null;
}

/**
 * Register this machine against a token id an administrator approved from the
 * phone. Same claim-once rules as pasting a code by hand.
 */
export async function activateWithTokenId(tokenId: string): Promise<TerminalConfig | null> {
  const remote = await fetchTokenStatus(tokenId).catch((e: unknown) => {
    throw new ActivationError(activationFailureMessage(e));
  });
  if (!remote) return null; // not approved yet
  if (remote.status !== "active") {
    throw new ActivationError(
      remote.status === "revoked"
        ? "This terminal has been revoked by management."
        : "This pairing request was already used. Ask for a new approval.",
    );
  }
  if (!remote.locationId) {
    throw new ActivationError(
      "This POS database is missing the pairing helper. Run supabase/schema23.sql on the POS database, then try again.",
    );
  }
  const deviceName = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 120) : null;
  const { data: claimed, error } = await rpc("terminal_token_claim", {
    p_token_id: tokenId,
    p_device: deviceName,
    p_proof_hash: await deviceProofHash(),
    p_platform: claimPlatform(),
    p_os: claimOs(),
  });
  if (error) throw new ActivationError(activationFailureMessage(error));
  if (claimed !== true) {
    throw new ActivationError("This pairing request was already used on another terminal.");
  }
  const config: TerminalConfig = {
    tokenId,
    deviceName: getPairingRequest().deviceName,
    deviceType: claimPlatform() === "android" ? "mobile" : "pc",
    locationId: remote.locationId,
    locationName: remote.locationName,
    supabaseUrl: supabaseConfig().url,
    supabaseKey: supabaseConfig().key,
    activatedAt: new Date().toISOString(),
  };
  writeTerminalConfig(config);
  clearPairingRequest();
  await rpc("terminal_token_heartbeat", {
    p_token_id: tokenId,
    p_activate: true,
  });
  void import("@/lib/terminal-session").then((m) => m.provisionTerminalAccount(tokenId)).catch(() => null);
  return config;
}
