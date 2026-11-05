const { createHash } = require("node:crypto");
const pages = require("./permission-pages.json");
const { recordId } = require("./sync/uuid-fields.cjs");
const authority = import("./shared/approval-authority.mjs");
const ticketPolicy = import("./shared/approval-ticket.mjs");
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const AUDIT_COLUMNS = ["id", "action_key", "mode_used", "request_id", "requested_by", "authorized_by", "authorizer_role", "store_id", "terminal_id", "outcome", "detail", "created_at"];
const refuse = (message, code = "EAPPROVAL") => { throw Object.assign(new Error(message), { code }); };
const canonical = value => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const json = value => typeof value === "string" ? JSON.parse(value) : value;
const text = (value, max, name) => {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) refuse(`Invalid ${name}.`);
  return value.trim();
};
function input(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) refuse("Invalid approval request.");
  const allowed = new Set(["requestId", "actionKey", "registeredTerminalId", "branchId", "username", "credential", "selfAuthorization", "reason", "snapshot", "payload", "requestedAmount"]);
  if (Object.keys(value).some(key => !allowed.has(key)) || Buffer.byteLength(JSON.stringify(value)) > 256 * 1024) refuse("Invalid or oversized approval request.");
  const requestId = text(value.requestId, 36, "request identity").toLowerCase();
  if (!UUID.test(requestId) || value.actionKey !== "discount_over_limit") refuse("Unsupported offline approval action.");
  const snapshot = JSON.parse(JSON.stringify(value.snapshot));
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !Array.isArray(snapshot.lines) || !snapshot.lines.length || snapshot.lines.length > 300) refuse("A complete ticket of at most 300 lines is required for approval.");
  text(snapshot.ticketId, 80, "ticket identity"); text(snapshot.billNo, 40, "bill reference");
  snapshot.storeId = recordId(text(snapshot.storeId, 128, "ticket branch"));
  for (const line of snapshot.lines) {
    if (!line || typeof line !== "object" || ![line.qty, line.unitPrice, line.discount, line.lineTotal].every(Number.isFinite)) refuse("Invalid approval ticket line.");
  }
  for (const key of ["subtotal", "discount", "tax", "serviceCharge", "total"]) if (!Number.isFinite(snapshot[key])) refuse("Invalid approval ticket totals.");
  if (!Number.isFinite(value.requestedAmount) || value.requestedAmount < 0 || value.requestedAmount > 100) refuse("Invalid discount percentage.");
  if (value.selfAuthorization !== undefined && typeof value.selfAuthorization !== "boolean") refuse("Invalid self-approval identity.");
  if (typeof value.username !== "string" || value.username.length > 120 || typeof value.reason !== "string" || value.reason.length > 1000) refuse("Invalid approval author or reason.");
  const payload = value.payload ?? {};
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.values(payload).some(v => (typeof v === "number" && !Number.isFinite(v)) || (v !== null && !["string", "number", "boolean"].includes(typeof v)))) refuse("Invalid approval context.");
  const payloadKeys = new Set(["bill_no", "transaction", "discount_scope", "requested_discounts", "approval_location"]);
  if (Object.keys(payload).some(key => !payloadKeys.has(key))) refuse("This discount approval contains unrelated context.");
  return { requestId, actionKey: value.actionKey, branchId: recordId(text(value.branchId, 128, "branch")), registeredTerminalId: recordId(text(value.registeredTerminalId, 128, "registered terminal")),
    username: value.username.trim(), credential: text(value.credential, 32, "approval credential"),
    selfAuthorization: value.selfAuthorization === true, reason: value.reason.trim(), requestedAmount: value.requestedAmount, snapshot, payload };
}
const approvalRole = actor => String(actor.role_slug ?? actor.role ?? "staff").toLowerCase();
function actionPermission(actor) {
  if (approvalRole(actor) === "admin") return true;
  const permissions = json(actor.permissions) ?? {};
  const owners = pages.filter(page => page.keys.includes("can_give_discount"));
  return permissions.can_give_discount === true && (!owners.length || owners.some(page => permissions[`page:${page.id}`] !== false));
}
async function validatePolicy(policy, request, verified, scope, credentialMethod = "pin") {
  const shared = await authority;
  const { actor } = policy;
  const requester = policy.requester;
  const requesterPermissions = requester ? json(requester.permissions) ?? {} : {};
  const salePages = pages.filter(page => page.keys.includes("can_process_sale"));
  if (!requester?.is_active || String(requester.id).toLowerCase() !== String(scope.requesterId).toLowerCase() || String(requester.user_id).toLowerCase() !== scope.requester.toLowerCase() || requesterPermissions.can_process_sale !== true || (salePages.length && !salePages.some(page => requesterPermissions[`page:${page.id}`] !== false))) refuse("The requesting account no longer has permission to approve this bill.", "EPRIVILEGE");
  const rawRules = policy.rules ?? (policy.rule ? [policy.rule] : []);
  const applicable = rawRules.map(raw => ({ raw, normalized: shared.normalizeRule(raw) }))
    .filter(item => item.normalized.scopeId === "" || recordId(item.normalized.scopeId) === request.branchId);
  const branchRules = applicable.filter(item => item.normalized.scopeType === "branch" && recordId(item.normalized.scopeId) === request.branchId);
  const globalRules = applicable.filter(item => item.normalized.scopeType === "global");
  const selected = branchRules.length ? branchRules : globalRules;
  if (selected.length > 1) refuse("The applicable approval rules are ambiguous. Review the saved rules before approving.", "EAPPROVAL_POLICY");
  const rawRule = selected[0]?.raw;
  if (rawRule) {
    for (const field of ["allowed_roles", "allowed_user_ids"]) {
      const raw = rawRule[field]; if (raw == null) continue;
      const values = json(raw); if (!Array.isArray(values) || values.some(value => typeof value !== "string")) refuse("The saved approval audience is invalid.", "EAPPROVAL_POLICY");
    }
    for (const field of ["authority_limits", "extra_authority", "absolute_ceilings"]) {
      const raw = rawRule[field]; if (raw == null) continue;
      const values = json(raw); if (!values || typeof values !== "object" || Array.isArray(values) || Object.values(values).some(value => !Number.isFinite(Number(value)) || Number(value) < 0)) refuse("The saved approval limits are invalid.", "EAPPROVAL_POLICY");
    }
  }
  const globals = policy.settings.filter(row => String(row.store_id ?? "").trim() === "");
  const locals = policy.settings.filter(row => recordId(String(row.store_id ?? "").trim()) === request.branchId);
  if (globals.length > 1 || locals.length > 1) refuse("The branch POS settings are ambiguous. Review the saved settings before approving.", "EAPPROVAL_POLICY");
  const global = globals[0] ?? {}, local = locals[0] ?? {};
  const effective = { ...global, ...Object.fromEntries(Object.entries(local).filter(([, value]) => value != null)) };
  const settings = shared.normalizeRules(effective);
  const rule = selected[0]?.normalized ?? { ...shared.defaultRule(request.actionKey), mode: settings.require_pin_manual_discount ? "pin" : "none" };
  if (!actor || !actor.is_active || !rule.isEnabled || !["pin", "either"].includes(rule.mode) || !settings.allow_offline_approvals || settings.online_only_manual_discount) refuse("Current branch policy does not permit this offline approval.", "EAPPROVAL_POLICY");
  if (String(actor.id).toLowerCase() !== String(verified.id).toLowerCase() || String(actor.user_id).toLowerCase() !== String(verified.username).toLowerCase() || !actionPermission(actor)) refuse("This account cannot approve this action.");
  const actorPermissions = json(actor.permissions) ?? {};
  if (actorPermissions["approval_scope:configured"] === true && actorPermissions["approval_scope:all"] !== true && !Object.entries(actorPermissions).some(([key, allowed]) => allowed === true && key.toLowerCase() === `approval_scope:branch:${scope.branchId}`.toLowerCase())) refuse("This account is no longer permitted to approve in this branch.");
  if ((credentialMethod === "pin" && actorPermissions.approval_pin_enabled === false) || (credentialMethod === "totp" && actorPermissions.approval_totp_enabled !== true) || !["pin", "totp"].includes(credentialMethod)) refuse("This approval credential is no longer enabled.");
  if (rule.requireReason && !request.reason) refuse("A reason is required for this approval.");
  if (!Number.isFinite(settings.max_cashier_discount_percent) || settings.max_cashier_discount_percent < 0) refuse("The branch discount limit is unavailable.", "EAPPROVAL_POLICY");
  if (!shared.canAuthorizeAmount(rule, { userId: actor.user_id, role: approvalRole(actor) }, request.requestedAmount, settings.max_cashier_discount_percent)) refuse("This account's approval limit does not cover the requested discount.");
  const person = row => ({ id: recordId(String(row.id)), username: String(row.user_id).toLowerCase(), role: approvalRole(row), active: row.is_active,
    branchId: row.store_id == null ? null : recordId(String(row.store_id).trim()), permissions: json(row.permissions) ?? {} });
  return hash({ rule: { ...rule, scopeId: recordId(rule.scopeId) },
    settings: { allow_offline_approvals: settings.allow_offline_approvals, online_only_manual_discount: settings.online_only_manual_discount, max_cashier_discount_percent: settings.max_cashier_discount_percent },
    actor: person(actor), requester: person(requester) });
}

