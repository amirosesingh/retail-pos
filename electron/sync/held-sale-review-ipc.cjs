"use strict";

const guard = require("../ipc-guard.cjs");

const CHANNELS = Object.freeze({
  list: "sync:held-sale-review-list",
  preview: "sync:held-sale-review-preview",
  resolve: "sync:held-sale-review-resolve",
});
const messages = Object.freeze({
  PERMISSION_DENIED: "Sign in online as Administrator on this terminal to review held bills.",
  SESSION_INVALID: "The Administrator session needs verification. Sign in again to review this bill.",
  SYNC_BRANCH_FORBIDDEN: "The held bill does not belong to this terminal’s verified branch and shift.",
  ELOCAL_UPLOAD_PENDING: "This bill has local work waiting to upload. Keep it pending and reopen the comparison after synchronization.",
  ESYNC_REQUEST_CONTEXT_CHANGED: "The terminal, database connection or operator changed. Open a fresh comparison.",
  EHELD_SALE_REVIEW_CHANGED: "The saved bill changed after comparison. Open a fresh comparison before deciding.",
  EHELD_SALE_REVIEW_SCHEMA: "This PC needs the reviewed recovery metadata before it can save a decision.",
  EHELD_SALE_REVIEW_CLOUD_SCHEMA: "The company database needs the reviewed held-bill upgrade before this comparison can run.",
  EHELD_SALE_REVIEW_COLLISION: "A saved sale or one of its records already exists. The held bill remains available for review.",
  EHELD_SALE_REVIEW_CONFLICT: "The cloud hold and saved sale could not be linked exactly. The bill remains available for review.",
  EHELD_SALE_REVIEW_EXPIRED: "The comparison expired. Open the bill again to verify its current records.",
  EHELD_SALE_REVIEW_BUSY: "Local recovery is unavailable while the database or app is closing. Try again when it is ready.",
  SERVICE_UNAVAILABLE: "The company database could not verify the saved sale. Try again when connected.",
  ETIMEDOUT: "The company database did not answer in time. Try the comparison again when connected.",
});
const nativeCodes = Object.freeze({
  EHELD_SALE_RECOVERY_CONTEXT: "ESYNC_REQUEST_CONTEXT_CHANGED",
  EHELD_SALE_RECOVERY_IDENTITY: "SYNC_BRANCH_FORBIDDEN",
  EHELD_SALE_RECOVERY_SCHEMA: "EHELD_SALE_REVIEW_SCHEMA",
  EHELD_SALE_RECOVERY_REVIEW: "EHELD_SALE_REVIEW_EXPIRED",
  EHELD_SALE_RECOVERY_CHANGED: "EHELD_SALE_REVIEW_CHANGED",
  EHELD_SALE_RECOVERY_COLLISION: "EHELD_SALE_REVIEW_COLLISION",
  EHELD_SALE_RECOVERY_PENDING: "ELOCAL_UPLOAD_PENDING",
});
const denied = () => ({ ok: false, code: "PERMISSION_DENIED", error: messages.PERMISSION_DENIED });
const refusal = code => { throw Object.assign(new Error(messages[code]), { code }); };
const object = (value, keys) => {
  const input = guard.plainObject(value, { name: "held bill review" });
  if (Object.keys(input).some(key => !keys.includes(key))) throw new guard.BadArg("Unexpected held bill review field.");
  return input;
};
const ticket = value => guard.text(value, { name: "held bill reference", max: 450, pattern: /^D:[^\u0000-\u001f\u007f]+$/ });

function installHeldSaleReviewIpc({
  ipcMain, service, session, isPosSender, runExclusive, canResolve, onCommitted,
}) {
  const authorized = event => {
    const identity = session.identity();
    return isPosSender(event) && identity?.source === "pos" && identity.level === "admin";
  };
  const register = (channel, work) => ipcMain.handle(channel, async (event, value) => {
    if (!authorized(event)) return denied();
    session.touch();
    try {
      return await guard.guarded(async () => ({ ...await work(value, event), ok: true }));
    } catch (error) {
      const sourceCode = error?.code;
      const code = Object.hasOwn(messages, sourceCode) ? sourceCode
        : Object.hasOwn(nativeCodes, sourceCode) ? nativeCodes[sourceCode] : "EHELD_SALE_REVIEW_PENDING";
      return { ok: false, code, error: messages[code] ?? "The held bill could not be verified. Saved work remains intact." };
    }
  });

  register(CHANNELS.list, value => {
    const input = object(value, ["afterId", "limit"]);
    const limit = input.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw new guard.BadArg("Choose a held bill page size from 1 to 25.");
    return service.list({ afterId: input.afterId == null ? null : ticket(input.afterId), limit });
  });
  register(CHANNELS.preview, value => service.preview(ticket(value)));
  register(CHANNELS.resolve, (value, event) => {
    const input = object(value, ["reviewToken", "reason"]);
    const reviewToken = guard.text(input.reviewToken, { name: "review reference", max: 96, pattern: /^[A-Za-z0-9_-]{16,96}$/ });
    const reason = guard.text(input.reason, { name: "review reason", max: 400, pattern: /^[^\u0000-\u001f\u007f]+$/ }).trim();
    if (reason.length < 3) throw new guard.BadArg("Enter a reason for this recovery decision.");
    const epoch = session.epoch();
    return runExclusive(async () => {
      if (!authorized(event) || session.epoch() !== epoch) refusal("PERMISSION_DENIED");
      if (!canResolve()) refusal("EHELD_SALE_REVIEW_BUSY");
      const result = await service.resolve({ reviewToken, reason });
      if (result?.state === "ADOPTED") {
        try { onCommitted(result); } catch { /* Normal sync can retry after the saved decision. */ }
      }
      return result;
    });
  });
}

module.exports = { CHANNELS, installHeldSaleReviewIpc };
