import { beginDataTask } from "./data-progress";
/**
 * Full-table reads that are not silently cut short.
 *
 * The central database answers any single request with at most 1,000 rows.
 * A catalogue larger than that used to arrive truncated with no error at all,
 * so the till believed the shop only stocked 1,000 items. Everything that
 * needs a complete list goes through here instead: it walks the table one
 * window at a time until a short window comes back, and refuses to hand over
 * a partial answer.
 */

/** Rows per request — the server-side cap. */
export const PAGE = 1000;

/**
 * Hard ceiling so a runaway loop can never hang the till. The catalogue UI
 * renders only its current page, so this protects genuinely exceptional data
 * while allowing the hundreds-of-thousands scale expected by large shops.
 */
export const MAX_ROWS = 500_000;

/** How many windows may be in the air at once. */
const CONCURRENCY = 3;

export type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
  count?: number | null;
};

export type PagedRead<T> = {
  data: T[] | null;
  error: { message: string } | null;
  /** Row count the database reported, when it gave one. */
  total: number | null;
  /** True when the hard ceiling stopped the read before the end. */
  capped: boolean;
};

/**
 * Read every row a query matches.
 *
 * `build(from, to, withCount)` must produce the same filtered, ordered query
 * for every window. Only the first window needs an exact count; asking the
 * database to recount the whole table on every page wastes work.
 */
async function readPages<T>(
  build: (from: number, to: number, withCount: boolean) => PromiseLike<PageResult<T>>,
  opts: {
    pageSize?: number;
    maxRows?: number;
    onProgress?: (completed: number, total: number | null) => void;
  } = {},
): Promise<PagedRead<T>> {
  const size = Math.max(1, opts.pageSize ?? PAGE);
  const ceiling = Math.max(size, opts.maxRows ?? MAX_ROWS);

  const first = await build(0, size - 1, true);
  if (first.error) return { data: null, error: first.error, total: null, capped: false };

  const rows = [...(first.data ?? [])];
  const total = typeof first.count === "number" ? first.count : null;
  opts.onProgress?.(rows.length, total);
  if (rows.length < size)
    return { data: rows, error: null, total: total ?? rows.length, capped: false };

  // The database told us how many rows there are: fetch the remaining windows
  // together instead of discovering the end one round trip at a time.
  if (total !== null) {
    const wanted = Math.min(total, ceiling);
    const starts: number[] = [];
    for (let from = size; from < wanted; from += size) starts.push(from);
    for (let i = 0; i < starts.length; i += CONCURRENCY) {
      const group = starts.slice(i, i + CONCURRENCY);
      const results = await Promise.all(group.map((from) => build(from, from + size - 1, false)));
      for (const res of results) {
        if (res.error) return { data: null, error: res.error, total, capped: false };
        rows.push(...(res.data ?? []));
        opts.onProgress?.(rows.length, total);
      }
    }
    return { data: rows, error: null, total, capped: total > ceiling };
  }

  // No count available: walk forward until a short window arrives.
  let from = size;
  for (;;) {
    if (from >= ceiling) return { data: rows, error: null, total: rows.length, capped: true };
    const res = await build(from, from + size - 1, false);
    if (res.error) return { data: null, error: res.error, total: null, capped: false };
    const page = res.data ?? [];
    rows.push(...page);
    opts.onProgress?.(rows.length, null);
    if (page.length < size) return { data: rows, error: null, total: rows.length, capped: false };
    from += size;
  }
}

export async function readAllPages<T>(
  build: (from: number, to: number, withCount: boolean) => PromiseLike<PageResult<T>>,
  opts: { pageSize?: number; maxRows?: number; showProgress?: boolean } = {},
): Promise<PagedRead<T>> {
  // Routine reads and live refreshes never take over the foreground UI.
  if (!opts.showProgress) return readPages(build, opts);
  const task = beginDataTask("Loading database records");
  try {
    return await readPages(build, { ...opts, onProgress: task.report });
  } finally {
    task.finish();
  }
}
