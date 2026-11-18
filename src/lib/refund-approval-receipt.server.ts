import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { serviceRest, verifyRelayCaller } from "@/core/api/pos-relay.server";
import { resolveRelayScope } from "@/core/api/relay-policy.server";
import { runtimeEnvValue, supabaseConfig } from "./external-supabase-config";
import { normalizeRule, defaultRule, canAuthorizeAmount, canBypassAuthorization, canDecideRequestAmount, isRoutedApprover, type AuthorizationRule } from "./authorization";
import { normalizeRules } from "./pos-rules";
import { approverActionAllowed } from "./approval-action-permissions";
import { approvalPersonBranchAllowed, approvalScopeConfigured } from "./approval-branch-scope";
import { sameBranchId } from "./branch-id";
import { safeReceiptNo } from "./report-data-safety";
import { parseExactJson } from "../../electron/sync/shift-recovery-exact.mjs";
import { normalizeRefundApprovalBasis, normalizeRefundSaleCreatedAt, decodeRefundApprovalEvidence,
  type RefundApprovalBasis, type RefundApprovalPerson, type RefundApprovalAnchor } from "../../electron/sync/refund-approval-evidence.cjs";
import type { VerifiedTerminalDescriptor } from "./terminal-binding.server";
import type { checkBusinessAuthorization } from "./business-authorization.server";

