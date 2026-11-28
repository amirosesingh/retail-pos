/**
 * The one way in and out of stored data.
 *
 * Supported writes use the configured local SQL transaction and durable
 * journal on Windows. An unreadable local state or a refused local write
 * stops the operation. Web, SQL-disabled devices and approved online-only
 * sessions use the central writer and the existing browser pending queue.
 * Centrally administered workflows retain their own authorized entry points.
 */
import { commitOps, commitLabel, type CommitTarget } from "@/core/api/pos-db";
import { AllTargetsFailed, isCloudDirect, isConnectionError } from "@/core/local-db/db-mode";
import { checkHealth } from "@/core/activation/connection-health";
import {
  routedQuery,
  routedQueryWithSource,
  type QueryOptions,
  type ReadSource,
} from "@/core/api/db-query";
import type { Row, SyncOp } from "@/lib/sync-outbox";

export { AllTargetsFailed, isCloudDirect };
export type { CommitTarget, QueryOptions, ReadSource };

export const dbRouter = {
  /**
   * Store a group of changes. Resolves once the data is genuinely saved;
   * central acceptance is downloaded by the existing native coordinator.
   */
  write(context: string, ops: SyncOp[]): Promise<CommitTarget> {
    return commitOps(context, ops);
  },

  /**
   * Read through the router: the live source first, the local copy if the
   * connection is down or the live read fails.
   */
  async read<T>(live: () => Promise<T>, local: () => T | null): Promise<T> {
    try {
      return await live();
    } catch (e) {
      const cached = local();
      if (cached !== null && cached !== undefined && isConnectionError(e)) return cached;
      throw e;
    }
  },

  /**
   * Read a table without choosing a database: central first when this device
   * is set to work online and the line is up, the local copy otherwise.
   */
  query(table: string, options: QueryOptions = {}): Promise<Row[]> {
    return routedQuery(table, options);
  },

  /**
   * Same read, but says whether the rows came from the central database or
   * from this terminal's copy, so a screen can tell the operator what they
   * are looking at.
   */
  queryWithSource(
    table: string,
    options: QueryOptions = {},
  ): Promise<{ rows: Row[]; source: ReadSource }> {
    return routedQueryWithSource(table, options);
  },

  /** Add rows. The row id doubles as the key, so a replay never duplicates. */
  insert(table: string, rows: Row | Row[], context = `Saving ${table}`) {
    return dbRouter.write(context, [
      { kind: "insert", table, rows: Array.isArray(rows) ? rows : [rows] },
    ]);
  },

  /** Add or replace rows by their id (or another agreed key). */
  upsert(table: string, rows: Row | Row[], onConflict = "id", context = `Saving ${table}`) {
    return dbRouter.write(context, [
      { kind: "upsert", table, rows: Array.isArray(rows) ? rows : [rows], onConflict },
    ]);
  },

  update(table: string, id: string, values: Row, context = `Updating ${table}`) {
    return dbRouter.write(context, [{ kind: "update", table, values, match: { id } }]);
  },

  delete(table: string, id: string, context = `Removing from ${table}`) {
    return dbRouter.write(context, [{ kind: "delete", table, match: { id } }]);
  },

  /** Plain wording for where a change landed. */
  label: commitLabel,

  /** Live view of what is reachable right now (cached for two seconds). */
  health: checkHealth,
};

/** Same gateway, under the name used elsewhere in the project brief. */
export const dbProxy = dbRouter;
