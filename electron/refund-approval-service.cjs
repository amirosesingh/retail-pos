const { randomUUID, randomBytes } = require("node:crypto");
const { recordId } = require("./sync/uuid-fields.cjs");
const { hash } = require("./offline-approval-service.cjs");
const pages = require("./permission-pages.json");
const authority = import("./shared/approval-authority.mjs");
const approvalEvidence = require("./sync/refund-approval-evidence.cjs");
const { stableRefundUuid } = require("./sync/refund-command.cjs");
const PREFIX = "native-refund-v1:";
const fail = (message, code = "EAPPROVAL_POLICY") => { throw Object.assign(new Error(message), { code }); };
const json = value => typeof value === "string" ? JSON.parse(value) : value;
const role = person => String(person.role_slug ?? person.role ?? "staff").toLowerCase();
function saleCreatedAt(value) {
  if(!(value instanceof Date)&&!(typeof value==="string"&&value.trim()))fail("The saved receipt date could not be verified.","EAPPROVAL_CONTEXT");
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))fail("The saved receipt date could not be verified.","EAPPROVAL_CONTEXT");
  return approvalEvidence.normalizeRefundSaleCreatedAt(date.toISOString());
}
const permission = person => {
  const flags = json(person?.permissions) ?? {};
  const owners = pages.filter(page => page.keys.includes("can_process_refund"));
  return flags.can_process_refund === true && (!owners.length || owners.some(page => flags[`page:${page.id}`] !== false));
};
function cents(value) {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== "string" || !/^\d{1,14}(?:\.\d{1,12})?$/.test(text)) fail("The exact saved refund amount could not be verified.", "EREFUND_AMOUNT");
  const [whole, fraction = ""] = text.split(".");
  if (/[1-9]/.test(fraction.slice(2))) fail("The refund amount must contain exact cents.", "EREFUND_AMOUNT");
  const result = BigInt(whole) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, "0"));
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) fail("The refund amount is outside the supported exact range.", "EREFUND_AMOUNT");
  return Number(result);
}
function request(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["saleId", "branchId", "registeredTerminalId", "requestedAmount", "grantToken", "requestId", "username", "credential", "selfAuthorization", "reason", "proof", "recoveryOperationId"].includes(key))) fail("Invalid refund authorization.");
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 32768 || (value.grantToken != null && (typeof value.grantToken !== "string" || value.grantToken.length > 4096)) || (value.reason !== undefined && (typeof value.reason !== "string" || value.reason.length > 400)) || (value.selfAuthorization !== undefined && typeof value.selfAuthorization !== "boolean")) fail("Invalid or oversized refund authorization.");
  const saleId = recordId(value.saleId), branchId = recordId(value.branchId);
  if (typeof saleId !== "string" || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(saleId) || !branchId || typeof value.registeredTerminalId !== "string") fail("The refund receipt or terminal is invalid.");
  if (value.recoveryOperationId !== undefined && (typeof value.recoveryOperationId !== "string" || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.recoveryOperationId))) fail("The saved refund identity is invalid.");
  return { ...value, saleId, branchId, registeredTerminalId: recordId(value.registeredTerminalId), refundId: `refund:${value.saleId}`, amount: cents(value.requestedAmount) };
}
function assertRefundAge(sale, settings, now) {
  const age = now - new Date(sale.created_at).getTime();
  if (!Number.isFinite(age) || age < -300000 || (settings.max_refund_days_limit > 0 && age > settings.max_refund_days_limit * 86400000)) fail("This receipt is outside the permitted refund period.");
}
async function policyFor(policy, scope, verified, credentialMethod, pin, hosted = false) {
  const shared = await authority;
  const requester = policy.requester, actor = policy.actor;
  if (!requester?.is_active || recordId(requester.id) !== scope.requesterId || String(requester.user_id).toLowerCase() !== scope.requester.toLowerCase() || !permission(requester)) fail("The current account cannot refund this receipt.", "EPRIVILEGE");
  if (!Array.isArray(policy.rules) || !Array.isArray(policy.settings)) fail("The synchronized refund policy could not be read.");
  const candidates = policy.rules.map(raw => ({ raw, rule: shared.normalizeRule(raw) }))
    .filter(({ rule }) => rule.scopeId === "" || recordId(rule.scopeId) === scope.branchId);
  const branch = candidates.filter(({ rule }) => rule.scopeType === "branch" && recordId(rule.scopeId) === scope.branchId);
  const chosen = branch.length ? branch : candidates.filter(({ rule }) => rule.scopeType === "global");
  if (chosen.length > 1) fail("The refund approval rules are ambiguous.");
  for (const field of ["allowed_roles", "allowed_user_ids"]) {
    const raw = chosen[0]?.raw[field]; if (raw == null) continue;
    const parsed = json(raw); if (!Array.isArray(parsed) || parsed.some(item => typeof item !== "string")) fail("The refund approval audience is invalid.");
  }
  for (const field of ["authority_limits", "extra_authority", "absolute_ceilings"]) {
    const raw = chosen[0]?.raw[field]; if (raw == null) continue;
    const parsed = json(raw); if (!parsed || Array.isArray(parsed) || typeof parsed !== "object" || Object.values(parsed).some(item => !Number.isFinite(Number(item)) || Number(item) < 0)) fail("The refund approval limits are invalid.");
  }
  const global = policy.settings.filter(row => String(row.store_id ?? "").trim() === "");
  const local = policy.settings.filter(row => recordId(String(row.store_id ?? "").trim()) === scope.branchId);
  if (global.length > 1 || local.length > 1) fail("The synchronized refund policy is unavailable or ambiguous.");
  const settings = shared.normalizeRules({ ...global[0], ...Object.fromEntries(Object.entries(local[0] ?? {}).filter(([, value]) => value != null)) });
  if (!hosted && (settings.online_only_refund || (pin && !settings.allow_offline_approvals))) fail("This branch requires a central connection to authorize refunds.", "EONLINE_REQUIRED");
  const rule = chosen[0]?.rule ?? { ...shared.defaultRule("refund"), mode: settings.require_manager_pin_for_refund ? "pin" : "none" };
  const amount = scope.amount / 100;
  const direct = !rule.isEnabled || rule.mode === "none" || (role(requester) === "admin" && shared.canAuthorizeAmount(rule, { userId: requester.user_id, role: role(requester) }, amount));
  if (!hosted && !pin && !direct) fail("Authorize this refund with an eligible local approval PIN.", "EAPPROVAL_REQUIRED");
  if (pin) {
    if (!actor?.is_active || recordId(actor.id) !== recordId(verified.id) || String(actor.user_id).toLowerCase() !== String(verified.username).toLowerCase() || !permission(actor) || !["pin", "either"].includes(rule.mode) || !rule.isEnabled) fail("This account cannot approve this refund.");
    if (!shared.canAuthorizeAmount(rule, { userId: actor.user_id, role: role(actor) }, amount)) fail("The approval does not cover this refund amount.");
    const flags = json(actor.permissions) ?? {};
    if (flags["approval_scope:configured"] === true && flags["approval_scope:all"] !== true && !Object.entries(flags).some(([key, allowed]) => allowed === true && key.toLowerCase() === `approval_scope:branch:${scope.branchId}`.toLowerCase())) fail("The approver cannot authorize this branch.");
    if ((credentialMethod === "pin" && flags.approval_pin_enabled === false) || (credentialMethod === "totp" && flags.approval_totp_enabled !== true) || !["pin", "totp"].includes(credentialMethod)) fail("This approval credential is disabled.");
  }
  return { hash: hash({ rules: chosen, settings, requester, actor: pin ? actor : null }), rule, settings, author: pin ? actor : requester };
}
class RefundApprovalService {
  constructor({ captureScope, verify, store, verifyHosted = null, captureSource = null, readPending = null, allowPin = () => true, now = Date.now }) { Object.assign(this, { captureScope, verify, store, verifyHosted, captureSource, readPending, allowPin, now }); this.grants = new Map(); }
  async sale(scope, saleId, tx) {
    const result = await this.store.request(tx).input("sale", saleId).input("branch", scope.branchId).query(`SELECT id,store_id,bill_number,total_amount,row_version,is_refunded,created_at FROM dbo.sales${tx ? " WITH(UPDLOCK,HOLDLOCK)" : ""} WHERE id=TRY_CONVERT(uniqueidentifier,@sale) AND store_id=@branch;`);
    const sale = result.recordset?.[0];
    if (result.recordset?.length !== 1 || recordId(sale.id) !== saleId || recordId(sale.store_id) !== scope.branchId || cents(sale.total_amount) !== scope.amount || !Number.isSafeInteger(Number(sale.row_version)) || Number(sale.row_version) < 1) fail("The saved receipt does not match this refund.", "EREFUND_AMOUNT");
    return sale;
  }
  async authorize(value) {
    let input = request(value);
    const scope = { ...this.captureScope(), amount: input.amount };
    scope.assertCurrent(); if (input.branchId !== scope.branchId || input.registeredTerminalId !== scope.terminalId) fail("The refund does not match this terminal branch.", "SYNC_BRANCH_FORBIDDEN");
    if (input.grantToken?.startsWith(PREFIX)) {
      const prior=this.grants.get(input.grantToken);
      if(input.recoveryOperationId){
        if(!prior?.recovery||prior.recovery.operationId!==input.recoveryOperationId)fail("The saved approval belongs to another original refund.","EAPPROVAL_CONTEXT");
        input={...input,refundId:prior.input.refundId};
      }else if(prior?.recovery)fail("This approval only renews its original saved refund.","EAPPROVAL_CONTEXT");
      await this.proof(input.grantToken, input, scope); return { ok: true, grantToken: input.grantToken };
    }
    const sale = await this.sale(scope, input.saleId); scope.assertCurrent();
    let recovery = null;
    if (input.recoveryOperationId) {
      if (!this.readPending) fail("The original saved refund could not be verified.", "EAPPROVAL_CONTEXT");
      recovery = await this.readPending(scope, input.saleId, input.recoveryOperationId);
      if (!recovery || recovery.operationId !== input.recoveryOperationId || recovery.saleId !== input.saleId ||
          recovery.amountMinor !== String(input.amount) || !sale.is_refunded ||
          BigInt(String(sale.row_version)) !== BigInt(recovery.expectedSaleVersion) + 1n) fail("The original saved refund changed. Keep it pending for review.", "EAPPROVAL_CONTEXT");
      input = { ...input, refundId: recovery.refundId };
    } else if (sale.is_refunded) fail("This receipt has already been refunded.", "EALREADY");
    const source = this.captureSource ? await this.captureSource({ input, sale, scope, recovery }) : null;
    scope.assertCurrent(); source?.assertCurrent();
    const basis = source ? approvalEvidence.normalizeRefundApprovalBasis({ operationId: recovery?.operationId ?? stableRefundUuid({ refundId: input.refundId }),
      refundKey: input.refundId, saleId: input.saleId, expectedSaleVersion: recovery?.expectedSaleVersion ?? String(sale.row_version),
      amountMinor: String(input.amount), saleCreatedAt: saleCreatedAt(sale.created_at), scope: source.scope, requester: recovery
        ? { authorId: recovery.attestation.authorId, subject: recovery.attestation.subject }
        : { authorId: scope.requesterId, subject: scope.requester } }) : null;
    let pin = false;
    let hosted = false;
    let hostedExpiry = Infinity;
    let hostedReceipt = null;
    let verified = { id: scope.requesterId, username: scope.requester }, method = "pin";
    let policy = await this.store.readPolicy(scope, scope.requesterId, null, "refund"); scope.assertCurrent();
    let selected;
    try {
      if (input.grantToken) fail("Verify the existing central refund approval online.", "EONLINE_REQUIRED");
      selected = await policyFor(policy, scope, verified, method, false);
    }
    catch (error) {
      if (error?.code === "EONLINE_REQUIRED" && input.proof && this.verifyHosted) {
        const accepted = await this.verifyHosted({ input, sale, scope, basis }); scope.assertCurrent(); source?.assertCurrent();
        if (!Number.isSafeInteger(accepted?.expiresAt) || accepted.expiresAt <= this.now()) fail("The central refund approval expired.", "EAPPROVAL_EXPIRED");
        hostedExpiry = accepted.expiresAt;
        if (basis && (typeof accepted.refundApprovalReceipt !== "string" || !accepted.refundApprovalReceipt || accepted.refundApprovalReceipt.length > 32768)) fail("The durable central refund confirmation is missing.", "EAPPROVAL_DENIED");
        hostedReceipt = accepted.refundApprovalReceipt ?? null;
        hosted = true; selected = await policyFor(policy, scope, verified, method, false, true);
      } else {
      if (error?.code !== "EAPPROVAL_REQUIRED") throw error;
      if (typeof input.credential !== "string" || !input.credential) throw error;
      // The installed sender must be able to save and transport Main's exact
      // purpose-bound witness before an offline approval can commit money.
      if (!this.allowPin() || (this.captureSource && !basis)) fail("This refund requires a fresh central approval before it can be saved.", "EONLINE_REQUIRED");
      pin = true;
      if (typeof input.username !== "string" || input.username.length > 120 || input.credential.length > 32) fail("Invalid approval credential.");
      const checked = await this.verify(input.username, input.credential, scope); scope.assertCurrent();
      if (!checked?.ok || !checked.staff) fail(checked?.error ?? "The approval PIN was not accepted.", "EAPPROVAL_CREDENTIAL");
      verified = checked.staff; method = checked.credentialMethod ?? "pin";
      if (input.selfAuthorization && String(verified.username).toLowerCase() !== scope.requester.toLowerCase()) fail("Enter the signed-in account's approval PIN.");
      policy = await this.store.readPolicy(scope, verified.id, null, "refund"); scope.assertCurrent();
      selected = await policyFor(policy, scope, verified, method, true);
      }
    }
    assertRefundAge(sale, selected.settings, this.now());
    if (pin && selected.rule.requireReason && !String(input.reason ?? "").trim()) fail("A reason is required for this approval.");
    const requestId = input.requestId ?? randomUUID();
    if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(requestId)) fail("Invalid approval identity.");
    const contextHash = hash({ saleId: input.saleId, refundId: input.refundId, amount: input.amount, version: Number(sale.row_version), requester: scope.requesterId, branch: scope.branchId, terminal: scope.terminalId });
    // The hosted PIN/request approval already has its authoritative audit.
    // Do not invent a second approval attributed to the refunding cashier.
    if (!hosted) {
    const prior = await this.store.readPrior(requestId); scope.assertCurrent();
    if (prior && (prior.contextHash !== contextHash || prior.policyHash !== selected.hash || prior.requesterId !== scope.requesterId || recordId(prior.authorizer) !== recordId(verified.id))) fail("This approval identity belongs to a different refund.", "EIDEMPOTENCY");
    const row = prior?.row ?? { id: requestId, action_key: "refund", mode_used: pin ? "offline_pin" : "direct", request_id: null, requested_by: scope.requester, authorized_by: selected.author.user_id,
      authorizer_role: role(selected.author), store_id: scope.branchId, terminal_id: scope.terminalId, outcome: "approved", created_at: new Date(this.now()).toISOString(),
      detail: { reason: String(input.reason ?? "").trim(), offline: !hosted, requested_amount: input.amount / 100, ticket_reference: sale.bill_number,
        native_approval: { version: 1, contextHash, policyHash: selected.hash, requester: scope.requester, requesterId: scope.requesterId, authorizer: verified.id }, context: { sale_id: input.saleId, refund_id: input.refundId } } };
    const saved = { row, verified };
    await this.store.persist(scope, { requestId, actionKey: "refund" }, saved, async current => {
      if ((await policyFor(current, scope, verified, method, pin, hosted)).hash !== selected.hash) fail("The refund policy changed. Request approval again."); scope.assertCurrent();
    }); scope.assertCurrent();
    }
    for (const [key, grant] of this.grants) if (this.now() >= grant.expires + (grant.committed ? 600000 : 0)) this.grants.delete(key);
    if (this.grants.size >= 128) fail("Finish the existing refund approvals first.");
    const token = PREFIX + randomBytes(32).toString("base64url");
    const expires = Math.min(this.now() + 120000, hostedExpiry);
    if (expires <= this.now()) fail("The refund approval expired before it could be saved.", "EAPPROVAL_EXPIRED");
    this.grants.set(token, { input: { saleId: input.saleId, refundId: input.refundId, amount: input.amount }, scope, verified, method, pin, hosted,
      // A durable certificate is purpose-bound, never the original bearer grant.
      hostedGrant: hosted && !basis ? input.grantToken : null, hostedReceipt, source, basis, recovery,
      approvalId: requestId, reason: String(input.reason ?? "").trim() || null,
      policyHash: selected.hash, saleVersion: Number(sale.row_version), expires, committed: false });
    return { ok: true, grantToken: token, ...(!hosted && { authorizer: { id: selected.author.user_id, name: selected.author.full_name || selected.author.user_id, role: role(selected.author) } }) };
  }
  async proof(token, input, scope, tx, replayed = false) {
    const grant = this.grants.get(token);
    if (!grant || input.saleId !== grant.input.saleId || input.refundId !== grant.input.refundId || input.amount !== grant.input.amount || scope.requesterId !== grant.scope.requesterId || scope.branchId !== grant.scope.branchId || scope.terminalId !== grant.scope.terminalId) fail("The refund approval is not bound to this receipt and operator.", "EAPPROVAL_CONTEXT");
    grant.scope.assertCurrent(); scope.assertCurrent();
    // ReceiptRepository permits this only after proving the existing stable
    // refund receipt and its branch. A lost IPC reply never repeats stock.
    if (replayed || (grant.committed && !tx)) return grant;
    if (grant.committed) fail("The saved refund receipt is missing. Review recovery before retrying.", "EAPPROVAL_CONTEXT");
    if (grant.pin && !this.allowPin()) fail("This refund requires central approval before saving.", "EONLINE_REQUIRED");
    if (this.now() >= grant.expires) fail("The refund approval expired. Request approval again.", "EAPPROVAL_EXPIRED");
    const selected = await policyFor(await this.store.readPolicy(scope, grant.verified.id, tx, "refund"), scope, grant.verified, grant.method, grant.pin, grant.hosted);
    const sale = await this.sale(scope, input.saleId, tx); scope.assertCurrent();
    grant.source?.assertCurrent();
    assertRefundAge(sale, selected.settings, this.now());
    if(grant.basis&&saleCreatedAt(sale.created_at)!==grant.basis.saleCreatedAt)fail("The original receipt date changed. Keep the refund pending for review.","EAPPROVAL_CONTEXT");
    if (selected.hash !== grant.policyHash || Number(sale.row_version) !== grant.saleVersion || Boolean(sale.is_refunded) !== Boolean(grant.recovery)) fail("The refund receipt or policy changed. Reopen it before trying again.", "EAPPROVAL_CONTEXT");
    if (grant.recovery) {
      const pending = await this.readPending(scope, input.saleId, grant.recovery.operationId, tx);
      if (!pending || pending.payloadJson !== grant.recovery.payloadJson || pending.attestation.signature !== grant.recovery.attestation.signature ||
          pending.expectedSaleVersion !== grant.recovery.expectedSaleVersion) fail("The original refund changed before its approval was saved.", "EAPPROVAL_CONTEXT");
    }
    return grant;
  }
  admission(token, args) {
    if (typeof token !== "string" || !token.startsWith(PREFIX)) fail("Main must verify this refund authorization before it can be saved.", "EAPPROVAL_REQUIRED");
    const grant = this.grants.get(token), scope = this.captureScope();
    if (!grant) fail("The local refund approval is unavailable. Request approval again.", "EAPPROVAL_CONTEXT");
    const input = { saleId: recordId(args.saleId), refundId: args.refundId, amount: grant.input.amount };
    if (recordId(args.branchId) !== grant.scope.branchId) fail("The refund branch changed.", "SYNC_BRANCH_FORBIDDEN");
    const bound = { ...scope, amount: input.amount };
    const verifiedTransactions = new WeakSet();
    return { requiresPin: grant.pin, durable: Boolean(grant.basis), hostedGrantToken: grant.hostedGrant,
      matchesSavedEvidence: evidence => {
        try { const statement=approvalEvidence.parseRefundApprovalJson(evidence?.approvalJson);
          return statement.approval.id===grant.approvalId&&statement.approval.policyHash===grant.policyHash&&
            JSON.stringify(statement.basis)===JSON.stringify(grant.basis)&&statement.witness.authorId===scope.requesterId&&statement.witness.subject===scope.requester;
        } catch { return false; }
      },
      verify: async (tx, replayed = false) => { const checked = await this.proof(token, input, bound, tx, replayed); if (tx && !replayed) verifiedTransactions.add(tx); return checked; },
      captureEvidence: async (tx, anchor) => {
        if (!verifiedTransactions.has(tx) || !grant.basis) fail("The durable refund admission was not verified in this transaction.", "EAPPROVAL_CONTEXT");
        if (this.now() >= grant.expires) fail("The refund approval expired before its evidence could be saved.", "EAPPROVAL_EXPIRED");
        grant.scope.assertCurrent(); scope.assertCurrent(); grant.source?.assertCurrent();
        const basis = approvalEvidence.normalizeRefundApprovalBasis({ ...grant.basis, scope: { projectOrigin: anchor.attestation.projectOrigin, ...anchor.source } });
        if (JSON.stringify(basis) !== JSON.stringify(grant.basis) || anchor.anchorKind !== grant.source.anchorKind ||
            anchor.operationId !== basis.operationId || anchor.saleId !== basis.saleId || String(anchor.expectedSaleVersion) !== basis.expectedSaleVersion) fail("The actual refund does not match its verified approval.", "EAPPROVAL_CONTEXT");
        return approvalEvidence.buildRefundApprovalEvidence({ anchorKind: anchor.anchorKind, payloadJson: anchor.payloadJson,
          attestation: anchor.attestation, basis, author: anchor.author, witness: { authorId: scope.requesterId, subject: scope.requester }, approval: { id: grant.approvalId,
            mode: grant.hosted ? "hosted" : grant.pin ? "offline_pin" : "direct",
            approver: grant.pin ? { authorId: recordId(grant.verified.id), subject: grant.verified.username } : null,
            credentialMethod: grant.pin ? grant.method : null, reason: grant.reason, auditId: grant.hosted ? null : grant.approvalId,
            policyHash: grant.policyHash, hostedReceipt: grant.hostedReceipt } });
      },
      assertCurrent: () => { grant.scope.assertCurrent(); scope.assertCurrent(); grant.source?.assertCurrent(); }, complete: () => { grant.committed = true; } };
  }
}
module.exports = { RefundApprovalService, PREFIX, cents, policyFor };