/** Main-private service. No renderer-selected aggregate label or caller audit row. */
class OfflineApprovalService {
  constructor({ captureScope, verify, store, now = Date.now }) {
    Object.assign(this, { captureScope, verify, store, now }); this.pending = new Map(); this.running = new Map();
  }
  authorize(value) {
    const request = input(value), scope = this.captureScope(); scope.assertCurrent();
    if (request.branchId !== scope.branchId || request.registeredTerminalId !== scope.terminalId || request.snapshot.storeId !== scope.branchId) refuse("The approval does not match this terminal branch.", "SYNC_BRANCH_FORBIDDEN");
    const { credential, username, ...publicRequest } = request;
    const contextHash = hash({ ...publicRequest, authorizerInput: username.toLowerCase(), requester: scope.requester.toLowerCase(), requesterId: scope.requesterId, terminal: scope.terminalId });
    const active = this.running.get(request.requestId);
    if (active) { if (active.contextHash !== contextHash) refuse("This approval identity has different data.", "EIDEMPOTENCY"); return active.promise; }
    if (this.running.size >= 8) refuse("Wait for the current approval checks to finish.", "EAPPROVAL_BUSY");
    const promise = this.perform(request, scope, contextHash).finally(() => this.running.delete(request.requestId));
    this.running.set(request.requestId, { contextHash, promise }); return promise;
  }
  async perform(request, scope, contextHash) {
    const shared = await authority; scope.assertCurrent();
    const ticket = await ticketPolicy; scope.assertCurrent();
    const { payload } = request;
    if (payload.discount_scope !== "ticket") refuse("This native approval requires the complete ticket discount review.");
    const discounts = shared.ticketDiscounts(payload);
    const requiredPercent = ticket.nativeTicketDiscountPercent(request.snapshot, discounts);
    if (requiredPercent === null || request.requestedAmount !== requiredPercent) refuse("Discounts must match the complete, exact bill and its coupon amounts.");
    request.snapshot = ticket.normalizeSnapshot(request.snapshot); scope.assertCurrent();
    const { snapshot } = request;
    if (snapshot.ticketId !== snapshot.billNo || payload.bill_no !== snapshot.billNo) refuse("A discount approval must match one reserved bill number.");
    if ((payload.transaction != null && payload.transaction !== snapshot.billNo) || (payload.approval_location != null && payload.approval_location !== "pos_register")) refuse("The approval context does not match this bill.");
    let saved = this.pending.get(request.requestId);
    if (saved && (saved.contextHash !== contextHash || saved.epoch !== scope.epoch)) refuse("The approval context changed. Request approval again.", "EIDEMPOTENCY");
    if (saved && saved.expires <= this.now()) { this.pending.delete(request.requestId); saved = null; }
    if (!saved) {
      const verified = await this.verify(request.username, request.credential, scope); scope.assertCurrent();
      if (!verified?.ok || !verified.staff) refuse(verified?.error ?? "The approval credential was not accepted.");
      if (request.selfAuthorization && verified.staff.username.toLowerCase() !== request.username.toLowerCase()) refuse("Enter the PIN for the signed-in account.");
      const policy = await this.store.readPolicy(scope, verified.staff.id); scope.assertCurrent();
      const credentialMethod = verified.credentialMethod ?? "pin";
      const policyHash = await validatePolicy(policy, request, verified.staff, scope, credentialMethod); scope.assertCurrent();
      const prior = await this.store.readPrior(request.requestId); scope.assertCurrent();
      if (prior && (prior.contextHash !== contextHash || prior.policyHash !== policyHash || String(prior.requester).toLowerCase() !== scope.requester.toLowerCase() || prior.requesterId !== scope.requesterId || prior.authorizer !== String(verified.staff.id).toLowerCase())) refuse("This approval identity has different saved evidence.", "EIDEMPOTENCY");
      const actor = policy.actor;
      const row = prior?.row ?? { id: request.requestId, action_key: request.actionKey, mode_used: "offline_pin", request_id: null,
        requested_by: scope.requester, authorized_by: actor.user_id, authorizer_role: approvalRole(actor),
        store_id: scope.branchId, terminal_id: scope.terminalId, outcome: "approved", created_at: new Date(this.now()).toISOString(),
        detail: { reason: request.reason, offline: true, credential_method: verified.credentialMethod ?? "pin", approved_by_name: actor.full_name || actor.user_id,
          ticket_reference: request.snapshot.billNo, native_approval: { version: 1, contextHash, policyHash, requester: scope.requester, requesterId: scope.requesterId, authorizer: String(actor.id).toLowerCase() },
          requested_amount: request.requestedAmount, snapshot: request.snapshot, context: request.payload } };
      for (const [id, value] of this.pending) if (value.expires <= this.now()) this.pending.delete(id);
      if (this.pending.size >= 100) refuse("Finish an existing approval before starting another.", "EAPPROVAL_BUSY");
      saved = { contextHash, policyHash, epoch: scope.epoch, expires: this.now() + 15 * 60_000, row, verified: verified.staff, credentialMethod };
      this.pending.set(request.requestId, saved);
    }
    const result = await this.store.persist(scope, request, saved, async policy => {
      scope.assertCurrent(); if (await validatePolicy(policy, request, saved.verified, scope, saved.credentialMethod) !== saved.policyHash) refuse("The approval policy or account changed. Request approval again.", "EAPPROVAL_POLICY"); scope.assertCurrent();
    }); scope.assertCurrent();
    return { ok: true, auditId: request.requestId, replayed: result.replayed === true, authorizer: { id: saved.verified.username, name: saved.row.detail.approved_by_name, role: saved.row.authorizer_role } };
  }
}

