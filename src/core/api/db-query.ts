import { productReadColumns } from "@/lib/ecommerce-device";
import { createProductProjectionReader } from "@/lib/product-projection";
import { normalizeUuidFields } from "@/lib/uuid-fields";
/**
 * Routed table reads.
 *
 * One place decides where a read is served from: the central database when
 * this terminal is working online and the line is up, the last good copy kept
 * on this terminal otherwise. Screens and the data layer both go through here
 * so neither can quietly become cloud-only.
 *
 * Kept separate from `db-router` so the data layer can read without importing
 * the write path (and creating an import cycle with `pos-db`).
 */
import {
  authenticatedExternalClientSnapshot,
  supabaseExternal,
} from "@/integrations/supabase/external-client";
import { hasCentralAuthSession } from "@/lib/session-presence";
import { noteVersions } from "@/lib/row-versions";
import { readAllPages } from "@/lib/paged-read";
import { retryDataRead } from "@/lib/read-retry";
import { sessionEpoch } from "@/lib/session-epoch";
import { localDb } from "@/core/local-db/local-db";
import { effectiveDatabaseMode } from "@/core/local-db/db-mode";

import type { Row } from "@/lib/sync-outbox";

/** Table names are dynamic here, so the generated row types do not apply. */
type LooseSelect = {
  select: (columns: string, opts?: { count?: "exact" }) => LooseFilter;
};
type LooseFilter = PromiseLike<{
  data: unknown;
  error: { message: string } | null;
  count?: number | null;
}> & {
  eq: (column: string, value: unknown) => LooseFilter;
  is: (column: string, value: null | boolean) => LooseFilter;
  in: (column: string, values: unknown[]) => LooseFilter;
  gte: (column: string, value: string) => LooseFilter;
  lte: (column: string, value: string) => LooseFilter;
  order: (column: string, opts: { ascending: boolean }) => LooseFilter;
  or: (expression: string) => LooseFilter;
  limit: (n: number) => LooseFilter;
  range: (from: number, to: number) => LooseFilter;
};

const PUBLIC_READ_TABLES = new Set(["public_flags", "coupon_campaigns"]);

const from = (client: unknown, table: string) =>
  (client as { from: (t: string) => LooseSelect }).from(table);

/**
 * Cloud tables whose stable key is not the conventional `id` column.
 *
 * The local SQL repository already derives ordering from its schema registry.
 * PostgREST queries are built here, so they need the equivalent key knowledge
 * or a bounded read will fail before it can fall back to the local snapshot.
 */
const CLOUD_PRIMARY_ORDER: Readonly<Record<string, readonly string[]>> = Object.freeze({
  branch_telemetry: ["terminal_id"],
  pin_attempts: ["key"],
  pos_store_settings: ["store_id"],
  public_flags: ["key"],
  secure_settings: ["key"],
  settings_locks: ["section"],
  settings_overrides: ["scope", "scope_id", "section"],
  settings_scoped: ["scope", "scope_id", "key"],
  staff_roles: ["slug"],
  stock_delta_applied: ["movement_id"],
  terminal_recovery_secrets: ["terminal_token_id"],
});

export type QueryOptions = {
  dateRange?: { column: string; from: string; to: string };
  columns?: string;
  match?: Record<string, unknown>;
  /** Rows whose column value is one of these. */
  in?: { column: string; values: unknown[] };
  orderBy?: { column: string; ascending?: boolean };
  limit?: number;
  /** Internal local pagination offset. */
  offset?: number;
  cursor?: { column: string; value: string; id: string };
};

/** Where a read was actually served from. */
export type ReadSource = "local" | "cloud";

/**
 * Reads already on the wire, so two screens asking for the same rows in the
 * same moment share one round trip instead of racing each other. Entries are
 * dropped the instant the read settles: nothing is cached, only shared.
 */
const inFlight = new Map<string, Promise<{ rows: Row[]; source: ReadSource }>>();

const readKey = (table: string, options: QueryOptions) => `${sessionEpoch()}|${effectiveDatabaseMode()}|${hasCentralAuthSession()}|${table}|${JSON.stringify(options)}`;