const DOMAIN = "retail-pos.refund-approval-receipt.v1";
const uuid = z.string().regex(/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
const personIdentity = z.object({ authorId: uuid, subject: z.string().min(1).max(200).refine(v => v.trim() === v && !/\p{Cc}/u.test(v)) }).strict();
const personSchema = z.object({ id: uuid, user_id: z.string().min(1).max(200), role: z.string().nullable(),
  role_slug: z.string().nullable(), store_id: z.string().nullable(), is_active: z.boolean(), permissions: z.record(z.string(), z.unknown()).nullable() });
type Person = z.infer<typeof personSchema>;
type CallerProof = { terminalToken?: string; deviceBindingProof?: string; sessionToken?: string; cashierToken?: string; accessToken?: string };
type Authorization = Awaited<ReturnType<typeof checkBusinessAuthorization>>;
const approvalClaims = z.object({ required: z.boolean(), approver: personIdentity.nullable(),
  modeUsed: z.enum(["pin", "self_pin", "request", "admin_auto", "offline_pin", "offline_self_pin"]).nullable(),
  credentialMethod: z.enum(["pin", "totp"]).nullable(), requestId: uuid.nullable(),
  approvedAmountMinor: z.string().regex(/^(0|[1-9]\d{0,15})$/).nullable(), sourceExpiresAt: z.number().int().positive().nullable() }).strict();
const receiptSchema = z.object({ domain: z.literal(DOMAIN), version: z.literal(1), basis: z.unknown(),
  witness: personIdentity, approval: approvalClaims, issuedAt: z.number().int().positive() }).strict();
type Receipt = Omit<z.infer<typeof receiptSchema>, "basis"> & { basis: RefundApprovalBasis };

export class RefundApprovalError extends Error {
  constructor(readonly code = "REFUND_APPROVAL_REQUIRED", readonly status = 403) {
    super(status === 503 ? "The refund authorization is temporarily unavailable. Saved work remains pending."
      : "The exact saved refund authorization could not be verified. Saved work remains pending.");
  }
}
const deny = (): never => { throw new RefundApprovalError(); };
const unavailable = (): never => { throw new RefundApprovalError("REFUND_APPROVAL_UNAVAILABLE", 503); };
const sameIdentity = (a: RefundApprovalPerson, b: RefundApprovalPerson) => a.authorId === b.authorId && a.subject.toLowerCase() === b.subject.toLowerCase();
const origin = () => new URL(supabaseConfig().url).origin;
const role = (p: Person) => p.role_slug || p.role || "staff";
const admin = (p: Person) => p.role === "admin" || p.role_slug === "admin";
const identityOf = (p: Person) => ({ authorId: p.id, subject: p.user_id });
const equalBasis = (a: RefundApprovalBasis, b: RefundApprovalBasis) => JSON.stringify(a) === JSON.stringify(b);

/** Exact cents only. Decimal SQL padding is not rounded into another amount. */
export function refundApprovalAmountMinor(value: unknown): string {
  const raw = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (typeof raw !== "string" || !/^-?\d{1,80}(?:\.\d{1,80})?$/.test(raw)) return deny();
  const [whole, decimals = ""] = raw.replace(/^-/, "").split(".");
  if (/[1-9]/.test(decimals.slice(2))) return deny();
  const amount = BigInt(whole) * 100n + BigInt(decimals.slice(0, 2).padEnd(2, "0"));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) return deny();
  return amount.toString();
}
async function readRows(path: string, signal?: AbortSignal): Promise<Record<string, unknown>[]> {
  let response: Response;
  try { response = await serviceRest(path, signal ? { signal } : {}); }
  catch { return unavailable(); }
  if (!response.ok) return unavailable();
  try {
    const { boundedText } = await import("../../electron/sync/shift-recovery-exact.mjs");
    const raw = await boundedText(response, 128 * 1024);
    parseExactJson(raw, { maxBytes: 128 * 1024, maxDepth: 12 });
    const rows: unknown = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.length > 4 || rows.some(row => !row || typeof row !== "object" || Array.isArray(row))) return unavailable();
    return rows as Record<string, unknown>[];
  } catch (error) { if (error instanceof RefundApprovalError) throw error; return unavailable(); }
}
async function person(who: RefundApprovalPerson, branch: string, signal?: AbortSignal, routedRequest = false): Promise<Person> {
  const rows = await readRows(`app_users?id=eq.${encodeURIComponent(who.authorId)}&select=id,user_id,role,role_slug,store_id,is_active,permissions&limit=2`, signal);
  const parsed = rows.length === 1 ? personSchema.safeParse(rows[0]) : null;
  if (!parsed?.success) return deny();
  const p = parsed.data;
  if (!p.is_active || p.id !== who.authorId || p.user_id.toLowerCase() !== who.subject.toLowerCase() ||
      (p.store_id && !sameBranchId(p.store_id, branch) && !routedRequest) ||
      !approverActionAllowed("refund", { role: p.role, roleSlug: p.role_slug, permissions: p.permissions })) return deny();
  return p;
}
async function personBySubject(subject: string, branch: string, signal?: AbortSignal, routedRequest = false): Promise<Person> {
  const rows = await readRows(`app_users?user_id=eq.${encodeURIComponent(subject)}&select=id,user_id,role,role_slug,store_id,is_active,permissions&limit=2`, signal);
  const parsed = rows.length === 1 ? personSchema.safeParse(rows[0]) : null;
  if (!parsed?.success || parsed.data.user_id.toLowerCase() !== subject.toLowerCase()) return deny();
  return person(identityOf(parsed.data), branch, signal, routedRequest);
}
async function currentPolicy(basis: RefundApprovalBasis, signal?: AbortSignal) {
  const branch = encodeURIComponent(basis.scope.branchId);
  const [rows, settingsRows] = await Promise.all([
    readRows(`authorization_actions?action_key=eq.refund&or=(scope_id.eq.,scope_id.eq.${branch})&select=*&limit=3`, signal),
    readRows(`pos_store_settings?or=(store_id.eq.,store_id.eq.${branch})&select=store_id,allow_offline_approvals,online_only_refund,max_refund_days_limit,require_manager_pin_for_refund&limit=3`, signal),
  ]);
  const candidates = rows.map(raw => ({ raw, rule: normalizeRule(raw) })).filter(({ rule }) =>
    rule.actionKey === "refund" && ((rule.scopeType === "global" && rule.scopeId === "") ||
      (rule.scopeType === "branch" && sameBranchId(rule.scopeId, basis.scope.branchId))));
  const branchRows = candidates.filter(row => row.rule.scopeType === "branch");
  const chosen = branchRows.length ? branchRows : candidates.filter(row => row.rule.scopeType === "global");
  if (chosen.length > 1) return deny();
  const raw = chosen[0]?.raw;
  if (raw) {
    if (!["none", "pin", "request", "either"].includes(String(raw.mode)) || typeof raw.is_enabled !== "boolean") return deny();
    for (const field of ["allowed_roles", "allowed_user_ids"]) {
      if (raw[field] == null) continue;
      let values = raw[field]; try { if (typeof values === "string") values = JSON.parse(values); } catch { return deny(); }
      if (!Array.isArray(values) || values.some(v => typeof v !== "string")) return deny();
    }
    for (const field of ["authority_limits", "extra_authority", "absolute_ceilings"]) {
      if (raw[field] == null) continue;
      let values = raw[field]; try { if (typeof values === "string") values = JSON.parse(values); } catch { return deny(); }
      if (!values || typeof values !== "object" || Array.isArray(values) || Object.values(values).some(v => !Number.isFinite(Number(v)) || Number(v) < 0)) return deny();
    }
  }
  const globals = settingsRows.filter(row => row.store_id === "");
  const local = settingsRows.filter(row => typeof row.store_id === "string" && sameBranchId(row.store_id, basis.scope.branchId));
  if (globals.length > 1 || local.length > 1) return deny();
  const settings = normalizeRules({ ...globals[0], ...Object.fromEntries(Object.entries(local[0] ?? {}).filter(([, v]) => v != null)) });
  if (!Number.isFinite(settings.max_refund_days_limit) || settings.max_refund_days_limit < 0) return deny();
  const rule = chosen[0]?.rule ?? { ...defaultRule("refund"), mode: settings.require_manager_pin_for_refund ? "pin" as const : "none" as const };
  return { rule, settings, explicit: chosen.length === 1 };
}
function actualSaleCreatedAt(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return deny();
  try { return normalizeRefundSaleCreatedAt(new Date(value).toISOString()); } catch { return deny(); }
}
async function canonicalSale(basis: RefundApprovalBasis, signal?: AbortSignal, allowAbsentFinancial = false) {
  const rows = await readRows(`sales?id=eq.${encodeURIComponent(basis.saleId)}&store_id=eq.${encodeURIComponent(basis.scope.branchId)}&select=id,store_id,bill_number,total_amount::text,row_version::text,created_at,is_refunded&limit=2`, signal);
  if (rows.length === 0 && allowAbsentFinancial) return null;
  const sale = rows.length === 1 ? rows[0] : null;
  if (!sale || sale.id !== basis.saleId || typeof sale.store_id !== "string" || !sameBranchId(sale.store_id, basis.scope.branchId) ||
      String(sale.row_version) !== basis.expectedSaleVersion || refundApprovalAmountMinor(sale.total_amount) !== basis.amountMinor ||
      sale.is_refunded !== false || !(sale.bill_number === null || typeof sale.bill_number === "string") ||
      actualSaleCreatedAt(sale.created_at) !== basis.saleCreatedAt) return deny();
  return sale;
}
const withinAuthority = (rule: AuthorizationRule, p: Person, amountMinor: string) =>
  canAuthorizeAmount(rule, { userId: p.user_id, role: role(p) }, Number(amountMinor) / 100);
