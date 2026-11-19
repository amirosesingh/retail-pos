import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { RefundSaveAttempts, observeRefundDatabaseContext } from "../refund-save-attempt";
import type { LocalStartupState } from "../local-startup";

const require = createRequire(import.meta.url);
const { RefundApprovalService } = require("../../../electron/refund-approval-service.cjs");
const { ReceiptRepository } = require("../../../electron/db/repositories/receipts.cjs");
const ts = require("typescript");
const saleId = "11111111-1111-4111-8111-111111111111";
const staffId = "22222222-2222-4222-8222-222222222222";
const itemId = "33333333-3333-4333-8333-333333333333";
const productId = "44444444-4444-4444-8444-444444444444";
type Receipt = { operation_type: string; entity_id: string; note: string | null };

function fixture() {
  let now = Date.parse("2026-11-19T00:00:00Z"), mainEpoch = 1, uiContext = "operator:A:source:1";
  let branch = "A", actor = staffId, loseReply = true;
  let ledger = {
    sale: { id: saleId, store_id: "A", bill_number: "A-1", total_amount: "12.30", row_version: 1, is_refunded: false, created_at: new Date(now - 3600000) },
    item: { id: itemId, product_id: productId, quantity: 1, refunded_qty: 0 },
    stock: 10, stockWrites: 0, journalRows: 0,
    movements: {} as Record<string, boolean>, receipts: {} as Record<string, Receipt>,
  };
  const person = { id: staffId, user_id: "admin", role: "admin", role_slug: "admin", is_active: true, permissions: { can_process_refund: true } };
  const policy = { requester: person, actor: person,
    rules: [{ action_key: "refund", scope_type: "branch", scope_id: "A", mode: "pin", is_enabled: true, require_reason: false,
      allowed_roles: ["admin"], allowed_user_ids: [], authority_limits: {}, extra_authority: {}, absolute_ceilings: {} }],
    settings: [{ store_id: "", allow_offline_approvals: true, online_only_refund: false }],
  };
  class Transaction {
    ledger = structuredClone(ledger);
    async begin() { this.ledger = structuredClone(ledger); }
    async commit() { ledger = this.ledger; }
    async rollback() { /* staged changes never reached the committed ledger */ }
  }
  class Request {
    params: Record<string, unknown> = {};
    constructor(readonly tx?: Transaction) {}
    input(key: string, value: unknown) { this.params[key] = value; return this; }
    async query(sql: string) {
      const state = this.tx?.ledger ?? ledger, p = this.params;
      if (sql.startsWith("SELECT id,store_id,bill_number,total_amount,row_version,is_refunded,created_at"))
        return { recordset: state.sale.id === p.sale && state.sale.store_id === p.branch ? [structuredClone(state.sale)] : [] };
      if (sql.startsWith("SELECT operation_type,entity_id,note"))
        return { recordset: state.receipts[String(p.refund)] ? [state.receipts[String(p.refund)]] : [] };
      if (sql.startsWith("SELECT id FROM dbo.sales WHERE id=@sale AND store_id=@branch"))
        return { recordset: state.sale.id === p.sale && state.sale.store_id === p.branch ? [{ id: saleId }] : [] };
      if (sql.startsWith("SELECT TOP(1) id,is_refunded"))
        return { recordset: state.sale.store_id === p.branch ? [structuredClone(state.sale)] : [] };
      if (sql.startsWith("SELECT id,product_id")) return { recordset: [structuredClone(state.item)] };
      if (sql.startsWith("UPDATE dbo.sale_items")) state.item.refunded_qty += Number(p.qty);
      else if (sql.startsWith("IF NOT EXISTS(SELECT 1 FROM dbo.stock_delta_applied")) {
        const inserted = !state.movements[String(p.movement)];
        state.movements[String(p.movement)] = true;
        return { recordset: [{ inserted }] };
      } else if (sql.startsWith("UPDATE dbo.products")) { state.stock += Number(p.qty); state.stockWrites++; }
      else if (sql.startsWith("UPDATE dbo.sales")) { state.sale.is_refunded = true; state.sale.row_version++; }
      else if (sql.startsWith("INSERT dbo.sync_change_journal")) state.journalRows++;
      else if (sql.startsWith("INSERT dbo.local_operation_receipts"))
        state.receipts[String(p.refund)] = { operation_type: "refund", entity_id: String(p.sale), note: p.reason as string | null };
      else throw Error("Unexpected SQL in owned refund fixture: " + sql);
      return { recordset: [], rowsAffected: [1] };
    }
  }
  const captureScope = () => {
    if (!person.is_active || !person.permissions.can_process_refund) throw Object.assign(Error("Refund permission revoked"), { code: "EPRIVILEGE" });
    const epoch = mainEpoch;
    return { branchId: branch, terminalId: "terminal", requesterId: actor, requester: "admin",
      assertCurrent() { if (epoch !== mainEpoch) throw Object.assign(Error("Main source changed"), { code: "EAPPROVAL_CONTEXT" }); } };
  };
  const audits = new Map<string, unknown>();
  const store = {
    request: (tx?: Transaction) => new Request(tx),
    readPolicy: vi.fn(async () => structuredClone(policy)),
    readPrior: vi.fn(async (id: string) => audits.get(id)),
    persist: vi.fn(async (_scope: unknown, request: { requestId: string }, value: unknown, check: (p: typeof policy) => Promise<void>) => {
      await check(structuredClone(policy)); audits.set(request.requestId, value);
    }),
  };
  const service = new RefundApprovalService({ captureScope, verify: vi.fn(), store, now: () => now });
  const manager = { pool: { request: () => new Request() }, sql: () => ({ Transaction, Request, ISOLATION_LEVEL: { SERIALIZABLE: 4 } }) };
  const repository = new ReceiptRepository(manager, null);
  const args = { saleId, branchId: "A", refundId: `refund:${saleId}` };
  const authorizationInput = (grantToken: string | null = null) => ({ saleId, branchId: "A", registeredTerminalId: "terminal", requestedAmount: 12.3, grantToken });
  const authorize = vi.fn(async (grant: string | null) => {
    try {
      const result = await service.authorize(authorizationInput(grant));
      return { ok: true, nativeRefundGrant: result.grantToken };
    } catch (error) {
      const e = error as { code: string; message: string };
      return { ok: false, code: e.code, error: e.message };
    }
  });
  const save = vi.fn(async (grant: string | null | undefined) => {
    const admission = service.admission(grant, args);
    const result = await repository.refund(args, null, null, admission);
    if (result.ok) admission.complete(); // same Main ordering, before IPC reply
    if (loseReply) { loseReply = false; throw Error("IPC reply lost after SQL commit"); }
    return result;
  });
  const accepted = vi.fn();
  const input = () => ({ saleId, branchId: "A", amount: 12.3, grantToken: null as string | null,
    context: () => uiContext, authorize, save, accepted });
  return { service, repository, input, args, authorizationInput, authorize, save, accepted, store, person, policy,
    ledger: () => ledger, noLostReply: () => { loseReply = false; }, advance: (ms = 120001) => { now += ms; },
    actorChange: () => { actor = itemId; mainEpoch++; }, branchChange: () => { branch = "B"; mainEpoch++; },
    sourceChange: () => { mainEpoch++; }, uiChange: () => { uiContext += ":changed"; },
  };
}

