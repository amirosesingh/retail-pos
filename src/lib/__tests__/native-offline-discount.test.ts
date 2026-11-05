import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { canAuthorizeAmount, defaultRule, normalizeRule, ticketDiscountApprovalPercent, ticketDiscounts } from "../authorization";
import { DEFAULT_POS_RULES, normalizeRules } from "../pos-rules";
import * as shared from "../../../electron/shared/approval-authority.mjs";
import { cartTotals } from "../pos-store";
import { lineDiscountTotal, r2, type CartLine } from "../../core/types/pos-types";
import { normalizeSnapshot, snapshotFingerprint } from "../ticket-snapshot";
const require = createRequire(import.meta.url);
const { OfflineApprovalService, createOfflineApprovalHandler } = require("../../../electron/offline-approval-service.cjs");
const requestId = "00000000-0000-4000-8000-000000000001", author = "00000000-0000-4000-8000-000000000002", requesterId = "00000000-0000-4000-8000-000000000003";
const discounts = [{ index: -1, productId: "", name: "Bill", qty: 1, price: 0, type: "percent", value: 20, base: 20, requiresApproval: true }];
function request() { return { requestId, actionKey: "discount_over_limit", registeredTerminalId: "terminal-a", branchId: "branch-a", username: "manager", credential: "fixture-approval-pin", reason: "Manager reviewed",
  requestedAmount: 20, snapshot: { ticketId: "B-1", billNo: "B-1", capturedAt: "2026-11-05T12:00:00.000Z", storeId: "branch-a", terminalId: "renderer-display-id", lines: [{ sku: "SKU-1", qty: 1, unitPrice: 20, discount: 0, discountType: "amount", couponDiscount: 0, lineTotal: 20 }], subtotal: 20, discount: 4, tax: 0, serviceCharge: 0, total: 16, cartDiscount: 20, cartDiscountType: "percent", promoDiscount: 0 }, payload: { bill_no: "B-1", discount_scope: "ticket", requested_discounts: JSON.stringify(discounts) } }; }