function methodAllowed(p: Person, method: "pin" | "totp" | null) {
  const permissions = p.permissions ?? {};
  return method === "pin" ? permissions.approval_pin_enabled !== false
    : method === "totp" && permissions.approval_totp_enabled === true;
}
async function checkApprovalPolicy(basis: RefundApprovalBasis, witness: RefundApprovalPerson,
  approval: { mode: "direct" | "offline_pin" | "hosted"; approver?: RefundApprovalPerson | null;
    credentialMethod?: "pin" | "totp" | null; reason?: string | null; claims?: Receipt["approval"] }, signal?: AbortSignal,
  allowAbsentFinancial = false) {
  const [original, currentWitness, policy, sale] = await Promise.all([
    person(basis.requester, basis.scope.branchId, signal), person(witness, basis.scope.branchId, signal),
    currentPolicy(basis, signal), canonicalSale(basis, signal, allowAbsentFinancial),
  ]);
  void original;
  // Hosted grant verification already uses this central no-row default.
  // The native PIN path retains the existing branch POS gate fallback.
  const rule = approval.mode === "hosted" && !policy.explicit ? defaultRule("refund") : policy.rule;
  const { settings } = policy;
  // A missing FIN62 business row stays absent: its signed Main date is only
  // refund eligibility evidence, never a fabricated canonical record/receipt.
  const createdAt = sale === null ? basis.saleCreatedAt : actualSaleCreatedAt(sale.created_at);
  const age = Date.now() - Date.parse(createdAt);
  if (!Number.isFinite(age) || age < -300000 || (settings.max_refund_days_limit > 0 && age > settings.max_refund_days_limit * 86400000)) return deny();
  const direct = !rule.isEnabled || rule.mode === "none" || canBypassAuthorization(rule, { userId: currentWitness.user_id, role: admin(currentWitness) ? "admin" : role(currentWitness) }, Number(basis.amountMinor) / 100);
  if (approval.mode === "direct") {
    if (!direct || settings.online_only_refund) return deny();
    return { witness: currentWitness, approver: null };
  }
  if (approval.mode === "hosted" && approval.claims?.required === false) {
    if (!direct) return deny();
    return { witness: currentWitness, approver: null };
  }
  const claims = approval.claims;
  const identity = approval.mode === "hosted" ? claims?.approver : approval.approver;
  if (!identity) return deny();
  const requestMode = approval.mode === "hosted" && claims?.modeUsed === "request";
  const manager = await person(identity, basis.scope.branchId, signal, requestMode);
  if (!approvalPersonBranchAllowed(manager, basis.scope.branchId) || !rule.isEnabled) return deny();
  if (approval.mode === "offline_pin") {
    if (!settings.allow_offline_approvals || settings.online_only_refund || !["pin", "either"].includes(rule.mode) ||
        !withinAuthority(rule, manager, basis.amountMinor) || !methodAllowed(manager, approval.credentialMethod ?? null) ||
        (rule.requireReason && !approval.reason?.trim())) return deny();
  } else {
    if (!claims || !claims.required || !claims.approvedAmountMinor || BigInt(claims.approvedAmountMinor) < BigInt(basis.amountMinor)) return deny();
    if (claims.modeUsed === "request") {
      if (!["request", "either"].includes(rule.mode) || !claims.requestId) return deny();
      const { getRequest } = await import("./authorization.server");
      let request: Awaited<ReturnType<typeof getRequest>>;
      try { request = await getRequest(claims.requestId); } catch { return unavailable(); }
      if (!request || request.status !== "approved" || !request.consumedAt || request.requestedBy.toLowerCase() !== witness.subject.toLowerCase() ||
          request.actionKey !== "refund" || !sameBranchId(request.storeId, basis.scope.branchId) ||
          request.decidedBy?.toLowerCase() !== manager.user_id.toLowerCase() || request.approvedAmount == null ||
          BigInt(refundApprovalAmountMinor(request.approvedAmount)) < BigInt(basis.amountMinor) ||
          !isRoutedApprover(request, { userId: manager.user_id }) ||
          // Match the existing named request exception. A generic PIN or an
          // explicitly restricted approver never gains another branch here.
          (manager.store_id && !sameBranchId(manager.store_id, basis.scope.branchId) &&
            (!request.approvalRoute || approvalScopeConfigured(manager.permissions ?? {}))) ||
          !canDecideRequestAmount(rule, { userId: manager.user_id, role: role(manager) }, { ...request, requesterDirectLimit: 0 }, Number(basis.amountMinor) / 100)) return deny();
    } else if (claims.modeUsed === "admin_auto") {
      if (!sameIdentity(identityOf(manager), witness) || !direct) return deny();
    } else {
      // Existing central self-PIN admission also covers a request-mode rule
      // when the current operator is independently eligible to authorize it.
      const self = claims.modeUsed === "self_pin" || claims.modeUsed === "offline_self_pin";
      if ((self ? !sameIdentity(identityOf(manager), witness) : !["pin", "either"].includes(rule.mode)) ||
          !withinAuthority(rule, manager, basis.amountMinor) || !methodAllowed(manager, claims.credentialMethod)) return deny();
    }
  }
  return { witness: currentWitness, approver: manager };
}
function receiptKey() {
  const raw = runtimeEnvValue("SETTINGS_ENCRYPTION_KEY");
  if (!raw || raw.length < 1) return unavailable();
  return createHmac("sha256", raw).update(DOMAIN, "utf8").digest();
}
function sealReceipt(value: Receipt): string {
  const body = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return body + "." + createHmac("sha256", receiptKey()).update(body).digest("base64url");
}
function readReceipt(raw: string): Receipt {
  if (typeof raw !== "string" || raw.length > 32768 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(raw)) return deny();
  const [body, signature] = raw.split(".");
  const expected = createHmac("sha256", receiptKey()).update(body).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || actual.toString("base64url") !== signature || !timingSafeEqual(actual, expected)) return deny();
  try {
    const json = Buffer.from(body, "base64url").toString("utf8");
    parseExactJson(json, { maxBytes: 24 * 1024, maxDepth: 10 });
    const value = receiptSchema.parse(JSON.parse(json));
    const basis = normalizeRefundApprovalBasis(value.basis);
    if (value.issuedAt > Date.now() + 300000 || (value.approval.required && (!value.approval.approver || !value.approval.modeUsed ||
        !value.approval.sourceExpiresAt || value.approval.sourceExpiresAt < value.issuedAt)) ||
        (!value.approval.required && [value.approval.approver, value.approval.modeUsed, value.approval.credentialMethod, value.approval.requestId,
          value.approval.approvedAmountMinor, value.approval.sourceExpiresAt].some(v => v !== null))) return deny();
    return { ...value, basis };
  } catch (error) { if (error instanceof RefundApprovalError) throw error; return deny(); }
}

