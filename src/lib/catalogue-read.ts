import { MAX_ROWS, PAGE, type PagedRead, type PageResult } from "./paged-read";

/** Walk immutable product IDs without an expensive full-table exact count. */
export async function readCataloguePages<T extends { id?: unknown }>(
  read: (afterId: string, limit: number) => PromiseLike<PageResult<T>>,
  report: (completed: number, total: number | null) => void,
  options: { pageSize?: number; maxRows?: number } = {},
): Promise<PagedRead<T>> {
  const size = options.pageSize ?? PAGE;
  const ceiling = options.maxRows ?? MAX_ROWS;
  const rows: T[] = [];
  let afterId = "";
  for (;;) {
    // At the ceiling, one additional ID distinguishes an exact fit from truncation.
    const limit = Math.min(size, ceiling - rows.length || 1);
    const result = await read(afterId, limit);
    if (result.error) return { data: null, error: result.error, total: null, capped: false };
    const page = result.data ?? [];
    if (rows.length === ceiling)
      return { data: rows, error: null, total: page.length ? null : rows.length, capped: page.length > 0 };
    rows.push(...page);
    report(rows.length, null);
    if (page.length < limit)
      return { data: rows, error: null, total: rows.length, capped: false };
    const lastId = page.at(-1)?.id;
    if (typeof lastId !== "string" || !lastId || (afterId && lastId <= afterId))
      return { data: null, error: { message: "Product catalogue pagination returned an invalid ID cursor." }, total: null, capped: false };
    afterId = lastId;
  }
}