function fixture(branchId = "branch-a") {
  let epoch = 1, clock = Date.parse("2026-11-05T12:00:00Z"); const saved = new Map<string, any>();
  const policy: any = { rule: { action_key: "discount_over_limit", scope_type: "branch", scope_id: branchId, mode: "pin", is_enabled: true, allowed_roles: '["manager","admin"]', allowed_user_ids: "[]", authority_limits: "{}", extra_authority: "{}", absolute_ceilings: "{}", require_reason: true },
    settings: [{ store_id: "", max_cashier_discount_percent: 10, allow_offline_approvals: true }, { store_id: branchId, max_cashier_discount_percent: null, allow_offline_approvals: null }],
    requester: { id: requesterId, user_id: "cashier", is_active: true, permissions: '{"can_process_sale":true}' },
    actor: { id: author, user_id: "manager", full_name: "Fixture Manager", role: "manager", role_slug: "manager", is_active: true, permissions: '{"can_give_discount":true}' } };
  const verify = vi.fn(async () => ({ ok: true, credentialMethod: "pin", staff: { id: author, username: "manager" } }));
  const store = { readPolicy: vi.fn(async () => structuredClone(policy)), readPrior: vi.fn(async (id: string) => saved.get(id)), persist: vi.fn(async (scope: any, current: any, value: any, check: any) => {
    await check(structuredClone(policy)); scope.assertCurrent();
    if (saved.has(current.requestId)) return { replayed: true };
    saved.set(current.requestId, { contextHash: value.contextHash, policyHash: value.policyHash, requester: scope.requester, requesterId: scope.requesterId, authorizer: author, row: structuredClone(value.row) });
    return { replayed: false };
  }) };
  const captureScope = () => { const expected = epoch; return { branchId, terminalId: "terminal-a", requester: "cashier", requesterId, epoch, assertCurrent: () => { if (expected !== epoch) throw Object.assign(Error("Changed"), { code: "EAPPROVAL_CONTEXT" }); } }; };
  const create = () => new OfflineApprovalService({ captureScope, verify, store, now: () => clock });
  return { service: create(), create, store, verify, policy, change: () => { epoch++; }, advance: () => { clock += 16 * 60_000; }, saved: (id = requestId) => saved.get(id) ?? null };
}
describe("Main-owned offline discount approval", () => {
  it("verifies the manager and persists a Main-stamped audit before returning approval", async () => {
    const f = fixture(), result = await f.service.authorize(request());
    expect(result).toMatchObject({ ok: true, auditId: requestId, authorizer: { id: "manager" } });
    expect(f.saved().row).toMatchObject({ requested_by: "cashier", authorized_by: "manager", terminal_id: "terminal-a", store_id: "branch-a", outcome: "approved" });
    expect(JSON.stringify(f.saved())).not.toContain("fixture-approval-pin");
  });
  it("retries an identical lost acknowledgement with the frozen audit without consuming credentials twice", async () => {
    const f = fixture(); await f.service.authorize(request()); const before = structuredClone(f.saved());
    expect(await f.service.authorize(request())).toMatchObject({ ok: true, replayed: true }); expect(f.verify).toHaveBeenCalledTimes(1); expect(f.saved()).toEqual(before);
  });
  it("rechecks credentials and exact prior evidence after Main restart", async () => {
    const f = fixture(); await f.service.authorize(request()); expect(await f.create().authorize(request())).toMatchObject({ ok: true, replayed: true }); expect(f.verify).toHaveBeenCalledTimes(2);
  });
  it("coalesces concurrent identical calls", async () => {
    const f = fixture(); await Promise.all([f.service.authorize(request()), f.service.authorize(request())]); expect(f.verify).toHaveBeenCalledTimes(1); expect(f.store.persist).toHaveBeenCalledTimes(1);
  });
  it.each(["username", "reason", "payload"])("rejects reused request identity with changed %s", async field => {
    const f = fixture(); await f.service.authorize(request()); const changed: any = request(); changed[field] = field === "payload" ? { ...changed.payload, approval_location: "pos_register" } : "other";
    await expect(f.service.authorize(changed)).rejects.toMatchObject({ code: "EIDEMPOTENCY" });
  });
  it.each(["branchId", "registeredTerminalId"])("rejects foreign %s before PIN verification", async field => {
    const f = fixture(); expect(() => f.service.authorize({ ...request(), [field]: "foreign" })).toThrow(); expect(f.verify).not.toHaveBeenCalled();
  });
  it.each([19, 21, -1, 101])("rejects mismatching requested percentage %s", async requestedAmount => {
    const f = fixture(); await expect(async () => f.service.authorize({ ...request(), requestedAmount })).rejects.toThrow(); expect(f.store.persist).not.toHaveBeenCalled();
  });
  it("rejects a changed item binding and no full-ticket context", async () => {
    const f = fixture(), r = request(); r.payload.requested_discounts = JSON.stringify([{ ...discounts[0], index: 0, productId: "FOREIGN" }]); await expect(f.service.authorize(r)).rejects.toThrow();
  });
  it("retains denial and creates no audit when credential verification fails", async () => {
    const f = fixture(); f.verify.mockResolvedValueOnce({ ok: false, error: "Locked" } as any); await expect(f.service.authorize(request())).rejects.toThrow("Locked"); expect(f.store.persist).not.toHaveBeenCalled();
  });
  it.each(["inactive", "permission", "mode", "offline", "reason", "limit", "excluded"])("denies current %s policy", async kind => {
    const f = fixture(), r = request();
    if (kind === "inactive") f.policy.actor.is_active = false;
    if (kind === "permission") f.policy.actor.permissions = "{}";
    if (kind === "mode") f.policy.rule.mode = "request";
    if (kind === "offline") f.policy.settings[0].allow_offline_approvals = false;
    if (kind === "reason") r.reason = "";
    if (kind === "limit") f.policy.rule.authority_limits = '{"role:manager":10}';
    if (kind === "excluded") f.policy.rule.allowed_user_ids = '["!manager"]';
    await expect(f.service.authorize(r)).rejects.toThrow(); expect(f.saved()).toBeNull();
  });
  it("denies a session change while the verifier awaits", async () => {
    const f = fixture(); f.verify.mockImplementationOnce(async () => { f.change(); return { ok: true, staff: { id: author, username: "manager" } } as any; }); await expect(f.service.authorize(request())).rejects.toMatchObject({ code: "EAPPROVAL_CONTEXT" }); expect(f.store.persist).not.toHaveBeenCalled();
  });
  it("does not accept revoked authority on cached retry", async () => {
    const f = fixture(); await f.service.authorize(request()); f.policy.actor.is_active = false; await expect(f.service.authorize(request())).rejects.toThrow();
  });
  it.each(["inactive", "permission"])("checks fresh requester %s after verification", async change => {
    const f = fixture(); f.verify.mockImplementationOnce(async () => { if (change === "inactive") f.policy.requester.is_active = false; else f.policy.requester.permissions = "{}"; return { ok: true, staff: { id: author, username: "manager" } } as any; });
    await expect(f.service.authorize(request())).rejects.toMatchObject({ code: "EPRIVILEGE" }); expect(f.saved()).toBeNull();
  });
  it("rechecks a requester permission change synced between policy read and write", async () => {
    const f = fixture(); f.store.readPolicy.mockImplementationOnce(async () => { const before = structuredClone(f.policy); f.policy.requester.permissions = "{}"; return before; });
    await expect(f.service.authorize(request())).rejects.toMatchObject({ code: "EPRIVILEGE" }); expect(f.saved()).toBeNull();
  });
  it.each(["branch", "pin", "totp"])("rechecks %s approval revocation before the first policy read", async change => {
    const f = fixture(); f.verify.mockImplementationOnce(async () => {
      f.policy.actor.permissions = JSON.stringify({ can_give_discount: true, ...(change === "branch" ? { "approval_scope:configured": true, "approval_scope:branch:foreign": true } : change === "pin" ? { approval_pin_enabled: false } : { approval_totp_enabled: false }) });
      return { ok: true, credentialMethod: change === "totp" ? "totp" : "pin", staff: { id: author, username: "manager" } } as any;
    }); await expect(f.service.authorize(request())).rejects.toThrow(); expect(f.saved()).toBeNull();
  });
  it("rechecks the used credential's enable switch inside the write transaction", async () => {
    const f = fixture(); f.store.readPolicy.mockImplementationOnce(async () => { const before = structuredClone(f.policy); f.policy.actor.permissions = '{"can_give_discount":true,"approval_pin_enabled":false}'; return before; });
    await expect(f.service.authorize(request())).rejects.toThrow("no longer enabled"); expect(f.saved()).toBeNull();
  });
  it("honors an uppercase UUID branch's disabling policy instead of global fallback", async () => {
    const branch = "abcdefab-1234-4234-8234-abcdefabcdef", f = fixture(branch), r = request();
    f.policy.settings[1].store_id = branch.toUpperCase(); f.policy.settings[1].allow_offline_approvals = false; r.branchId = branch; r.snapshot.storeId = branch.toUpperCase();
    await expect(f.service.authorize(r)).rejects.toMatchObject({ code: "EAPPROVAL_POLICY" }); expect(f.saved()).toBeNull();
  });
  it("holds duplicate canonical UUID settings even when a permissive case variant appears first", async () => {
    const branch = "abcdefab-1234-4234-8234-abcdefabcdef", f = fixture(branch), r = request(); r.branchId = branch; r.snapshot.storeId = branch;
    f.policy.settings[1] = { store_id: branch.toUpperCase(), allow_offline_approvals: true };
    f.policy.settings.push({ store_id: branch, allow_offline_approvals: false });
    await expect(f.service.authorize(r)).rejects.toThrow("ambiguous"); expect(f.saved()).toBeNull();
  });
  it("preserves verifier-normalized administrator role semantics without inventing role defaults", async () => {
    const f = fixture(); f.policy.actor.role_slug = "ADMIN"; f.policy.actor.permissions = "{}";
    await expect(f.service.authorize(request())).resolves.toMatchObject({ ok: true }); expect(f.saved().row.authorizer_role).toBe("admin");
    const conflicting = fixture(); conflicting.policy.actor.role = "admin"; conflicting.policy.actor.role_slug = "cashier"; conflicting.policy.actor.permissions = "{}";
    await expect(conflicting.service.authorize(request())).rejects.toThrow();
  });
  it("ignores foreign global-typed rules but preserves an applicable legacy global-typed branch row", async () => {
    const f = fixture(); f.policy.rules = [{ ...f.policy.rule, scope_type: "global", scope_id: "branch-a" }, { ...f.policy.rule, scope_type: "global", scope_id: "foreign", is_enabled: false }];
    await expect(f.service.authorize(request())).resolves.toMatchObject({ ok: true });
  });
  it("holds ambiguous applicable global baselines instead of falling back to permissive defaults", async () => {
    const f = fixture(); f.policy.rules = [{ ...f.policy.rule, scope_type: "global", scope_id: "" }, { ...f.policy.rule, scope_type: "global", scope_id: "branch-a" }];
    await expect(f.service.authorize(request())).rejects.toThrow("ambiguous"); expect(f.saved()).toBeNull();
  });
  it("does not revoke the same requester identity for a case-only synchronized username change", async () => {
    const f = fixture(); await f.service.authorize(request()); f.policy.requester.user_id = "CASHIER";
    await expect(f.service.authorize(request())).resolves.toMatchObject({ ok: true, replayed: true }); expect(f.saved().row.requested_by).toBe("cashier");
    f.policy.requester.id = author; await expect(f.service.authorize(request())).rejects.toMatchObject({ code: "EPRIVILEGE" });
  });
  it("rejects a different canonical approver for the existing self-PIN mode", async () => {
    const f = fixture(); await expect(f.service.authorize({ ...request(), username: "manager-alias", selfAuthorization: true })).rejects.toThrow("signed-in account"); expect(f.saved()).toBeNull();
  });
  it.each([null, {}, "x".repeat(121)])("rejects rather than truncates an invalid author identity", username => {
    const f = fixture(); expect(() => f.service.authorize({ ...request(), username })).toThrow(); expect(f.verify).not.toHaveBeenCalled();
  });
  it("rejects an over-limit reason and unrelated card context", () => {
    const f = fixture(); expect(() => f.service.authorize({ ...request(), reason: "x".repeat(1001) })).toThrow(); expect(() => f.service.authorize({ ...request(), payload: { ...request().payload, card_number: "SYNTHETIC-CARD" } })).toThrow();
  });
  it("accepts all 300 visible lines but rejects 301 without clipping", async () => {
    const f = fixture(), r = request(); r.snapshot.lines = Array.from({ length: 300 }, () => ({ sku: "S1", qty: 1, unitPrice: 1, discount: 0, discountType: "amount", couponDiscount: 0, lineTotal: 1 })); r.snapshot.subtotal = 300; r.snapshot.discount = 60; r.snapshot.total = 240;
    r.payload.requested_discounts = JSON.stringify([{ ...discounts[0], base: 300 }]); await expect(f.service.authorize(r)).resolves.toMatchObject({ ok: true });
    expect(f.saved().row.detail.snapshot.lines).toHaveLength(300); expect(() => f.service.authorize({ ...r, requestId: requesterId, snapshot: { ...r.snapshot, lines: [...r.snapshot.lines, r.snapshot.lines[0]] } })).toThrow("300 lines");
  });
  it("uses the existing member privacy projection and excludes unrelated snapshot card fields", async () => {
    const f = fixture(), r: any = request(); r.snapshot.member = { id: "fixture-member", name: "Fixture", phone: "1234567890", email: "fixture-person@example.test", cardNumber: "SYNTHETIC-CARD" }; r.snapshot.cardReference = "SYNTHETIC-CARD";
    await f.service.authorize(r); const audit = JSON.stringify(f.saved().row); expect(audit).not.toContain("1234567890"); expect(audit).not.toContain("fixture-person@example.test"); expect(audit).not.toContain("SYNTHETIC-CARD");
  });
  it("propagates SQL failure without returning approval", async () => {
    const f = fixture(); f.store.persist.mockRejectedValueOnce(Error("Fixture rollback")); await expect(f.service.authorize(request())).rejects.toThrow("Fixture rollback"); expect(f.saved()).toBeNull();
  });
  it("prunes 100 expired verified contexts so new requests are not blocked forever", async () => {
    const f = fixture();
    for (let index = 1; index <= 100; index++) await f.service.authorize({ ...request(), requestId: `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}` });
    expect(f.service.pending.size).toBe(100); f.advance();
    await expect(f.service.authorize({ ...request(), requestId: "00000000-0000-4000-8000-000000000101" })).resolves.toMatchObject({ ok: true });
    expect(f.service.pending.size).toBe(1);
  });
  it.each(["authority_limits", "allowed_user_ids"])("fails closed for malformed saved %s", async field => {
    const f = fixture(); f.policy.rule[field] = "not json"; await expect(f.service.authorize(request())).rejects.toThrow(); expect(f.saved()).toBeNull();
  });
  it("preserves the actual generic cashier write gate while admitting only the dedicated handler", () => {
    const session = require("../../../electron/admin-session.cjs"), privilege = require("../../../electron/ipc-privilege.cjs");
    try {
      session.grant("staff", "fixture-cashier", { can_process_sale: true }, "pos", "branch-a");
      expect(privilege.allowed("business:commit-aggregate", [{ kind: "general", operations: [{ table: "authorization_log" }] }])).toBe(false);
      expect(privilege.allowed("approval:authorize-offline-discount", [request()])).toBe(true);
      session.clear(); expect(privilege.allowed("approval:authorize-offline-discount", [request()])).toBe(false);
    } finally { session.clear(); }
  });
});
describe("shared exact policy parity", () => {
  it("keeps existing defaults, SQL serialized nullable rules and authority results", () => {
    expect((shared as any).DEFAULT_POS_RULES).toEqual(DEFAULT_POS_RULES);
    for (const raw of [{}, { allow_offline_approvals: null, max_cashier_discount_percent: 0 }, { allow_offline_approvals: false }, { online_only_manual_discount: 1 }]) expect((shared as any).normalizeRules(raw)).toEqual(normalizeRules(raw));
    for (const role of ["admin", "manager", "supervisor", "cashier"]) for (const amount of [0, 10, 20, 100]) {
      const rule = normalizeRule({ ...defaultRule("discount_over_limit"), extra_authority: '{"role:manager":10}', absolute_ceilings: '{"role:manager":15}' });
      expect((shared as any).canAuthorizeAmount(rule, { userId: "manager", role }, amount, 10)).toBe(canAuthorizeAmount(rule, { userId: "manager", role }, amount, 10));
    }
    expect(shared.ticketDiscounts(request().payload)).toEqual(ticketDiscounts(request().payload)); expect(shared.ticketDiscountApprovalPercent(discounts as any)).toBe(ticketDiscountApprovalPercent(discounts as any));
  });
});

