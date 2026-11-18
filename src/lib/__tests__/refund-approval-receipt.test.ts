import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { normalizeRefundApprovalBasis, type RefundApproval, type RefundApprovalBasis, type RefundApprovalPerson } from "../../../electron/sync/refund-approval-evidence.cjs";
import { issueRefundApprovalReceipt, verifyRefundApprovalEvidence, verifyRefundApprovalIssueBasis, refundApprovalAmountMinor } from "../refund-approval-receipt.server";
const { stableRefundUuid } = createRequire(import.meta.url)("../../../electron/sync/refund-command.cjs") as {
  stableRefundUuid(input: Record<string, string>): string;
};

const f = vi.hoisted(() => ({ rest: vi.fn(), caller: vi.fn(), scope: vi.fn(), signature: vi.fn(), permission: vi.fn(), request: vi.fn(), cashier: vi.fn(), session: vi.fn() }));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: f.rest, verifyRelayCaller: f.caller }));
vi.mock("@/core/api/relay-policy.server", () => ({ resolveRelayScope: f.scope }));
vi.mock("../external-supabase-config", () => ({ supabaseConfig: () => ({ url: "https://refund.example.test" }), runtimeEnvValue: () => "isolated-refund-signing-fixture-key" }));
vi.mock("../shift-author-verification.server", () => ({ verifyFinancialAuthorAttestation: f.signature, readFinancialAuthorPermission: f.permission }));
vi.mock("../authorization.server", () => ({ getRequest: f.request }));
vi.mock("@/lib/pos-session.server", () => ({ verifyCashierSession: f.cashier }));
vi.mock("@/lib/session-guard.server", () => ({ touchSession: f.session }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const requester = { authorId: id(1), subject: "cashier" };
const manager = { authorId: id(2), subject: "manager" };
const reviewer = { authorId: id(3), subject: "reviewer" };
const terminal = { id: id(4), branchId: "A", platform: "pc" as const, mode: "operations" as const };
const refundKey = `refund:${id(5)}`;
const saleCreatedAt = "2026-11-17T01:00:00.000Z";
const scope = { projectOrigin: "https://refund.example.test", branchId: "A", terminalId: terminal.id,
  databaseGuid: id(6), feedEpoch: id(7), installationGeneration: id(8) };
const basis = () => normalizeRefundApprovalBasis({ operationId: stableRefundUuid({ refundId: refundKey }), refundKey, saleId: id(5),
  expectedSaleVersion: "1", amountMinor: "1230", saleCreatedAt, scope, requester });
const person = (identity: RefundApprovalPerson, role: string) => ({ id: identity.authorId, user_id: identity.subject,
  role, role_slug: role, is_active: true, store_id: "A", permissions: { can_process_refund: true, approval_pin_enabled: true, approval_totp_enabled: true } as Record<string, unknown> });
let people: ReturnType<typeof person>[], rules: Record<string, unknown>[], settings: Record<string, unknown>[], sale: Record<string, unknown>;
let missingSale = false;
const digest = (raw: string) => createHash("sha256").update(raw).digest("hex");
function attestation(who: RefundApprovalPerson, payloadJson: string, keyId = id(20)) {
  return { version: 1, algorithm: "Ed25519", keyId, projectOrigin: scope.projectOrigin, terminalId: terminal.id,
    authorId: who.authorId, subject: who.subject, branchId: "A", operationId: basis().operationId, action: "REFUND",
    payloadHash: digest(payloadJson), signature: Buffer.alloc(64).toString("base64url") };
}
function evidence(approval: RefundApproval, witness = requester, bound = basis(), anchorKind: "grouped" | "financial" = "grouped") {
  const before = { id: bound.saleId, branchId: bound.scope.branchId, shiftId: id(40), totalAmount: "12.30", paymentType: "Cash", paymentsJson: null,
    discountAmount: "0", isRefunded: false, rowVersion: "1" };
  const payloadJson = JSON.stringify(anchorKind === "financial" ? { version: 1, operationId: bound.operationId, branchId: bound.scope.branchId,
    terminalId: bound.scope.terminalId, shiftId: id(40), openingOrigin: { localAggregateId: id(41), rowHash: "a".repeat(64) },
    sequence: "2", predecessorOperationId: id(42), predecessorHash: "b".repeat(64), action: "REFUND",
    changes: [{ saleId: bound.saleId, before, after: { ...before, isRefunded: true, rowVersion: "2" } }] }
    : { original: "immutable refund fixture", saleId: bound.saleId });
  const original = attestation(requester, payloadJson);
  const approvalJson = JSON.stringify({ domain: "retail-pos.native-refund-approval.v1", version: 1, anchorKind,
    payloadHash: digest(payloadJson), basis: bound, witness, approval });
  return { evidence: { approvalJson, approvalAttestation: attestation(witness, approvalJson, witness === requester ? id(20) : id(21)) },
    terminal, anchor: { anchorKind, payloadJson, attestation: original, operationId: bound.operationId,
      saleId: bound.saleId, expectedSaleVersion: bound.expectedSaleVersion, amountMinor: bound.amountMinor } };
}
function approval(mode: RefundApproval["mode"], receipt: string | null = null): RefundApproval {
  return { id: id(10), mode, approver: mode === "offline_pin" ? manager : null,
    credentialMethod: mode === "offline_pin" ? "pin" : null, reason: "Reviewed exact saved refund", auditId: mode === "offline_pin" ? id(10) : null,
    policyHash: "a".repeat(64), hostedReceipt: receipt };
}
const proof = { terminalToken: terminal.id, deviceBindingProof: "a".repeat(64), sessionToken: "fixture-person-proof" };
const hostedGrant = () => ({ ok: true as const, required: true as const, grant: { action: "refund", approvedBy: "manager", role: "manager",
  modeUsed: "pin" as const, credentialMethod: "pin" as const, storeId: "A", binding: "verified-original-binding", approvedAmount: 12.3, exp: Date.now() + 1000 } });

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-18T01:00:00Z")); vi.clearAllMocks();
  missingSale = false;
  people = [person(requester, "staff"), person(manager, "manager"), person(reviewer, "manager")];
  rules = [{ action_key: "refund", scope_type: "branch", scope_id: "A", mode: "pin", is_enabled: true,
    allowed_roles: ["manager", "admin"], allowed_user_ids: [], authority_limits: {}, extra_authority: {}, absolute_ceilings: {}, require_reason: true }];
  settings = [{ store_id: "", allow_offline_approvals: true, online_only_refund: false, max_refund_days_limit: 30, require_manager_pin_for_refund: true }];
  sale = { id: id(5), store_id: "A", bill_number: "A-123", total_amount: "12.300000000000", row_version: "1", is_refunded: false, created_at: saleCreatedAt };
  f.caller.mockResolvedValue({ kind: "cashier", terminal });
  f.scope.mockResolvedValue({ stale: false, appUserId: requester.authorId, staffUserId: requester.subject, terminalId: terminal.id, storeId: "A" });
  f.signature.mockImplementation(async ({ attestation: value }) => value);
  f.permission.mockResolvedValue({ allowed: true });
  f.request.mockResolvedValue(null);
  f.cashier.mockResolvedValue(null); f.session.mockResolvedValue({ ok: false, reason: "revoked" });
  f.rest.mockImplementation(async (path: string) => {
    const url = new URL(path, "https://fixture.test");
    if (url.pathname === "/app_users") {
      const user = url.searchParams.get("id")?.slice(3), subject = url.searchParams.get("user_id")?.slice(3);
      return Response.json(people.filter(p => user ? p.id === user : p.user_id === subject));
    }
    if (url.pathname === "/authorization_actions") return Response.json(rules);
    if (url.pathname === "/pos_store_settings") return Response.json(settings);
    if (url.pathname === "/sales") return Response.json(missingSale ? [] : [sale]);
    throw Error("Unexpected synthetic read");
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

async function realCallerFixture(email: string | null = "cashier@example.test") {
  const actual = await vi.importActual<typeof import("@/core/api/pos-relay.server")>("@/core/api/pos-relay.server");
  f.caller.mockImplementation(actual.verifyRelayCaller);
  const read = f.rest.getMockImplementation();
  f.rest.mockImplementation(async (path: string) => path.startsWith("terminal_tokens?") ? Response.json([{
    id: terminal.id, platform: "pc", status: "active", location_id: "A", revoked_at: null,
    is_claimed: true, claimed_at: "2026-11-17T01:00:00Z", claim_proof: "a".repeat(64), claimed_platform: "electron",
  }]) : read!(path));
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id: id(50), email }));
}

describe("durable exact-operation hosted refund approval", () => {
  it("accepts the current named Auth person on a verified operations PC without requiring another PIN login", async () => {
    const auth = await realCallerFixture();
    const receipt = await issueRefundApprovalReceipt({ basis: basis(), witness: requester,
      proof: { terminalToken: terminal.id, deviceBindingProof: "a".repeat(64), accessToken: "current-human-auth-proof" }, authorization: hostedGrant() });
    expect(receipt).toEqual(expect.any(String)); expect(auth).toHaveBeenCalledOnce();
    expect(f.caller).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "current-human-auth-proof" }),
      { strictAvailability: true, rejectUnboundCashier: true });
    expect(f.rest.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  });
  it("retains verified revocable PIN sessions bound to this same terminal", async () => {
    const auth = await realCallerFixture();
    f.session.mockResolvedValue({ ok: true, session: { kind: "cashier", staff_user_id: requester.subject,
      branch_id: "A", terminal_id: terminal.id } });
    f.cashier.mockResolvedValue({ id: requester.authorId, username: requester.subject, storeId: "A", terminalId: terminal.id,
      sessionToken: proof.sessionToken });
    await expect(issueRefundApprovalReceipt({ basis: basis(), witness: requester, proof: { ...proof, cashierToken: "bound-cashier-envelope" },
      authorization: hostedGrant() })).resolves.toEqual(expect.any(String));
    expect(auth).not.toHaveBeenCalled();
  });
  it.each(["unbound-cashier", "revoked-session", "wrong-device", "machine-account", "missing-email"])("keeps real caller denial for %s", async kind => {
    const auth = await realCallerFixture(kind === "machine-account" ? "terminal@pos.local" : kind === "missing-email" ? null : "cashier@example.test");
    const supplied: Parameters<typeof issueRefundApprovalReceipt>[0]["proof"] = {
      terminalToken: terminal.id, deviceBindingProof: "a".repeat(64), accessToken: "current-human-auth-proof",
    };
    if (kind === "unbound-cashier") {
      supplied.cashierToken = "unbound-cashier-envelope"; delete supplied.accessToken;
      f.cashier.mockResolvedValue({ id: requester.authorId, username: requester.subject, storeId: "A", terminalId: terminal.id,
        sessionToken: "unverified-raw-session" });
    }
    if (kind === "revoked-session") supplied.sessionToken = "revoked-person-session";
    if (kind === "wrong-device") supplied.deviceBindingProof = "b".repeat(64);
    await expect(issueRefundApprovalReceipt({ basis: basis(), witness: requester, proof: supplied, authorization: hostedGrant() })).rejects.toThrow();
    if (["unbound-cashier", "revoked-session", "wrong-device"].includes(kind)) expect(auth).not.toHaveBeenCalled();
  });
  it("survives source bearer expiry/restart while retaining original+witness signatures and fresh current approval", async () => {
    const receipt = await issueRefundApprovalReceipt({ basis: basis(), witness: requester, proof, authorization: hostedGrant() });
    expect(receipt).not.toContain("fixture-person-proof"); expect(receipt).not.toContain("verified-original-binding");
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    const result = await verifyRefundApprovalEvidence(evidence(approval("hosted", receipt)));
    expect(result.basis.operationId).toBe(basis().operationId); expect(f.signature).toHaveBeenCalledTimes(2); expect(f.permission).toHaveBeenCalledTimes(2);
    expect(f.rest.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  });
  it("binds a distinct current recovery reviewer without changing or reviving the original cashier", async () => {
    f.scope.mockResolvedValue({ appUserId: reviewer.authorId, staffUserId: reviewer.subject, terminalId: terminal.id, storeId: "A" });
    const receipt = await issueRefundApprovalReceipt({ basis: basis(), witness: reviewer, proof, authorization: hostedGrant() });
    const result = await verifyRefundApprovalEvidence(evidence(approval("hosted", receipt), reviewer));
    expect(result.basis.requester).toEqual(requester); expect(result.witness).toEqual(reviewer);
    people[0].is_active = false;
    await expect(verifyRefundApprovalEvidence(evidence(approval("hosted", receipt), reviewer))).rejects.toMatchObject({ status: 403 });
  });
  it("checks financial companions without inventing grouped feed/installation identifiers", async () => {
    const { feedEpoch: _epoch, installationGeneration: _generation, ...financialScope } = scope;
    const financial = normalizeRefundApprovalBasis({ ...basis(), scope: financialScope });
    await expect(verifyRefundApprovalEvidence(evidence(approval("offline_pin"), requester, financial, "financial"))).resolves.toMatchObject({ anchorKind: "financial" });
  });
  it("permits a signed FIN62 refund before its new sale business row uploads while retaining age and current manager policy", async () => {
    const { feedEpoch: _epoch, installationGeneration: _generation, ...financialScope } = scope;
    const financial = normalizeRefundApprovalBasis({ ...basis(), scope: financialScope });
    missingSale = true;
    await expect(verifyRefundApprovalEvidence(evidence(approval("offline_pin"), requester, financial, "financial"))).resolves.toMatchObject({ basis: { saleCreatedAt } });
    settings[0].max_refund_days_limit = 0.5;
    await expect(verifyRefundApprovalEvidence(evidence(approval("offline_pin"), requester, financial, "financial"))).rejects.toMatchObject({ status: 403 });
    settings[0].max_refund_days_limit = 30; people[1].permissions.can_process_refund = false;
    await expect(verifyRefundApprovalEvidence(evidence(approval("offline_pin"), requester, financial, "financial"))).rejects.toMatchObject({ status: 403 });
  });
  it("never substitutes a missing canonical sale during hosted issue or grouped upload", async () => {
    missingSale = true;
    await expect(issueRefundApprovalReceipt({ basis: basis(), witness: requester, proof, authorization: hostedGrant() })).rejects.toMatchObject({ status: 403 });
    await expect(verifyRefundApprovalEvidence(evidence(approval("offline_pin")))).rejects.toMatchObject({ status: 403 });
  });
  it("requires the signed eligibility date to match an existing canonical sale and normalizes its SQL offset", async () => {
    sale.created_at = "2026-11-17T09:00:00+08:00";
    await expect(verifyRefundApprovalEvidence(evidence(approval("offline_pin")))).resolves.toBeDefined();
    sale.created_at = "2026-10-17T01:00:00.000Z";
    await expect(verifyRefundApprovalEvidence(evidence(approval("offline_pin")))).rejects.toMatchObject({ status: 403 });
  });
  it("seals an original FIN62 operation reference without inventing its missing historical refund key", async () => {
    const { feedEpoch: _epoch, installationGeneration: _generation, ...financialScope } = scope;
    const original = basis();
    const financial = normalizeRefundApprovalBasis({ ...original, scope: financialScope, refundKey: `financial-operation:${original.operationId}` });
    const receipt = await issueRefundApprovalReceipt({ basis: financial, witness: requester, proof, authorization: hostedGrant() });
    await expect(verifyRefundApprovalEvidence(evidence(approval("hosted", receipt), requester, financial, "financial")))
      .resolves.toMatchObject({ basis: { operationId: original.operationId, refundKey: `financial-operation:${original.operationId}` } });
  });
  it.each(["money", "version", "branch", "terminal", "witness", "seal"])("refuses a changed %s without another refund write", async changed => {
    const receipt = await issueRefundApprovalReceipt({ basis: basis(), witness: requester, proof, authorization: hostedGrant() });
    const bound = basis(); if (changed === "money") bound.amountMinor = "1231";
    if (changed === "version") bound.expectedSaleVersion = "2"; if (changed === "branch") bound.scope.branchId = "B";
    if (changed === "terminal") bound.scope.terminalId = id(99);
    const input = evidence(approval("hosted", changed === "seal" ? receipt.slice(0, -1) + (receipt.endsWith("a") ? "b" : "a") : receipt), changed === "witness" ? reviewer : requester, bound);
    await expect(verifyRefundApprovalEvidence(input)).rejects.toThrow();
  });
  it("does not accept the receipt as a bearer without the exact signed companion", async () => {
    const receipt = await issueRefundApprovalReceipt({ basis: basis(), witness: requester, proof, authorization: hostedGrant() });
    const input = evidence(approval("hosted", receipt));
    input.evidence.approvalJson += " ";
    await expect(verifyRefundApprovalEvidence(input)).rejects.toThrow();
    expect(f.signature).not.toHaveBeenCalled();
  });
  it("refuses expired or legacy method-ambiguous PIN grants when issuing new durable authority", async () => {
    const expired = hostedGrant(); expired.grant.exp = Date.now() - 1;
    await expect(issueRefundApprovalReceipt({ basis: basis(), witness: requester, proof, authorization: expired })).rejects.toThrow();
    const legacy = hostedGrant(); delete (legacy.grant as { credentialMethod?: string }).credentialMethod;
    await expect(issueRefundApprovalReceipt({ basis: basis(), witness: requester, proof, authorization: legacy })).rejects.toThrow();
  });
  it.each(["terminal-only", "wrong-witness", "management"])("requires a registered current-person operations PC at issue (%s)", async kind => {
    if (kind === "terminal-only") f.caller.mockResolvedValue({ kind: "terminal", terminal });
    if (kind === "wrong-witness") f.scope.mockResolvedValue({ appUserId: manager.authorId, staffUserId: manager.subject, terminalId: terminal.id, storeId: "A" });
    if (kind === "management") f.caller.mockResolvedValue({ kind: "cashier", terminal: { ...terminal, mode: "management" } });
    await expect(issueRefundApprovalReceipt({ basis: basis(), witness: requester, proof, authorization: hostedGrant() })).rejects.toThrow();
  });
  it("does not make direct/admin authority ask for a second reason or an offline-PIN setting", async () => {
    people[0].role = people[0].role_slug = "admin"; settings[0].allow_offline_approvals = false;
    const receipt = await issueRefundApprovalReceipt({ basis: basis(), witness: requester, proof, authorization: { ok: true, required: false } });
    await expect(verifyRefundApprovalEvidence(evidence({ ...approval("hosted", receipt), reason: null }))).resolves.toBeDefined();
  });
  it("preserves centrally verified self-PIN authority for an eligible requester under a request-mode rule", async () => {
    people[0].role = people[0].role_slug = "manager"; rules[0].mode = "request";
    const grant = hostedGrant(); Object.assign(grant.grant, { modeUsed: "self_pin", approvedBy: requester.subject });
    const receipt = await issueRefundApprovalReceipt({ basis: basis(), witness: requester, proof, authorization: grant });
    await expect(verifyRefundApprovalEvidence(evidence(approval("hosted", receipt)))).resolves.toBeDefined();
    Object.assign(grant.grant, { approvedBy: manager.subject });
    await expect(issueRefundApprovalReceipt({ basis: basis(), witness: requester, proof, authorization: grant })).rejects.toMatchObject({ status: 403 });
  });
});