/** Opt-in only: a single exact native operation, never an expiring session bearer. */
export async function issueRefundApprovalReceipt(input: { basis: unknown; witness: unknown; proof: CallerProof; authorization: Authorization; signal?: AbortSignal }): Promise<string> {
  let basis: RefundApprovalBasis, witness: RefundApprovalPerson;
  try { basis = normalizeRefundApprovalBasis(input.basis); witness = personIdentity.parse(input.witness); } catch { return deny(); }
  if (!input.authorization.ok || basis.scope.projectOrigin !== origin()) return deny();
  const caller = await verifyRelayCaller(input.proof, { strictAvailability: true, requireBoundCashier: true });
  const terminal = caller.terminal;
  if (caller.kind === "terminal" || !terminal || terminal.platform !== "pc" || terminal.mode !== "operations" ||
      terminal.id !== basis.scope.terminalId || !sameBranchId(terminal.branchId, basis.scope.branchId)) return deny();
  const current = await resolveRelayScope(caller, { strictAvailability: true });
  if (current.stale || current.managementDevice || current.managementReplica || current.appUserId !== witness.authorId ||
      current.staffUserId?.toLowerCase() !== witness.subject.toLowerCase() || current.terminalId !== terminal.id ||
      !sameBranchId(current.storeId, basis.scope.branchId)) return deny();
  const authorization = input.authorization;
  let claims: Receipt["approval"] = { required: false, approver: null, modeUsed: null, credentialMethod: null,
    requestId: null, approvedAmountMinor: null, sourceExpiresAt: null };
  if (authorization.required) {
    const grant = authorization.grant;
    if (grant.action !== "refund" || !sameBranchId(grant.storeId, basis.scope.branchId) || !Number.isSafeInteger(grant.exp) || grant.exp <= Date.now()) return deny();
    const mode = grant.modeUsed ?? (grant.requestId ? "request" : "pin");
    const manager = await personBySubject(grant.approvedBy, basis.scope.branchId, input.signal, mode === "request");
    const method = grant.credentialMethod ?? null;
    if (!["request", "admin_auto"].includes(mode) && !method) return deny();
    claims = approvalClaims.parse({ required: true, approver: identityOf(manager), modeUsed: mode,
      credentialMethod: method, requestId: grant.requestId ?? null,
      approvedAmountMinor: grant.approvedAmount == null ? null : refundApprovalAmountMinor(grant.approvedAmount), sourceExpiresAt: grant.exp });
  }
  await checkApprovalPolicy(basis, witness, { mode: "hosted", claims }, input.signal);
  const issuedAt = Date.now();
  if (claims.sourceExpiresAt !== null && claims.sourceExpiresAt <= issuedAt) return deny();
  return sealReceipt({ domain: DOMAIN, version: 1, basis, witness, approval: claims, issuedAt });
}

