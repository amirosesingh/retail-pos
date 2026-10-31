const MAX_PAGE_BYTES = 6 * 1024 * 1024;
const { bootstrapDiagnostic } = require("../diagnostics.cjs");
function nonJsonServicePressure(error) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "bootstrapDiagnostic");
    if (!descriptor || descriptor.enumerable || !Object.isFrozen(descriptor.value) ||
        Object.getOwnPropertyDescriptor(error, "status")?.value !== 503) return false;
    const diagnostic = bootstrapDiagnostic(error, []);
    return diagnostic.httpStatus === 503 && diagnostic.nonJsonResponse === true;
  } catch { return false; }
}
async function readPage(fetchPage, preferred = 100, { table } = {}) {
  const auditHistory = table === "change_history";
  let limit = Math.max(10, Math.min(auditHistory ? 100 : 500, Number(preferred) || 100));
  let timedOut = false;
  let timeoutRetries = 0;
  let pressureRetries = 0;
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
        nextLimit: !auditHistory && !timedOut && bytes < MAX_PAGE_BYTES / 4 ? Math.min(500, limit * 2) : limit,
      };
    } catch (error) {
      const timeout = ["57014", "ETIMEDOUT"].includes(error?.code) ||
        ["TimeoutError", "AbortError"].includes(error?.name);
      const pressure = auditHistory && nonJsonServicePressure(error);
      if (auditHistory) {
        let status;
        try {
          const value = Object.getOwnPropertyDescriptor(error, "status")?.value;
          if (typeof value === "number" || typeof value === "string") status = Number(value);
        } catch { /* An unreadable status never proves service pressure. */ }
        if (status === 401 || status === 403 || (status === 503 && !pressure)) throw error;
      }
      if ((pressure && pressureRetries >= 2) ||
          !(timeout || pressure || error?.code === "EOVERSIZED" || Number(error?.status) === 413) || limit === 10)
        throw error;
      timedOut ||= timeout;
      limit = Math.max(10, Math.floor(limit / 2));
      // A cancelled query or verified non-JSON503 is a pressure signal. Give the central service a
      // bounded recovery interval before the smaller read; do not immediately
      // launch another expensive page. Payload-size retries need no delay.
      if (timeout || pressure) {
        const delay = pressure ? 250 * (2 ** pressureRetries++) : Math.min(2_000, 250 * (2 ** timeoutRetries++));
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
}
module.exports = { readPage, MAX_PAGE_BYTES };
