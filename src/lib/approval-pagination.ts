/** Apply authorization before pagination, including explicitly routed cross-branch requests. */
export async function readApprovalPage<T>(
  read: (offset: number, limit: number) => Promise<T[]>,
  visible: (rows: T[]) => Promise<T[]>,
  page: number,
  pageSize: number,
) {
  const found: T[] = [];
  const needed = page * pageSize + 1;
  const batchSize = 300;
  for (let offset = 0; ; offset += batchSize) {
    const batch = await read(offset, batchSize);
    found.push(...await visible(batch));
    if (batch.length < batchSize || found.length >= needed) break;
  }
  const actualPage = Math.min(page, Math.max(1, Math.ceil(found.length / pageSize)));
  const start = (actualPage - 1) * pageSize;
  return {
    requests: found.slice(start, start + pageSize),
    pageInfo: { page: actualPage, pageSize, hasMore: found.length > start + pageSize },
  };
}
