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
import { supabaseExternal } from "@/integrations/supabase/external-client";
import { noteVersions } from "@/lib/row-versions";
import { readAllPages } from "@/lib/paged-read";
import { localDb } from "@/core/local-db/local-db";

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
  in: (column: string, values: unknown[]) => LooseFilter;
  order: (column: string, opts: { ascending: boolean }) => LooseFilter;
  or: (expression: string) => LooseFilter;
  limit: (n: number) => LooseFilter;
  range: (from: number, to: number) => LooseFilter;
};

const from = (table: string) =>
  (supabaseExternal as unknown as { from: (t: string) => LooseSelect }).from(table);

export type QueryOptions = {
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

const readKey = (table: string, options: QueryOptions) => `${table}|${JSON.stringify(options)}`;

async function runQuery(
  table: string,
  options: QueryOptions,
): Promise<{ rows: Row[]; source: ReadSource }> {
  const bridge = localDb();
  if (bridge?.query) {
    // Never grow renderer memory with the size of a table. Callers page large
    // views explicitly; point lookups and configuration reads remain bounded.
    const result = await bridge.query(table, { ...options, limit: Math.min(options.limit ?? 1000, 2000) });
    if (!result.ok) throw new Error(result.error ?? "The local SQL Server read failed.");
    const rows = (result.rows ?? []) as Row[];
    noteVersions(table, rows);
    return { rows, source: "local" };
  }
  const build = (start: number, end: number) => {
    let q = from(table).select(options.columns ?? "*", { count: "exact" });
    for (const [k, v] of Object.entries(options.match ?? {})) q = q.eq(k, v);
    if (options.in) q = q.in(options.in.column, options.in.values);
    if (options.cursor) {
      const op = options.orderBy?.ascending === true ? "gt" : "lt";
      q = q.or(`${options.cursor.column}.${op}.${options.cursor.value},and(${options.cursor.column}.eq.${options.cursor.value},id.${op}.${options.cursor.id})`);
    }
    if (options.orderBy)
      q = q.order(options.orderBy.column, { ascending: options.orderBy.ascending ?? true });
    // Most business tables use `id`, but scoped/configuration tables often
    // have a composite primary key and no id column. An explicit order is
    // therefore also the caller's deterministic pagination key.
    if (!options.orderBy) q = q.order("id", { ascending: true });
    return q.range(start, end) as PromiseLike<{
      data: Row[] | null;
      error: { message: string } | null;
      count?: number | null;
    }>;
  };
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
  noteVersions(table, data);
  return { rows: (data as Row[]) ?? [], source: "cloud" };
}

/**
 * Read a table without choosing a database, and say which one answered.
 */
export function routedQueryWithSource(
  table: string,
  options: QueryOptions = {},
): Promise<{ rows: Row[]; source: ReadSource }> {
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