describe("fresh hosted policy for Main-witnessed manager PIN approval", () => {
  it("checks the independent manager without requiring that manager to be signed into this PC", async () => {
    const result = await verifyRefundApprovalEvidence(evidence(approval("offline_pin")));
    expect(result.approval.approver).toEqual(manager);
    expect(f.signature.mock.calls.every(([input]) => input.attestation.authorId === requester.authorId)).toBe(true);
  });
  it.each(["revoked", "permission", "page", "branch", "scope", "method", "limit", "excluded", "online-only", "disabled-offline"])("retains pending work when current %s denies it", async kind => {
    const p = people[1];
    if (kind === "revoked") p.is_active = false; if (kind === "permission") p.permissions.can_process_refund = false;
    if (kind === "page") p.permissions["page:register"] = false; if (kind === "branch") p.store_id = "B";
    if (kind === "scope") Object.assign(p.permissions, { "approval_scope:configured": true, "approval_scope:branch:B": true });
    if (kind === "method") p.permissions.approval_pin_enabled = false; if (kind === "limit") rules[0].authority_limits = { "role:manager": 1 };
    if (kind === "excluded") rules[0].allowed_user_ids = ["!manager"]; if (kind === "online-only") settings[0].online_only_refund = true;
    if (kind === "disabled-offline") settings[0].allow_offline_approvals = false;
    await expect(verifyRefundApprovalEvidence(evidence(approval("offline_pin")))).rejects.toMatchObject({ status: 403 });
  });
  it("keeps failed signature and current-author revocations from becoming manager grants", async () => {
    f.signature.mockRejectedValueOnce(Object.assign(Error("Invalid signature"), { status: 403 }));
    await expect(verifyRefundApprovalEvidence(evidence(approval("offline_pin")))).rejects.toMatchObject({ status: 403 });
    f.signature.mockImplementation(async ({ attestation: value }) => value); f.permission.mockResolvedValue({ allowed: false });
    await expect(verifyRefundApprovalEvidence(evidence(approval("offline_pin")))).rejects.toMatchObject({ status: 403 });
  });
  it("refuses a cancelled centrally approved request even with its valid operation receipt", async () => {
    rules[0].mode = "request";
    const grant = hostedGrant(); Object.assign(grant.grant, { modeUsed: "request", requestId: id(30), credentialMethod: undefined });
    f.request.mockResolvedValue({ id: id(30), status: "approved", consumedAt: "now", requestedBy: "cashier", actionKey: "refund", storeId: "A",
      decidedBy: "manager", approvedAmount: 12.3, createdAt: new Date(Date.now() - 86400000).toISOString(), approvalRoute: null });
    const receipt = await issueRefundApprovalReceipt({ basis: basis(), witness: requester, proof, authorization: grant });
    f.request.mockResolvedValue({ status: "cancelled" });
    await expect(verifyRefundApprovalEvidence(evidence(approval("hosted", receipt)))).rejects.toMatchObject({ status: 403 });
  });
  it("preserves a genuinely escalated request approval while rechecking the current decision and value", async () => {
    Object.assign(rules[0], { mode: "request", allowed_roles: ["admin"], escalation_roles: ["manager"], escalation_after_minutes: 5 });
    const grant = hostedGrant(); Object.assign(grant.grant, { modeUsed: "request", requestId: id(30), credentialMethod: undefined });
    const request = { id: id(30), status: "approved", consumedAt: "now", requestedBy: "cashier", actionKey: "refund", storeId: "A",
      decidedBy: "manager", approvedAmount: 12.3, createdAt: new Date(Date.now() - 86400000).toISOString(), approvalRoute: null };
    f.request.mockResolvedValue(request);
    const receipt = await issueRefundApprovalReceipt({ basis: basis(), witness: requester, proof, authorization: grant });
    await expect(verifyRefundApprovalEvidence(evidence(approval("hosted", receipt)))).resolves.toBeDefined();
    f.request.mockResolvedValue({ ...request, approvedAmount: 12.29 });
    await expect(verifyRefundApprovalEvidence(evidence(approval("hosted", receipt)))).rejects.toMatchObject({ status: 403 });
    f.request.mockResolvedValue({ ...request, decidedBy: "someone-else" });
    await expect(verifyRefundApprovalEvidence(evidence(approval("hosted", receipt)))).rejects.toMatchObject({ status: 403 });
  });
  it("preserves an explicitly routed consumed request's existing cross-branch approver exception", async () => {
    rules[0].mode = "request"; people[1].store_id = "B";
    const grant = hostedGrant(); Object.assign(grant.grant, { modeUsed: "request", requestId: id(30), credentialMethod: undefined });
    const request = { id: id(30), status: "approved", consumedAt: "now", requestedBy: "cashier", actionKey: "refund", storeId: "A",
      decidedBy: "manager", approvedAmount: 12.3, createdAt: new Date(Date.now() - 86400000).toISOString(),
      approvalRoute: { primaryApprovers: [{ id: "manager" }], escalationApprovers: [], escalationAfterMinutes: null } };
    f.request.mockResolvedValue(request);
    const receipt = await issueRefundApprovalReceipt({ basis: basis(), witness: requester, proof, authorization: grant });
    await expect(verifyRefundApprovalEvidence(evidence(approval("hosted", receipt)))).resolves.toBeDefined();
    f.request.mockResolvedValue({ ...request, approvalRoute: null });
    await expect(verifyRefundApprovalEvidence(evidence(approval("hosted", receipt)))).rejects.toMatchObject({ status: 403 });
  });
  it("does not let a routed request widen the approver's explicit branch scope", async () => {
    rules[0].mode = "request"; people[1].store_id = "B";
    Object.assign(people[1].permissions, { "approval_scope:configured": true, "approval_scope:branch:B": true });
    const grant = hostedGrant(); Object.assign(grant.grant, { modeUsed: "request", requestId: id(30), credentialMethod: undefined });
    f.request.mockResolvedValue({ id: id(30), status: "approved", consumedAt: "now", requestedBy: "cashier", actionKey: "refund", storeId: "A",
      decidedBy: "manager", approvedAmount: 12.3, createdAt: new Date(Date.now() - 86400000).toISOString(),
      approvalRoute: { primaryApprovers: [{ id: "manager" }], escalationApprovers: [], escalationAfterMinutes: null } });
    await expect(issueRefundApprovalReceipt({ basis: basis(), witness: requester, proof, authorization: grant })).rejects.toMatchObject({ status: 403 });
    await expect(verifyRefundApprovalEvidence(evidence(approval("offline_pin")))).rejects.toMatchObject({ status: 403 });
  });
  it("distinguishes unavailable policy reads from an authorization denial without exporting payloads", async () => {
    f.rest.mockResolvedValue(new Response("private database detail", { status: 503 }));
    await expect(verifyRefundApprovalEvidence(evidence(approval("offline_pin")))).rejects.toMatchObject({ status: 503, code: "REFUND_APPROVAL_UNAVAILABLE" });
  });
  it("checks the canonical issue basis and preserves padded exact SQL money", async () => {
    const data = { storeId: "A", requestedAmount: 12.3, payload: { sale_id: id(5), receipt_no: "A-123", total: 12.3 } };
    await expect(verifyRefundApprovalIssueBasis(basis(), data)).resolves.toEqual(basis());
    await expect(verifyRefundApprovalIssueBasis(basis(), { ...data, payload: { ...data.payload, total: 12.31 } })).rejects.toThrow();
    expect(refundApprovalAmountMinor("12.300000000000")).toBe("1230");
    expect(() => refundApprovalAmountMinor("12.300000000001")).toThrow();
  });
});
