const MAX_PAGE_BYTES = 6 * 1024 * 1024;
async function readPage(fetchPage, preferred = 100) {
  let limit = Math.max(10, Math.min(500, Number(preferred) || 100));
  for (;;) {
    try {
      const batch = await fetchPage(limit);
      const bytes = Buffer.byteLength(JSON.stringify(batch), "utf8");
      if (bytes > MAX_PAGE_BYTES)
        throw Object.assign(new Error("Download exceeds the safe page size."), {
          code: "EOVERSIZED",
        });
      return {
        batch,
        limit,
        nextLimit: bytes < MAX_PAGE_BYTES / 4 ? Math.min(500, limit * 2) : limit,
      };
    } catch (error) {
      if (!(error?.code === "EOVERSIZED" || Number(error?.status) === 413) || limit === 10)
        throw error;
      limit = Math.max(10, Math.floor(limit / 2));
    }
  }
}
module.exports = { readPage, MAX_PAGE_BYTES };
