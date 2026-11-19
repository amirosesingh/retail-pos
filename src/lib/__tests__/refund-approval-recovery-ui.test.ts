import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
const ts = createRequire(import.meta.url)("typescript") as typeof import("typescript");
type Node = { type: unknown; props: { children?: unknown; onClick?: () => void; disabled?: boolean } };
const original = { operationId: "22222222-2222-4222-8222-222222222222", saleId: "sale", branchId: "A", refundId: "refund:sale",
  amountMinor: "1230", expectedSaleVersion: "1", route: "grouped", requiresApproval: true };

/** Run the actual component's effects and approval handler with bounded hook
 * state. Monetary writers are deliberately absent from the fixture. */
function panel() {
  let index = 0, effectIndex = 0, person = "cashier", allowed = true;
  const slots: unknown[] = [], deps: Array<unknown[] | undefined> = [], cleanups: unknown[] = [], effects: (() => void)[] = [];
  const react = {
    useState(initial: unknown) { const at = index++; if (!(at in slots)) slots[at] = initial;
      return [slots[at], (value: unknown) => { slots[at] = typeof value === "function" ? value(slots[at]) : value; }]; },
    useRef(initial: unknown) { const at = index++; return slots[at] ??= { current: initial }; },
    useCallback(callback: unknown, next: unknown[]) { const at = index++, prior = slots[at] as { value: unknown; deps: unknown[] } | undefined;
      if (prior && next.every((value, n) => Object.is(value, prior.deps[n]))) return prior.value;
      slots[at] = { value: callback, deps: next }; return callback; },
    useEffect(work: () => unknown, next: unknown[]) { const at = effectIndex++, prior = deps[at];
      if (prior && next.every((value, n) => Object.is(value, prior[n]))) return;
      deps[at] = next; effects.push(() => { if (typeof cleanups[at] === "function") (cleanups[at] as () => void)(); cleanups[at] = work(); }); },
  };
  const status = vi.fn(async (): Promise<typeof original | null> => original), attach = vi.fn(async () => {});
  const authorize = vi.fn(async (): Promise<{ ok: boolean; grantToken: string | null }> => ({ ok: true, grantToken: "fresh-admission" }));
  const success = vi.fn(), failure = vi.fn(), off = vi.fn(), subscribe = vi.fn(() => off);
  const jsx = (type: unknown, props: Node["props"]) => ({ type, props });
  const modules: Record<string, unknown> = { react, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    sonner: { toast: { success } }, "@/components/ui/button": { Button: "button" },
    "@/core/local-db/local-db": { localDb: () => ({ getRefundApprovalStatus() {}, sync: { subscribe } }) },
    "@/lib/pos-auth": { useAuth: () => ({ user: { staffId: person }, can: () => allowed }) },
    "@/lib/manager-gate": { useManagerGate: () => ({ authorize }) },
    "@/lib/refund-approval-recovery-client": { pendingRefundApproval: status, recoverRefundApproval: attach, refundApprovalAmount: () => 12.3 },
    "@/lib/session-epoch": { sessionEpoch: () => 1 }, "@/lib/notify": { notifyError: failure } };
  const module = { exports: {} as { RefundApprovalRecovery?: (props: unknown) => Node | null } };
  const compiled = ts.transpileModule(readFileSync("src/platforms/windows/components/RefundApprovalRecovery.tsx", "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(compiled, { module, exports: module.exports, require: (name: string) => {
    if (!(name in modules)) throw Error("Unexpected refund UI dependency: " + name); return modules[name]; } });
  const render = (sale = { id: "sale", refunded: true, receiptNo: "original" }) => {
    index = 0; effectIndex = 0;
    const tree = module.exports.RefundApprovalRecovery!({ sale, branchId: "A" });
    effects.splice(0).forEach(effect => effect()); return tree;
  };
  const settle = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
  const text = (node: unknown): string => !node || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("")
    : typeof node !== "object" ? String(node) : text((node as Node).props.children);
  const button = (node: unknown): Node | undefined => {
    if (Array.isArray(node)) return node.map(button).find(Boolean);
    if (!node || typeof node !== "object") return;
    if ((node as Node).type === "button") return node as Node;
    return button((node as Node).props.children);
  };
  return { render, settle, text, button, status, attach, authorize, success, failure, subscribe, off,
    setPerson(value: string) { person = value; }, deny() { allowed = false; },
    unmount() { for (const cleanup of cleanups) if (typeof cleanup === "function") cleanup(); } };
}

describe("saved refund recovery action", () => {
  it("does not query or add idle subscriptions to ordinary unrefunded receipts", async () => {
    const f = panel(); expect(f.render({ id: "sale", refunded: false, receiptNo: "original" })).toBeNull();
    await f.settle(); expect(f.status).not.toHaveBeenCalled(); expect(f.subscribe).not.toHaveBeenCalled();
  });
  it("uses the existing refund approval dialog for the exact already-saved operation", async () => {
    const f = panel(); f.render(); await f.settle(); const tree = f.render();
    expect(f.text(tree)).toContain("already saved locally");
    f.button(tree)!.props.onClick!(); await f.settle();
    expect(f.authorize).toHaveBeenCalledOnce();
    expect(f.authorize.mock.calls[0]).toMatchObject([{ action: "refund", refundRecoveryOperationId: original.operationId,
      storeId: "A", requestedAmount: 12.3, payload: { sale_id: "sale" } }]);
    expect(f.attach).toHaveBeenCalledExactlyOnceWith(original, "fresh-admission");
    expect(f.success).toHaveBeenCalledOnce();
  });
  it("does not ask for another approval on durable evidence merely waiting for acknowledgement", async () => {
    const f = panel(); f.status.mockResolvedValue({ ...original, requiresApproval: false });
    f.render(); await f.settle(); const tree = f.render();
    expect(f.text(tree)).toContain("waiting for central acknowledgement"); expect(f.button(tree)).toBeUndefined();
    expect(f.authorize).not.toHaveBeenCalled();
  });
  it("holds the saved operation on denied approval or failed attachment", async () => {
    const f = panel(); f.authorize.mockResolvedValueOnce({ ok: false, grantToken: null });
    f.render(); await f.settle(); f.button(f.render())!.props.onClick!(); await f.settle();
    expect(f.attach).not.toHaveBeenCalled(); expect(f.success).not.toHaveBeenCalled();
    f.attach.mockRejectedValueOnce(Error("approval not saved")); f.button(f.render())!.props.onClick!(); await f.settle();
    expect(f.failure).toHaveBeenCalledOnce(); expect(f.success).not.toHaveBeenCalled();
    expect(f.text(f.render())).toContain("already saved locally");
  });
  it("discards an approval dialog result if the selected receipt or person changed", async () => {
    for (const changed of ["receipt", "person", "unmount"]) {
      const f = panel(); let release!: (result: { ok: boolean; grantToken: string }) => void;
      f.authorize.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
      f.render(); await f.settle(); f.button(f.render())!.props.onClick!();
      if (changed === "receipt") f.render({ id: "other", refunded: true, receiptNo: "other" });
      if (changed === "person") { f.setPerson("different"); f.render(); }
      if (changed === "unmount") f.unmount();
      release({ ok: true, grantToken: "late" }); await f.settle(); expect(f.attach).not.toHaveBeenCalled();
    }
  });
  it("requires refund permission and cleans up the pending-operation observer", async () => {
    const f = panel(); f.render(); await f.settle(); f.render(); expect(f.subscribe).toHaveBeenCalledOnce();
    f.deny(); expect(f.render()).toBeNull(); expect(f.off).toHaveBeenCalledOnce();
  });
});
