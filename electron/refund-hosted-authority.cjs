const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
/** Reuses existing authenticated Main HTTPS endpoints. No service key or saved credential. */
function createHostedRefundVerifier({ backend, terminal, fetch: send = globalThis.fetch, now = Date.now }) {
  return async ({ input, sale, scope, basis = null }) => {
    const base = backend(), device = terminal(), supplied = input.proof;
    if (!base || !device?.tokenId || !device.deviceBindingProof || !supplied || typeof supplied !== "object" || Array.isArray(supplied)) fail("EONLINE_REQUIRED", "Connect and sign in to verify this central refund approval.");
    const proof = {};
    for (const key of ["accessToken", "cashierToken", "sessionToken"]) {
      if (supplied[key] === undefined) continue;
      if (typeof supplied[key] !== "string" || !supplied[key] || supplied[key].length > 4000) fail("EAPPROVAL_CREDENTIAL", "The refund session proof is invalid.");
      proof[key] = supplied[key];
    }
    if (!Object.keys(proof).length) fail("EONLINE_REQUIRED", "Sign in online to verify this central refund approval.");
    Object.assign(proof, { terminalToken: device.tokenId, deviceBindingProof: device.deviceBindingProof });
    async function post(path, body) {
      scope.assertCurrent(); let response;
      try { response = await send(base + path, { method: "POST", redirect: "error", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) }); }
      catch { fail("EONLINE_REQUIRED", "The central refund authorization could not be reached. Nothing was refunded."); }
      scope.assertCurrent();
      if (!response.ok) fail([401, 403].includes(response.status) ? "EAPPROVAL_DENIED" : "EONLINE_REQUIRED", "The central refund authorization was not accepted. Nothing was refunded.");
      const text = await response.text(); scope.assertCurrent();
      if (text.length > 32768) fail("EAPPROVAL_DENIED", "The central refund confirmation was invalid.");
      try { return JSON.parse(text); } catch { fail("EAPPROVAL_DENIED", "The central refund confirmation was invalid."); }
    }
    const identity = await post("/api/v1/pos/ipc-adopt", proof);
    if (identity?.ok !== true || typeof identity.subject !== "string" || identity.subject.toLowerCase() !== scope.requester.toLowerCase() || typeof identity.authorId !== "string" || identity.authorId.toLowerCase() !== scope.requesterId || identity.permissions?.can_process_refund !== true || (identity.branchId && identity.branchId !== scope.branchId)) fail("EAPPROVAL_DENIED", "The verified central operator does not match this refund session.");
    const result = await post("/api/v1/pos/sync?operation=authorization", { action: "verify_mutation", data: { ...proof, actionKey: "refund", storeId: scope.branchId, requestedAmount: scope.amount / 100, grantToken: input.grantToken ?? null,
      payload: { sale_id: input.saleId, receipt_no: sale.bill_number ?? input.saleId, total: scope.amount / 100 },
      ...(basis ? { refundApprovalBasis: basis, refundApprovalWitness: { authorId: scope.requesterId, subject: scope.requester } } : {}) } });
    if (result?.ok !== true) fail("EAPPROVAL_DENIED", "The central approval does not authorize this exact refund.");
    if (typeof result.required !== "boolean") fail("EAPPROVAL_DENIED", "The central refund approval response is incomplete.");
    let expiresAt = now() + 120000;
    if (result.required) {
      if (result.grant?.action !== "refund" || result.grant.storeId !== scope.branchId || !Number.isSafeInteger(result.grant.exp) || result.grant.exp <= now()) fail("EAPPROVAL_DENIED", "The central refund approval is expired or outside this branch.");
      expiresAt = Math.min(expiresAt, result.grant.exp);
    }
    scope.assertCurrent();
    if (basis && (typeof result.refundApprovalReceipt !== "string" || !result.refundApprovalReceipt || result.refundApprovalReceipt.length > 32768)) fail("EAPPROVAL_DENIED", "The central refund receipt is missing. Nothing was refunded.");
    return { expiresAt, ...(basis ? { refundApprovalReceipt: result.refundApprovalReceipt } : {}) };
  };
}
module.exports = { createHostedRefundVerifier };