class OfflineApprovalStore {
  constructor(manager, operations) { this.manager = manager; this.operations = operations; }
  request(tx) { return tx ? new (this.manager.sql().Request)(tx) : this.manager.pool.request(); }
  async readPolicy(scope, authorizerId, tx) {
    const lock = tx ? " WITH(UPDLOCK,HOLDLOCK)" : "";
    // UUID case is representational; other branch codes retain exact identity.
    // Apply this in SQL as well as JS, including binary-default databases.
    const branchMatch = column => UUID.test(scope.branchId)
      ? `LOWER(CONVERT(nvarchar(450),${column})) COLLATE Latin1_General_100_BIN2=@branch COLLATE Latin1_General_100_BIN2`
      : `${column} COLLATE Latin1_General_100_BIN2=@branch COLLATE Latin1_General_100_BIN2`;
    const ids = [...new Set([authorizerId, scope.requesterId].map(id => String(id).toLowerCase()))].sort();
    if (ids.some(id => !UUID.test(id))) refuse("The verified account identity is unavailable.", "EAPPROVAL_CONTEXT");
    const query = this.request(tx).input("branch", scope.branchId); ids.forEach((id, index) => query.input(`user${index}`, id));
    const result = await query.query(`
      SELECT * FROM dbo.authorization_actions${lock} WHERE action_key=N'discount_over_limit'
      AND (scope_id=N'' OR ${branchMatch("scope_id")}) ORDER BY id;
      SELECT * FROM dbo.pos_store_settings${lock} WHERE store_id=N'' OR ${branchMatch("store_id")} ORDER BY store_id COLLATE Latin1_General_100_BIN2;
      ${ids.map((_, index) => `SELECT id,user_id,full_name,role,role_slug,permissions,is_active,store_id,updated_at FROM dbo.app_users${lock} WHERE id=TRY_CONVERT(uniqueidentifier,@user${index}) AND (store_id IS NULL OR ${branchMatch("store_id")});`).join("\n")}`);
    const people = result.recordsets.slice(2).flat();
    return { rules: result.recordsets[0] ?? [], settings: result.recordsets[1] ?? [], actor: people.find(row => String(row.id).toLowerCase() === String(authorizerId).toLowerCase()), requester: people.find(row => String(row.id).toLowerCase() === String(scope.requesterId).toLowerCase()) };
  }
  async readPrior(id) {
    const result = await this.request().input("id", id).query(`SELECT ${AUDIT_COLUMNS.map(name => `a.[${name}]`).join(",")},r.note,r.operation_type FROM dbo.authorization_log a JOIN dbo.local_operation_receipts r ON r.operation_id=a.id WHERE a.id=TRY_CONVERT(uniqueidentifier,@id);`);
    const row = result.recordset?.[0]; if (!row) return null;
    if (row.operation_type !== "offline_approval_v1") refuse("This approval identity was already used.", "EIDEMPOTENCY");
    const { note, operation_type, ...business } = row; business.detail = json(business.detail); business.id = String(business.id).toLowerCase(); business.created_at = new Date(business.created_at).toISOString();
    if (note !== hash(business)) refuse("Saved approval receipt does not match its audit.", "EIDEMPOTENCY");
    return { ...business.detail.native_approval, row: business };
  }
  async persist(scope, request, saved, verifyPolicy) {
    const row = saved.row, receiptHash = hash(row);
    return this.operations.apply("Recording verified offline discount approval", [{ kind: "insert", table: "authorization_log", rows: [row] }],
      { branchId: scope.branchId, terminalId: scope.terminalId, enforcePermissions: true },
      async tx => {
        scope.assertCurrent(); await this.request(tx).input("id", row.id).input("entity", JSON.stringify({ id: row.id })).input("branch", scope.branchId).input("note", receiptHash).query(`
          INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id)
          VALUES(N'authorization_log',@entity,N'insert',@branch,1,TRY_CONVERT(uniqueidentifier,@id));
          INSERT dbo.local_operation_receipts(operation_id,operation_type,entity_id,note)
          VALUES(TRY_CONVERT(uniqueidentifier,@id),N'offline_approval_v1',@id,@note);`); scope.assertCurrent();
      },
      async tx => {
        scope.assertCurrent(); await verifyPolicy(await this.readPolicy(scope, saved.verified.id, tx)); scope.assertCurrent();
        const prior = await this.request(tx).input("id", row.id).query("SELECT note,operation_type FROM dbo.local_operation_receipts WITH(UPDLOCK,HOLDLOCK) WHERE operation_id=TRY_CONVERT(uniqueidentifier,@id);"); scope.assertCurrent();
        if (!prior.recordset?.length) return true;
        if (prior.recordset[0].operation_type !== "offline_approval_v1" || prior.recordset[0].note !== receiptHash) refuse("This approval identity has different saved data.", "EIDEMPOTENCY");
        const audit = await this.request(tx).input("id", row.id).query(`SELECT ${AUDIT_COLUMNS.map(name => `[${name}]`).join(",")} FROM dbo.authorization_log WITH(UPDLOCK,HOLDLOCK) WHERE id=TRY_CONVERT(uniqueidentifier,@id);`); scope.assertCurrent();
        const actual = audit.recordset?.[0];
        if (!actual) refuse("The saved approval audit is missing.", "EIDEMPOTENCY");
        actual.id = String(actual.id).toLowerCase(); actual.detail = json(actual.detail); actual.created_at = new Date(actual.created_at).toISOString();
        if (hash(actual) !== receiptHash) refuse("Saved approval receipt does not match its audit.", "EIDEMPOTENCY");
        return false;
      }, scope.assertCurrent);
  }
}
function createOfflineApprovalHandler({ isPosSender, authorize }) {
  return (event, value) => {
    if (!isPosSender(event)) return { ok: false, code: "EPRIVILEGE", error: "Offline bill approval is limited to the POS window." };
    return authorize(value);
  };
}
module.exports = { OfflineApprovalService, OfflineApprovalStore, createOfflineApprovalHandler, validatePolicy, hash };