describe("native complete-bill amount evidence", () => {
  function bill(inputs: Partial<CartLine>[], cartDiscount = 0, cartDiscountType: "amount" | "percent" = "amount", promoDiscount = 0) {
    const lines = inputs.map((line, index) => ({ productId: `SKU-${index + 1}`, name: `Fixture ${index + 1}`, price: 20, qty: 1,
      discount: 0, discountType: "amount" as const, couponDiscount: 0, taxRate: 0, ...line })) as CartLine[];
    const totals = cartTotals(lines, cartDiscount, cartDiscountType, undefined, promoDiscount);
    const r: any = request();
    r.snapshot = { ...r.snapshot, subtotal: totals.subtotal, discount: totals.discount, tax: totals.tax, total: totals.total,
      cartDiscount, cartDiscountType, promoDiscount, lines: lines.map(line => ({ sku: line.productId, qty: line.qty, unitPrice: line.price,
        discount: line.discount, discountType: line.discountType, couponDiscount: line.couponDiscount,
        lineTotal: r2(line.price * line.qty - Math.sign(line.qty) * lineDiscountTotal(line)) })) };
    const entries: any[] = lines.flatMap((line, index) => line.discount > 0 && line.qty > 0
      ? [{ index, productId: line.productId, name: line.name, qty: line.qty, price: line.price, type: line.discountType, value: line.discount,
        base: Math.max(0, Math.abs(line.price) - Math.abs(line.couponDiscount || 0) / Math.abs(line.qty)), requiresApproval: true }] : []);
    if (cartDiscount > 0) entries.push({ index: -1, productId: "", name: "Whole bill", qty: 1, price: 0,
      type: cartDiscountType, value: cartDiscount, base: Math.max(0, r2(totals.subtotal - totals.lineDiscount)), requiresApproval: true });
    r.payload.requested_discounts = JSON.stringify(entries); r.requestedAmount = ticketDiscountApprovalPercent(entries);
    return { request: r, entries, lines };
  }
  it("rejects the reproduced $20/$10 forged bill denominator before PIN or writes", async () => {
    const f = fixture(), { request: r, entries } = bill([{}], 10);
    f.policy.rule.authority_limits = '{"role:manager":10}';
    r.payload.requested_discounts = JSON.stringify([{ ...entries[0], base: 1000 }]); r.requestedAmount = 1;
    await expect(f.service.authorize(r)).rejects.toThrow("exact bill"); expect(f.verify).not.toHaveBeenCalled(); expect(f.saved()).toBeNull();
    const actual = bill([{}], 10).request;
    await expect(f.service.authorize(actual)).rejects.toThrow("approval limit");
    f.policy.rule.authority_limits = '{"role:manager":50}'; await expect(f.service.authorize(actual)).resolves.toMatchObject({ ok: true });
    expect(f.saved().row.detail.requested_amount).toBe(50);
  });
  it("rejects a forged item denominator with a consistent renderer percentage", async () => {
    const f = fixture(), { request: r, entries } = bill([{ discount: 10 }]);
    r.payload.requested_discounts = JSON.stringify([{ ...entries[0], base: 1000 }]); r.requestedAmount = 1;
    await expect(f.service.authorize(r)).rejects.toThrow("exact bill"); expect(f.verify).not.toHaveBeenCalled();
  });
  it("uses actual fractional-quantity coupon base for the manager's amount ceiling", async () => {
    const f = fixture(), { request: r, entries } = bill([{ price: 100, qty: 0.5, couponDiscount: 20, discount: 10 }]);
    expect(entries[0].base).toBe(60); expect(r.requestedAmount).toBeCloseTo(16.6666666667); expect(r.snapshot.lines[0].lineTotal).toBe(25);
    const old = structuredClone(r); old.payload.requested_discounts = JSON.stringify([{ ...entries[0], base: 80 }]); old.requestedAmount = 12.5;
    await expect(f.service.authorize(old)).rejects.toThrow("exact bill");
    f.policy.rule.authority_limits = '{"role:manager":15}'; await expect(f.service.authorize(r)).rejects.toThrow("approval limit");
    f.policy.rule.authority_limits = '{"role:manager":17}'; await expect(f.service.authorize(r)).resolves.toMatchObject({ ok: true });
  });
  it.each([
    { name: "fractional percent coupon", lines: [{ price: 100, qty: 0.5, couponDiscount: 20, discount: 20, discountType: "percent" as const }], cart: 0, type: "amount" as const, promo: 0 },
    { name: "three units with a subcent coupon", lines: [{ price: 33.33, qty: 3, couponDiscount: 0.014, discount: 7, discountType: "percent" as const }], cart: 2, type: "amount" as const, promo: 1.11 },
    { name: "raw quantity and price beyond three decimals", lines: [{ price: 33.33333, qty: 0.33333333, couponDiscount: 0.014, discount: 0.12345 }], cart: 3, type: "percent" as const, promo: 0.27 },
    { name: "global subtotal versus rounded lines", lines: [{ price: 0.33333, qty: 1 }, { price: 0.33333, qty: 1 }, { price: 0.33333, qty: 1 }], cart: 10, type: "percent" as const, promo: 0 },
    { name: "signed exchange and ordinary item", lines: [{ price: 10, qty: -1, couponDiscount: 2, discount: 1 }, { price: 50, qty: 1, discount: 5 }], cart: 2, type: "amount" as const, promo: 1 },
    { name: "zero quantity is never an item request", lines: [{ qty: 0, discount: 2 }, { price: 50, discount: 5 }], cart: 0, type: "amount" as const, promo: 0 },
    { name: "promotion plus bill coupon does not become manual discount", lines: [{ price: 100, couponDiscount: 10, discount: 5 }], cart: 10, type: "percent" as const, promo: 12.34 },
    { name: "fully discounted line plus bill", lines: [{ price: 20, discount: 100, discountType: "percent" as const }, { price: 30 }], cart: 5, type: "amount" as const, promo: 2 },
  ])("keeps actual cartTotals and exact authority for $name", async ({ lines, cart, type, promo }) => {
    const f = fixture(), { request: r } = bill(lines, cart, type, promo);
    await expect(f.service.authorize(r)).resolves.toMatchObject({ ok: true });
    expect(f.saved().row.detail.requested_amount).toBe(r.requestedAmount);
    expect(f.saved().row.detail.snapshot).toEqual(normalizeSnapshot(r.snapshot));
    expect(snapshotFingerprint(f.saved().row.detail.snapshot)).toBe(snapshotFingerprint(r.snapshot));
    expect(f.saved().row.detail.snapshot).not.toHaveProperty("cartDiscount"); expect(f.saved().row.detail.snapshot.lines[0]).not.toHaveProperty("couponDiscount");
  });
  it.each(["omitted item", "omitted bill", "duplicate", "wrong type", "wrong bill quantity", "wrong bill price", "wrong coupon", "wrong promotion", "wrong subtotal", "wrong line total", "wrong discount total", "missing evidence"])("denies $0 without a credential attempt or write", async change => {
    const f = fixture(), { request: r, entries } = bill([{ discount: 2 }], 2, "amount", 1);
    if (change === "omitted item") entries.splice(0, 1);
    if (change === "omitted bill") entries.splice(1, 1);
    if (change === "duplicate") entries.push({ ...entries[0] });
    if (change === "wrong type") entries[0].type = "percent";
    if (change === "wrong bill quantity") entries[1].qty = 2;
    if (change === "wrong bill price") entries[1].price = 20;
    if (change === "wrong coupon") r.snapshot.lines[0].couponDiscount = 1;
    if (change === "wrong promotion") r.snapshot.promoDiscount = 2;
    if (change === "wrong subtotal") r.snapshot.subtotal += 1;
    if (change === "wrong line total") r.snapshot.lines[0].lineTotal += 1;
    if (change === "wrong discount total") r.snapshot.discount += 1;
    if (change === "missing evidence") delete r.snapshot.cartDiscountType;
    r.payload.requested_discounts = JSON.stringify(entries); r.requestedAmount = ticketDiscountApprovalPercent(entries);
    await expect(f.service.authorize(r)).rejects.toThrow(); expect(f.verify).not.toHaveBeenCalled(); expect(f.store.persist).not.toHaveBeenCalled();
  });
});
describe("actual Main approval handler sender admission", () => {
  it("rejects customer display and child-frame senders before credential/SQL work", async () => {
    const mainFrame = {}, webContents = { mainFrame }, authorize = vi.fn(async () => ({ ok: true }));
    const handler = createOfflineApprovalHandler({ isPosSender: (event: any) => event.sender === webContents && event.senderFrame === webContents.mainFrame, authorize });
    await expect(handler({ sender: { mainFrame: {} }, senderFrame: {} }, request())).toEqual({ ok: false, code: "EPRIVILEGE", error: "Offline bill approval is limited to the POS window." });
    await expect(handler({ sender: webContents, senderFrame: {} }, request())).toEqual({ ok: false, code: "EPRIVILEGE", error: "Offline bill approval is limited to the POS window." });
    expect(authorize).not.toHaveBeenCalled(); await expect(handler({ sender: webContents, senderFrame: mainFrame }, request())).resolves.toEqual({ ok: true }); expect(authorize).toHaveBeenCalledOnce();
  });
  it("a denied customer-display call cannot extend the signed-in POS idle timeout", async () => {
    const session = require("../../../electron/admin-session.cjs"), privilege = require("../../../electron/ipc-privilege.cjs");
    let clock = 0; const now = vi.spyOn(Date, "now").mockImplementation(() => clock);
    try {
      session.grant("staff", "fixture-cashier", { can_process_sale: true }, "pos", "branch-a"); clock = 599_000;
      expect(privilege.allowed("approval:authorize-offline-discount", [request()])).toBe(true);
      const handler = createOfflineApprovalHandler({ isPosSender: () => false, authorize: vi.fn() });
      expect(await handler({}, request())).toMatchObject({ ok: false, code: "EPRIVILEGE" }); clock = 601_000;
      expect(session.hasPosAuthority()).toBe(false);
    } finally { session.clear(); now.mockRestore(); }
  });
});