/** Committed evidence outlives its admission handle. Current authority does not. */
export async function verifyRefundApprovalEvidence(input: { evidence: unknown; anchor: RefundApprovalAnchor;
  terminal: VerifiedTerminalDescriptor; signal?: AbortSignal }) {
  let saved: ReturnType<typeof decodeRefundApprovalEvidence>;
  try { saved = decodeRefundApprovalEvidence(input.evidence, input.anchor); } catch { return deny(); }
  const { basis, witness, approval } = saved;
  if (basis.scope.projectOrigin !== origin() || input.terminal.platform !== "pc" || input.terminal.mode !== "operations" ||
      input.terminal.id !== basis.scope.terminalId || !sameBranchId(input.terminal.branchId, basis.scope.branchId)) return deny();
  const { verifyFinancialAuthorAttestation } = await import("./shift-author-verification.server");
  await Promise.all([
    verifyFinancialAuthorAttestation({ attestation: input.anchor.attestation, payloadJson: input.anchor.payloadJson,
      terminal: input.terminal, branchId: basis.scope.branchId, operationId: basis.operationId, action: "REFUND" }),
    verifyFinancialAuthorAttestation({ attestation: saved.approvalAttestation, payloadJson: (input.evidence as { approvalJson: string }).approvalJson,
      terminal: input.terminal, branchId: basis.scope.branchId, operationId: basis.operationId, action: "REFUND" }),
  ]);
  // Cryptographic history checks precede fresh actor grants; an approval does
  // not enroll/revive an author or turn a reviewer into the original cashier.
  const { readFinancialAuthorPermission } = await import("./shift-author-verification.server");
  const authorities = await Promise.all([readFinancialAuthorPermission(input.anchor.attestation, { allowAdminRefund: true }),
    readFinancialAuthorPermission(saved.approvalAttestation, { allowAdminRefund: true })]);
  if (authorities.some(authority => !authority.allowed)) return deny();
  let allowAbsentFinancial = false;
  if (saved.anchorKind === "financial") {
    const { parseFinancialOperation } = await import("./sync-financial-operation.server");
    let event: ReturnType<typeof parseFinancialOperation>;
    try { event = parseFinancialOperation(input.anchor.payloadJson); } catch { return deny(); }
    const change = event.changes[0];
    if (event.action !== "REFUND" || event.changes.length !== 1 || !change.before || !change.after ||
        change.before.isRefunded === true || change.after.isRefunded !== true || event.operationId !== basis.operationId ||
        event.branchId !== basis.scope.branchId || event.terminalId !== basis.scope.terminalId || change.saleId !== basis.saleId ||
        change.before.rowVersion !== basis.expectedSaleVersion || refundApprovalAmountMinor(change.before.totalAmount) !== basis.amountMinor) return deny();
    // The ordinary SQL event/business writers still prove accepted predecessor
    // lineage and exact before/after financial facts. This permits their normal
    // metadata-first order without pretending those rows were uploaded yet.
    allowAbsentFinancial = true;
  }
  if (approval.mode === "hosted") {
    const receipt = readReceipt(approval.hostedReceipt!);
    if (!equalBasis(receipt.basis, basis) || !sameIdentity(receipt.witness, witness)) return deny();
    await checkApprovalPolicy(basis, witness, { mode: "hosted", claims: receipt.approval }, input.signal, allowAbsentFinancial);
  } else {
    await checkApprovalPolicy(basis, witness, approval, input.signal, allowAbsentFinancial);
  }
  return saved;
}

/** Endpoint compares its ordinary grant binding with the canonical native sale. */
export async function verifyRefundApprovalIssueBasis(basisValue: unknown, data: { storeId: string; requestedAmount?: number | null;
  payload: Record<string, string | number | boolean | null> }, signal?: AbortSignal) {
  let basis: RefundApprovalBasis;
  try { basis = normalizeRefundApprovalBasis(basisValue); } catch { return deny(); }
  const sale = await canonicalSale(basis, signal);
  if (!sale) return deny();
  if (!sameBranchId(data.storeId, basis.scope.branchId) || data.payload.sale_id !== basis.saleId ||
      data.requestedAmount == null || refundApprovalAmountMinor(data.requestedAmount) !== basis.amountMinor ||
      data.payload.receipt_no !== safeReceiptNo(sale.bill_number, basis.saleId) || refundApprovalAmountMinor(data.payload.total) !== basis.amountMinor) return deny();
  return basis;
}
