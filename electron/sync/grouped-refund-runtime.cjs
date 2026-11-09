const { recordId } = require("./uuid-fields.cjs");
const { stableRefundUuid } = require("./refund-command.cjs");
const { recordRefundAcceptance, refundHeld } = require("./grouped-refund-native.cjs");

const GRANT_CACHE_MS = 2 * 60 * 1000;

function createGroupedRefundRuntime({ configured, cash, cloud, coordinator, connectionManager, authority, legacyRepository }) {
  // The short-lived original grant stays in process memory. It never enters
  // the receipt, journal, renderer's offline queue, or sync error state.
  const grants = new Map();
  function pruneGrants() {
    for (const [id, value] of grants) if (Date.now() >= value.expiresAt) grants.delete(id);
  }
  async function commit(repository, args, financialContext, capture, grantToken) {
    const legacy = () => repository.refund(args, financialContext, { legacyFence: true, assertCurrent: capture.assertCurrent });
    if (!configured || repository !== legacyRepository()) return legacy();
    return coordinator.withExclusive(async () => {
      capture.assertCurrent();
      const branch = recordId(args.branchId);
      const active = await cash.admit(true);
      capture.assertCurrent();
      if (!active || active.scope.branchId !== branch) {
        return legacy();
      }
      const author = await authority.prepare(capture.financialCapture("REFUND"));
      const assertCurrent = () => { capture.assertCurrent(); active.assertCurrent(); author.assertCurrent(); };
      assertCurrent();
      const result = await repository.refund(args, financialContext, { source: active.scope, author, assertCurrent,
        sourceFingerprint: active.source.fingerprint });
      if (grantToken) {
        pruneGrants();
        if (grants.size >= 128) grants.delete(grants.keys().next().value);
        grants.set(stableRefundUuid({ refundId: args.refundId }), { token: grantToken, expiresAt: Date.now() + GRANT_CACHE_MS });
      }
      return result;
    });
  }
  async function upload(saved) {
    const active = await cash.admit(false);
    if (!active || Object.entries(saved.scope).some(([key, value]) => active.scope[key] !== value)) throw refundHeld();
    pruneGrants();
    const key = saved.command.operationId;
    const result = await cloud.submitGroupedRefund(active.source, saved, grants.get(key)?.token);
    if (result?.status !== "APPLIED") throw refundHeld();
    await recordRefundAcceptance(connectionManager, saved, result, active.assertCurrent);
    grants.delete(key);
    return true;
  }
  return { commit, upload };
}

module.exports = { createGroupedRefundRuntime };
