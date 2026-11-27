import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
const dialog = readFileSync("src/platforms/web/components/pos/ShiftCloseDialog.tsx", "utf8").replaceAll("\r\n", "\n");
const printer = readFileSync("src/lib/receipt-printer.ts", "utf8");
describe("shift closing refresh and hardware boundaries", () => {
  it("retains totals during background refresh and scopes them to the operator and shift", () => {
    expect(dialog).toContain("expectedSnapshot?.owner === owner");
    expect(dialog).not.toContain("setExpected(null)");
    expect(dialog).not.toContain("[open,activeShift,step");
    expect(dialog).toContain("}, [open, owner]);");
  });
  it("authorizes closure before attempting hardware and continues after a drawer failure", () => {
    const start = dialog.indexOf("const res = await startShiftClose");
    const drawer = dialog.indexOf("const drawer = await openCashDrawer");
    expect(start).toBeLessThan(drawer);
    expect(dialog.slice(drawer, dialog.indexOf("Starting shift close", drawer))).not.toContain(
      "return;",
    );
    expect(dialog).toContain("if (canOpenDrawer())");
    expect(printer).toContain('return typeof printBridge()?.openDrawer === "function";');
  });
});

function closingDialogActions(finish: () => Promise<boolean>) {
  const start = dialog.indexOf("async function handleState(");
  const end = dialog.indexOf("\n  return (", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const invoke = new Function("fixture", `
    const { finish, setServerState, setStep, onOpenChange, busyRef, setBusy, notifyError,
      recordDiagnostic, reasonCode, shiftId, toast } = fixture;
    ${dialog.slice(start, end)
      .replace("next: ShiftState", "next")
      .replace("action: () => Promise<void>, context: string", "action, context")}
    return { handleState, runBusy };
  `);
  const fixture = {
    finish, setServerState: vi.fn(), setStep: vi.fn(), onOpenChange: vi.fn(), busyRef: { current: false },
    setBusy: vi.fn(), notifyError: vi.fn(), recordDiagnostic: vi.fn(), reasonCode: () => "failed",
    shiftId: "fixture-shift", toast: { warning: vi.fn() },
  };
  return { ...fixture, ...invoke(fixture) as {
    handleState: (state: string) => Promise<void>;
    runBusy: (work: () => Promise<void>, context: string) => Promise<void>;
  } };
}

describe("shift-close submission and confirmed completion", () => {
  it("keeps a confirmed closure saved when refreshing the screen fails", async () => {
    const probe = closingDialogActions(async () => { throw new Error("Renderer refresh failed"); });
    await probe.runBusy(() => probe.handleState("CLOSED"), "Submitting the shift cash count");
    expect(probe.setServerState).toHaveBeenCalledWith("CLOSED");
    expect(probe.recordDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ recordId: "fixture-shift" }));
    expect(probe.toast.warning).toHaveBeenCalledWith("Shift saved · refresh Shifts to view the closing");
    expect(probe.notifyError).not.toHaveBeenCalled();
    expect(probe.setStep).toHaveBeenCalledWith("done");
    expect(probe.onOpenChange).toHaveBeenCalledWith(false);
    expect(probe.busyRef.current).toBe(false);
  });

  it("ends a confirmed closing even when the active shift is no longer in the view", async () => {
    const probe = closingDialogActions(async () => false);
    await probe.handleState("CLOSED");
    expect(probe.toast.warning).toHaveBeenCalledWith("Shift saved · refresh Shifts to view the closing");
    expect(probe.setStep).toHaveBeenCalledWith("done");
    expect(probe.notifyError).not.toHaveBeenCalled();
  });

  it("still reports an actual submission exception before closure is confirmed", async () => {
    const finish = vi.fn(async () => true);
    const probe = closingDialogActions(finish);
    const error = new Error("Cash count refused");
    await probe.runBusy(async () => { throw error; }, "Submitting the shift cash count");
    expect(probe.notifyError).toHaveBeenCalledWith(error, "Submitting the shift cash count");
    expect(probe.toast.warning).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
    expect(probe.busyRef.current).toBe(false);
  });

  it("reports an automatic window-close failure as a follow-up", async () => {
    const start = dialog.indexOf("    if (synchronized.ok && printed.ok)");
    const end = dialog.indexOf("\n    return true;", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const invoke = new Function("fixture", `const { synchronized, printed, localDb, console, toast, reasonCode } = fixture;
      return (async () => { ${dialog.slice(start, end)} })();
    `);
    const closeWindow = vi.fn(async () => { throw new Error("Window close failed"); });
    const toast = { warning: vi.fn() };
    await expect(invoke({
      synchronized: { ok: true }, printed: { ok: true }, localDb: () => ({ closeWindow }), toast,
      console: { warn: vi.fn() }, reasonCode: () => "failed",
    })).resolves.toBeUndefined();
    expect(closeWindow).toHaveBeenCalledOnce();
    expect(toast.warning).toHaveBeenCalledWith("Shift saved · the app could not close automatically");
  });
});