async function runQuery(
  table: string,
  options: QueryOptions,
): Promise<{ rows: Row[]; source: ReadSource }> {
  const bridge = localDb();
  if (effectiveDatabaseMode() === "local" && bridge?.query) {
    // The page can mount before PrivilegeGate's effect has handed the signed-in
    // identity to Main. Await that handoff before the first protected read.
    if (typeof window !== "undefined" && window.sqlAdmin?.adoptSession) {
      const { ensureDesktopPosSession } = await import("@/lib/desktop-pos-session");
      const authority = await ensureDesktopPosSession();
      if (!authority.ok) throw Object.assign(new Error(authority.error ?? "The signed-in account could not be verified on this PC."), { code: "EPRIVILEGE" });
    }
    // Never grow renderer memory with the size of a table. Callers page large
    // views explicitly; point lookups and configuration reads remain bounded.
    const result = await bridge.query(table, {
      ...options,
      limit: Math.min(options.limit ?? 1000, 2000),
    });
    if (!result.ok) throw Object.assign(new Error(result.error ?? "The local SQL Server read failed."), { code: (result as { code?: string }).code });
    const rows = normalizeUuidFields((result.rows ?? []) as Row[]);
    noteVersions(table, rows);
    return { rows, source: "local" };
  }
  let cloudClient: unknown = supabaseExternal;
  if (!PUBLIC_READ_TABLES.has(table)) {
    if (!hasCentralAuthSession()) {
      throw new Error("No verified cloud staff session is active.");
    }
    cloudClient = await authenticatedExternalClientSnapshot();
    if (!cloudClient) {
      throw new Error("The verified cloud staff session is still being restored.");
    }
  }
  const readProjection = createProductProjectionReader(table === "products" ? productReadColumns(options.columns) : options.columns ?? "*");
  const build = (start: number, end: number, withCount = false) => retryDataRead(async () => readProjection(async columns => {
    let q = from(cloudClient, table).select(columns, withCount ? { count: "exact" } : {});
    // PostgREST uses `is.null`, not `eq.null`.  The latter can return no rows
    // (or fail outright) and leaves deleted/archived records stale in the UI.
    for (const [k, v] of Object.entries(options.match ?? {}))
      q = v === null ? q.is(k, null) : q.eq(k, v);
    if (options.in) q = q.in(options.in.column, options.in.values);
    if (options.dateRange) q = q.gte(options.dateRange.column, options.dateRange.from).lte(options.dateRange.column, options.dateRange.to);
    if (options.cursor) {
      const op = options.orderBy?.ascending === true ? "gt" : "lt";
      q = q.or(
        `${options.cursor.column}.${op}.${options.cursor.value},and(${options.cursor.column}.eq.${options.cursor.value},id.${op}.${options.cursor.id})`,
      );
    }
    if (options.orderBy) {
      const ascending = options.orderBy.ascending ?? true;
      q = q.order(options.orderBy.column, { ascending });
      for (const column of CLOUD_PRIMARY_ORDER[table] ?? ["id"])
        if (column !== options.orderBy.column) q = q.order(column, { ascending });
    }
    // Most business tables use `id`; configuration and telemetry tables use
    // natural/composite keys. Apply every primary-key component so offset
    // pagination is deterministic even when the result crosses API pages.
    if (!options.orderBy) {
      for (const column of CLOUD_PRIMARY_ORDER[table] ?? ["id"])
        q = q.order(column, { ascending: true });
    }
    const result = await q.range(start, end) as {
      data: Row[] | null;
      error: { message: string } | null;
      count?: number | null;
      status?: number;
    };
    return result;
  }).then(result => {
    if (result.error) throw Object.assign(new Error(result.error.message), result.error, { status: result.status });
    return result;
  }), () => PUBLIC_READ_TABLES.has(table) || hasCentralAuthSession());
  // A caller that asked for a capped read gets exactly that; an uncapped
  // read is paged so the database's 1,000-row response cap cannot silently
  // truncate a whole table.
  let data: Row[] | null;
  if (options.limit) {
    const offset = Math.max(0, options.offset ?? 0);
    const res = await build(offset, offset + options.limit - 1);
    if (res.error) throw new Error(res.error.message);
    data = res.data;
  } else {
    const res = await readAllPages<Row>(build);
    if (res.error) throw new Error(res.error.message);
    data = res.data;
  }
  // Remember what version the central copy is on, so a later edit from this
  // till can say which version it was working from.
  const rows = normalizeUuidFields((data as Row[]) ?? []);
  noteVersions(table, rows);
  return { rows, source: "cloud" };
}

/**
 * Read a table without choosing a database, and say which one answered.
 */
export function routedQueryWithSource(
  table: string,
  options: QueryOptions = {},
): Promise<{ rows: Row[]; source: ReadSource }> {
  options = normalizeUuidFields(options);
  if (options.in) options = { ...options, in: { ...options.in, values: options.in.values.map(value =>
    normalizeUuidFields({ [options.in!.column]: value })[options.in!.column]) } };
  const key = readKey(table, options);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const run = runQuery(table, options).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, run);
  return run;
}

/** Same read when the caller does not care where the rows came from. */
export async function routedQuery(table: string, options: QueryOptions = {}): Promise<Row[]> {
  return (await routedQueryWithSource(table, options)).rows;
}
