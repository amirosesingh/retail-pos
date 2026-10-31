const MAX_PAGE_BYTES = 6 * 1024 * 1024;
async function readPage(fetchPage, preferred = 100) {
  let limit = Math.max(10, Math.min(500, Number(preferred) || 100));
  let timedOut = false;
  let timeoutRetries = 0;
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
        nextLimit: !timedOut && bytes < MAX_PAGE_BYTES / 4 ? Math.min(500, limit * 2) : limit,
      };
    } catch (error) {
      const timeout = ["57014", "ETIMEDOUT"].includes(error?.code) ||
        ["TimeoutError", "AbortError"].includes(error?.name);
      if (!(timeout || error?.code === "EOVERSIZED" || Number(error?.status) === 413) || limit === 10)
        throw error;
      timedOut ||= timeout;
      limit = Math.max(10, Math.floor(limit / 2));
      // A cancelled query is a pressure signal. Give the central service a
      // bounded recovery interval before the smaller read; do not immediately
      // launch another expensive page. Payload-size retries need no delay.
      if (timeout) {
        const delay = Math.min(2_000, 250 * (2 ** timeoutRetries++));
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
}
module.exports = { readPage, MAX_PAGE_BYTES };