/** Execute the actual PosProvider callback and receipt confirmation control flow. */
function receiptUi(f: ReturnType<typeof fixture>, attempts: RefundSaveAttempts) {
  const selected = { id: saleId, storeId: "A", total: 12.3, receiptNo: "A-1", refunded: false, lines: [{ productId, qty: 1 }] };
  const stateRef = { current: { sales: [selected], products: [{ id: productId, quantity: 10 }], settings: { integrations: { autoArchiveZeroStock: true } } } };
  const audit = vi.fn(), activity = vi.fn();
  const providerSource = readFileSync(new URL("../pos-store.tsx", import.meta.url), "utf8");
  const providerStart = providerSource.indexOf("  const hasUncertainRefundSale = useCallback");
  const providerEnd = providerSource.indexOf("  /** Correct the tender", providerStart);
  expect(providerStart).toBeGreaterThan(0); expect(providerEnd).toBeGreaterThan(providerStart);
  const providerJs = ts.transpileModule(providerSource.slice(providerStart, providerEnd), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const provider = new Function("useCallback", "stateRef", "refundSaveAttempts", "refundContext", "db", "logger", "recordActivity", "setState", "bump", "require",
    providerJs + "\nreturn {refundSale,hasUncertainRefundSale};")(
    (fn: unknown) => fn, stateRef, { current: attempts }, f.input().context,
    { refundSale: async (sale: string, refund: string, reason: unknown, branch: string, grant: string | null) => {
      expect({ sale, refund, reason, branch }).toEqual({ sale: saleId, refund: `refund:${saleId}`, reason: undefined, branch: "A" });
      return f.save(grant);
    } }, { log: audit }, activity,
    (update: (state: typeof stateRef.current) => typeof stateRef.current) => { stateRef.current = update(stateRef.current); },
    (product: { quantity: number }, _branch: string, quantity: number) => ({ ...product, quantity: product.quantity + quantity }),
    (name: string) => {
      if (name === "./authorization-client") return { verifyRefundAuthorization: (input: { data: { grantToken: string | null } }) => f.authorize(input.data.grantToken) };
      if (name === "./pos-caller-auth") return { getPosCallerAuth: async () => ({}) };
      throw Error("Unexpected refund import: " + name);
    },
  );
  const routeSource = readFileSync(new URL("../../routes/receipts.tsx", import.meta.url), "utf8");
  const routeStart = routeSource.indexOf("  async function performCancel()");
  const routeEnd = routeSource.indexOf("  function logActivity(", routeStart);
  expect(routeStart).toBeGreaterThan(0); expect(routeEnd).toBeGreaterThan(routeStart);
  const routeJs = ts.transpileModule(routeSource.slice(routeStart, routeEnd), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const issuer = vi.fn(async () => ({ ok: true, grantToken: null }));
  const hold = vi.fn(async () => {}), cancelAudit = vi.fn(), close = vi.fn(), notify = vi.fn();
  const environment = {
    cancelMode: "cancel", selected, cancelReason: "Reviewed fixture cancellation", pendingCorrectionHold: null,
    pendingCorrectionAudit: null, retryingCorrectionHold: false, retryingCorrectionAudit: false,
    currentStore: { id: "A" }, user: { staffId }, authorize: issuer, ...provider,
    toast: { error: vi.fn(), success: vi.fn() }, setCancelOpen: close, setOlder: vi.fn(),
    saleCorrectionContext: () => ({}), holdCancelledBill: hold, setPendingCorrectionHold: vi.fn(),
    rememberPendingCorrectionHold: vi.fn(), logActivity: cancelAudit, notifyError: notify,
  };
  const performCancel = new Function(...Object.keys(environment), routeJs + "\nreturn performCancel;")(...Object.values(environment)) as () => Promise<void>;
  function button() {
    const label = routeSource.indexOf('"Confirm saved cancellation"');
    const start = routeSource.lastIndexOf("<Button", label), end = routeSource.indexOf("</Button>", label) + "</Button>".length;
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
    const js = ts.transpileModule("const button = (" + routeSource.slice(start, end) + ");", {
      compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    return new Function("React", "Button", "Ban", "selected", "hasUncertainRefundSale", "openCancel", js + "\nreturn button;")(
      { createElement: (_type: unknown, props: { disabled: boolean }, ...children: unknown[]) => ({ props, children }) },
      "button", "icon", selected, provider.hasUncertainRefundSale, vi.fn(),
    ) as { props: { disabled: boolean }; children: unknown[] };
  }
  return { performCancel, selected, stateRef, provider, issuer, hold, audit, activity, cancelAudit, close, notify, button };
}

describe("the PosProvider refund save attempt", () => {
  it("retries a lost IPC reply through the same Main grant and proven receipt, with stock and activity once", async () => {
    const f = fixture(), attempts = new RefundSaveAttempts();
    await expect(attempts.run(f.input())).rejects.toThrow("IPC reply lost");
    expect(f.ledger()).toMatchObject({ stock: 11, stockWrites: 1, journalRows: 4, sale: { is_refunded: true } });
    expect(f.accepted).not.toHaveBeenCalled();
    // The previous renderer path lost the internal grant and reached EALREADY.
    await expect(f.service.authorize(f.authorizationInput())).rejects.toMatchObject({ code: "EALREADY" });
    const originalGrant = f.save.mock.calls[0][0];
    f.advance(310000);
    await expect(attempts.run(f.input())).resolves.toBe(true);
    expect(f.authorize.mock.calls[1][0]).toBe(originalGrant);
    expect(f.save.mock.calls[1][0]).toBe(originalGrant);
    await expect(f.save.mock.results[1].value).resolves.toMatchObject({ ok: true, replayed: true });
    expect(f.store.persist).toHaveBeenCalledOnce();
    expect(f.accepted).toHaveBeenCalledOnce();
    expect(f.ledger()).toMatchObject({ stock: 11, stockWrites: 1, journalRows: 4 });
    expect(Object.keys(f.ledger().receipts)).toHaveLength(1);
    expect(Object.keys(f.ledger().movements)).toHaveLength(1);
  });

  it("coalesces the entire save and its post-ACK audit/UI callback", async () => {
    const f = fixture(), attempts = new RefundSaveAttempts(); f.noLostReply();
    const first = attempts.run(f.input()), second = attempts.run(f.input());
    expect(second).toBe(first);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(f.authorize).toHaveBeenCalledOnce(); expect(f.save).toHaveBeenCalledOnce(); expect(f.accepted).toHaveBeenCalledOnce();
  });

  it.each(["actor", "branch", "source", "revocation"])("Main still denies %s changes on a retained handle", async (change) => {
    const f = fixture(), attempts = new RefundSaveAttempts();
    await expect(attempts.run(f.input())).rejects.toThrow("IPC reply lost");
    if (change === "actor") f.actorChange();
    if (change === "branch") f.branchChange();
    if (change === "source") f.sourceChange();
    if (change === "revocation") f.person.permissions.can_process_refund = false;
    await expect(attempts.run(f.input())).rejects.toThrow();
    expect(f.save).toHaveBeenCalledOnce(); expect(f.accepted).not.toHaveBeenCalled();
    expect(f.ledger()).toMatchObject({ stock: 11, stockWrites: 1, journalRows: 4 });
  });

  it("never rebinds an uncertain handle to a changed amount or branch", async () => {
    const f = fixture(), attempts = new RefundSaveAttempts();
    await expect(attempts.run(f.input())).rejects.toThrow("IPC reply lost");
    await expect(attempts.run({ ...f.input(), amount: 12.31 })).rejects.toThrow("different saved receipt");
    await expect(attempts.run({ ...f.input(), branchId: "B" })).rejects.toThrow("different saved receipt");
    expect(f.authorize).toHaveBeenCalledOnce(); expect(f.save).toHaveBeenCalledOnce();
  });

  it("requires the original receipt proof and never bypasses a bare refunded flag", async () => {
    const f = fixture(), attempts = new RefundSaveAttempts();
    await expect(attempts.run(f.input())).rejects.toThrow("IPC reply lost");
    f.ledger().receipts = {};
    await expect(attempts.run(f.input())).rejects.toMatchObject({ code: "EALREADY" });
    expect(f.accepted).not.toHaveBeenCalled(); expect(f.ledger().stockWrites).toBe(1);
  });

  it("rejects a receipt belonging to a different original operation", async () => {
    const f = fixture(), attempts = new RefundSaveAttempts();
    await expect(attempts.run(f.input())).rejects.toThrow("IPC reply lost");
    Object.values(f.ledger().receipts)[0].entity_id = itemId;
    await expect(attempts.run(f.input())).rejects.toMatchObject({ code: "EIDEMPOTENCY" });
    expect(f.accepted).not.toHaveBeenCalled(); expect(f.ledger().stockWrites).toBe(1);
  });

  it("does not save after the renderer context changes during authorization", async () => {
    const f = fixture(), attempts = new RefundSaveAttempts();
    const input = f.input(); input.authorize = vi.fn(async (grant: string | null) => { const value = await f.authorize(grant); f.uiChange(); return value; });
    await expect(attempts.run(input)).rejects.toMatchObject({ code: "EREFUND_CONTEXT" });
    expect(f.save).not.toHaveBeenCalled(); expect(f.accepted).not.toHaveBeenCalled(); expect(f.ledger().stock).toBe(10);
  });

  it("keeps a committed refund but suppresses stale audit/UI completion", async () => {
    const f = fixture(), attempts = new RefundSaveAttempts(); f.noLostReply();
    const input = f.input(); input.save = vi.fn(async (grant: string | null | undefined) => { const value = await f.save(grant); f.uiChange(); return value; });
    await expect(attempts.run(input)).rejects.toMatchObject({ code: "EREFUND_CONTEXT" });
    expect(f.accepted).not.toHaveBeenCalled(); expect(f.ledger()).toMatchObject({ stock: 11, stockWrites: 1 });
  });

  it("expires an unused approval before commit and permits a separately requested fresh approval", async () => {
    const f = fixture(), attempts = new RefundSaveAttempts(); f.noLostReply();
    const initial = f.input(); initial.save = vi.fn(async (grant: string | null | undefined) => { f.advance(); return f.save(grant); });
    await expect(attempts.run(initial)).rejects.toMatchObject({ code: "EAPPROVAL_EXPIRED" });
    expect(f.authorize).toHaveBeenCalledOnce(); expect(f.ledger().stock).toBe(10);
    const fresh = await f.service.authorize(f.authorizationInput());
    await expect(attempts.run({ ...f.input(), grantToken: fresh.grantToken })).resolves.toBe(true);
    expect(f.authorize.mock.calls[1][0]).toBe(fresh.grantToken);
    expect(f.ledger()).toMatchObject({ stock: 11, stockWrites: 1 });
  });

  it("retains an uncertain admission until Main proves it expired unused", async () => {
    const f = fixture(), attempts = new RefundSaveAttempts(); f.noLostReply();
    await expect(attempts.run({ ...f.input(), save: vi.fn(async () => { throw Error("IPC unavailable before SQL"); }) })).rejects.toThrow();
    f.advance();
    await expect(attempts.run(f.input())).rejects.toMatchObject({ code: "EAPPROVAL_EXPIRED" });
    expect(f.save).not.toHaveBeenCalled(); expect(f.ledger().stock).toBe(10);
    const fresh = await f.service.authorize(f.authorizationInput());
    await expect(attempts.run({ ...f.input(), grantToken: fresh.grantToken })).resolves.toBe(true);
    expect(f.authorize.mock.calls[2][0]).toBe(fresh.grantToken);
  });

  it("lets the UI reject a deferred state update after its context changes", async () => {
    const f = fixture(), attempts = new RefundSaveAttempts(); f.noLostReply();
    let apply: (() => void) | undefined;
    const reflect = vi.fn();
    await attempts.run({ ...f.input(), accepted: isCurrent => { apply = () => { if (isCurrent()) reflect(); }; } });
    f.uiChange(); apply?.();
    expect(reflect).not.toHaveBeenCalled();
    expect(f.ledger()).toMatchObject({ stock: 11, stockWrites: 1 });
  });

  it.each(["renderer restart", "Main retention"])("does not invent replay authority after %s", async boundary => {
    const f = fixture(); let attempts = new RefundSaveAttempts();
    await expect(attempts.run(f.input())).rejects.toThrow("IPC reply lost");
    if (boundary === "renderer restart") attempts = new RefundSaveAttempts();
    else f.service.grants.clear();
    await expect(attempts.run(f.input())).rejects.toThrow();
    expect(f.accepted).not.toHaveBeenCalled(); expect(f.save).toHaveBeenCalledOnce();
    expect(f.ledger()).toMatchObject({ stock: 11, stockWrites: 1, journalRows: 4 });
  });

  it("does not retain hosted grants or turn a retry into a cloud fallback", async () => {
    const attempts = new RefundSaveAttempts(), tokens: Array<string | null> = [];
    const save = vi.fn().mockRejectedValueOnce(Error("uncertain cloud reply")).mockResolvedValueOnce(undefined);
    const input = { saleId, branchId: "A", amount: 12.3, context: () => "web:A", accepted: vi.fn(), save,
      authorize: vi.fn(async (grant: string | null) => { tokens.push(grant); return { ok: true }; }) };
    await expect(attempts.run({ ...input, grantToken: "hosted-original" })).rejects.toThrow();
    await expect(attempts.run({ ...input, grantToken: "hosted-fresh" })).resolves.toBe(true);
    expect(tokens).toEqual(["hosted-original", "hosted-fresh"]);
    expect(save.mock.calls.map(call => call[0])).toEqual(["hosted-original", "hosted-fresh"]);
  });
});

describe("the refund's existing database-state fence", () => {
  const ready = { state: "enabled_ready", enabled: true, configured: true, connected: true, tradingReady: true,
    profile: { id: "profile-A", host: "owned-fixture", database: "FixtureA", port: 1433 } };

  it("ignores unchanged health/activity but observes a local-to-local connection replacement before UI acknowledgement", async () => {
    let emit!: (state: LocalStartupState) => void, revision = 0;
    const stop = observeRefundDatabaseContext({ getState: async () => ready, subscribe: cb => { emit = cb; return () => {}; } }, () => { revision++; });
    await Promise.resolve();
    const initial = revision;
    emit({ ...ready, startupPaused: true, startupActivity: { active: true, phase: "checking", updatedAt: "later" } });
    expect(revision).toBe(initial);
    const f = fixture(), attempts = new RefundSaveAttempts(); f.noLostReply();
    await expect(attempts.run({ ...f.input(), context: () => String(revision), save: async grant => {
      const result = await f.save(grant);
      emit({ ...ready, profile: { ...ready.profile, id: "profile-B", database: "FixtureB" } } as LocalStartupState);
      return result;
    } })).rejects.toMatchObject({ code: "EREFUND_CONTEXT" });
    expect(revision).toBe(initial + 1); expect(f.accepted).not.toHaveBeenCalled();
    expect(f.ledger()).toMatchObject({ stock: 11, stockWrites: 1 }); stop();
  });

  it("invalidates a same-profile reconnect and refuses an older initial snapshot", async () => {
    let emit!: (state: LocalStartupState) => void, resolve!: (state: LocalStartupState) => void;
    const changed = vi.fn(), unsubscribe = vi.fn();
    const stop = observeRefundDatabaseContext({ getState: () => new Promise(r => { resolve = r; }),
      subscribe: cb => { emit = cb; return unsubscribe; } }, changed);
    emit(ready);
    emit({ ...ready, state: "enabled_connecting", connected: false, tradingReady: false });
    emit(ready);
    resolve({ ...ready, state: "disabled", connected: false }); await Promise.resolve();
    expect(changed).toHaveBeenCalledTimes(3); stop(); expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

describe("receipt cancellation reaches the retained Main proof before another issuer", () => {
  it("confirms the saved refund after a lost IPC response and a refunded background snapshot", async () => {
    const f = fixture(), h = receiptUi(f, new RefundSaveAttempts());
    await h.performCancel();
    expect(h.notify).toHaveBeenCalledOnce(); expect(h.issuer).toHaveBeenCalledOnce();
    expect(h.audit).not.toHaveBeenCalled(); expect(h.hold).not.toHaveBeenCalled();
    // A subsequent ordinary snapshot sees the committed SQL refund and stock.
    h.selected.refunded = true; h.stateRef.current.products[0].quantity = 11;
    const button = h.button(); expect(button.props.disabled).toBe(false);
    expect(button.children).toContain("Confirm saved cancellation");
    h.issuer.mockImplementation(async () => { throw Error("A fresh issuer must not run for the committed refund"); });
    await h.performCancel();
    expect(h.issuer).toHaveBeenCalledOnce(); expect(h.audit).toHaveBeenCalledOnce(); expect(h.activity).toHaveBeenCalledOnce();
    expect(h.hold).toHaveBeenCalledOnce(); expect(h.cancelAudit).toHaveBeenCalledOnce(); expect(h.close).toHaveBeenCalledWith(false);
    expect(h.stateRef.current.products[0].quantity).toBe(11);
    expect(f.ledger()).toMatchObject({ stock: 11, stockWrites: 1, journalRows: 4 });
    expect(h.button().props.disabled).toBe(true);
  });

  it("does not reuse a pending handle or skip the ordinary issuer after a context change", async () => {
    const f = fixture(), h = receiptUi(f, new RefundSaveAttempts());
    await h.performCancel(); f.uiChange();
    h.issuer.mockResolvedValue({ ok: false, grantToken: null });
    await h.performCancel();
    expect(h.issuer).toHaveBeenCalledTimes(2); expect(f.save).toHaveBeenCalledOnce();
    h.selected.refunded = true;
    expect(h.button().props.disabled).toBe(true);
    expect(h.button().children).toContain("Bill already cancelled");
    expect(h.audit).not.toHaveBeenCalled(); expect(h.hold).not.toHaveBeenCalled();
  });
});
