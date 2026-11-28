import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { describe, expect, it, vi } from "vitest";
import type { Shift } from "@/core/types/pos-types";
import { sameRecordId } from "../sale-identity";

const source = readFileSync(new URL("../pos-store.tsx", import.meta.url), "utf8");
const start = source.indexOf("  const closeShift = useCallback(");
const end = source.indexOf("  const recordSale = useCallback(", start);
const callback = transpileModule(source.slice(start, end), {
  compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
}).outputText;

function fixture(native: boolean, platform = native ? "electron" : "web") {
  const activeShift: Shift = {
    id: "fixture-shift", storeId: "fixture-branch", terminalId: "fixture-terminal",
    cashier: "Cashier", openingFloat: 20, openedAt: "2026-11-27T01:00:00.000Z",
    closedAt: null, countedCash: null, note: "", status: "OPEN", state: "CASH_COUNT_REQUIRED",
  };
  let state = { shifts: [activeShift] };
  let epoch = 1;
  const bootstrapGeneration = { current: 1 };
  const stateRef = { current: { currentStoreId: activeShift.storeId } };
  const actorStaffIdRef = { current: "staff-a" };
  const rawUpsert = vi.fn().mockRejectedValue(new Error("SHIFT_OPEN_INVALID"));
  const recordActivity = vi.fn().mockResolvedValue(undefined);
  const trackTransition = vi.fn().mockResolvedValue(undefined);
  const publishCompleteShiftSummary = vi.fn().mockResolvedValue({ ok: true });
  const getPosCallerAuth = vi.fn().mockResolvedValue({ cashierToken: "fixture" });
  const endShiftSessions = vi.fn();
  const setDbShift = vi.fn();
  const recordDiagnostic = vi.fn();
  const toast = { warning: vi.fn() };
  const context = {
    useCallback: (work: unknown) => work,
    activeShift, isAdmin: false, can: () => false, user: { name: "Cashier", staffId: "staff-a", role: "staff" },
    terminalUser: null, readTerminalConfig: () => ({ tokenId: activeShift.terminalId }), sameRecordId,
    localTerminalId: () => activeShift.terminalId, localDb: () => native ? {} : null,
    db: { commitShift: rawUpsert }, isShiftOverdue: () => false, defaultTradingHours: {},
    sessionEpoch: () => epoch, bootstrapGeneration, stateRef, actorStaffIdRef,
    justOpenedRef: { current: null }, shiftReadSequence: { current: 0 }, shiftMutationSequence: { current: 0 },
    setState: (update: (current: typeof state) => typeof state) => { state = update(state); },
    setDbShift, setShiftChecked: vi.fn(), endShiftSessions, trackTransition, recordActivity, logger: { log: vi.fn() },
    notifyError: vi.fn(), platformName: () => platform, toast, recordDiagnostic,
    reasonCode: () => "connection", require: (name: string) => {
      if (name === "./shift-summary-client") return { publishCompleteShiftSummary };
      if (name === "./pos-caller-auth") return { getPosCallerAuth };
      throw new Error(`Unexpected fixture import ${name}`);
    },
  };
  const mirror = runInNewContext(`${callback}\ncloseShift;`, context) as
    (countedCash: number, note: string, extras?: Partial<Shift>) => Promise<Shift | null>;
  const changeScope = {
    session: () => { epoch++; },
    branch: () => { stateRef.current.currentStoreId = "branch-b"; },
    "branch generation": () => { bootstrapGeneration.current += 2; },
    actor: () => { actorStaffIdRef.current = "staff-b"; },
  };
  return { mirror, rawUpsert, recordActivity, trackTransition, publishCompleteShiftSummary, getPosCallerAuth,
    endShiftSessions, setDbShift, recordDiagnostic, toast, changeScope, state: () => state };
}

describe("the shift-close provider after an authoritative CLOSED reply", () => {
  it.each([false, true])("mirrors the saved close without a second shift write, native=%s", async native => {
    const app = fixture(native);
    await expect(app.mirror(50, "Closing note", { countedCard: 9 })).resolves.toMatchObject({
      id: "fixture-shift", state: "CLOSED", status: "CLOSED", countedCash: 50, countedCard: 9, note: "Closing note",
    });
    expect(app.rawUpsert).not.toHaveBeenCalled();
    expect(app.state().shifts[0]).toMatchObject({ state: "CLOSED", closedByStaffId: "staff-a" });
    expect(app.endShiftSessions).toHaveBeenCalledExactlyOnceWith({ shiftId: "fixture-shift" });
    expect(app.setDbShift).toHaveBeenCalledExactlyOnceWith(null);
    expect(app.trackTransition).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ entityId: "fixture-shift", to: "CLOSED", reason: "Closing note" }));
    expect(app.recordActivity).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: "shift_close", entityId: "fixture-shift", amount: 50 }));
    if (native) expect(app.publishCompleteShiftSummary).not.toHaveBeenCalled();
    else expect(app.publishCompleteShiftSummary).toHaveBeenCalledExactlyOnceWith({ data: { cashierToken: "fixture", shiftId: "fixture-shift" } });
    expect(app.toast.warning).not.toHaveBeenCalled();
  });

  it("keeps the saved browser close and reports unconfirmed summary publication separately", async () => {
    const app = fixture(false);
    app.publishCompleteShiftSummary.mockRejectedValueOnce(new Error("connection lost after request"));

    await expect(app.mirror(50, "Closing note")).resolves.toMatchObject({ state: "CLOSED" });
    expect(app.state().shifts[0]).toMatchObject({ state: "CLOSED", countedCash: 50 });
    expect(app.rawUpsert).not.toHaveBeenCalled();
    expect(app.recordActivity).toHaveBeenCalledOnce();
    expect(app.recordDiagnostic).toHaveBeenCalledExactlyOnceWith({
      kind: "soft_write_failed", entity: "shift summary", code: "connection", recordId: "fixture-shift",
    });
    expect(app.toast.warning).toHaveBeenCalledExactlyOnceWith("Shift saved · summary publication unconfirmed", {
      description: "The closure is available in Shifts. Ask an administrator to check the summary and notification delivery.",
    });
  });

  it("keeps the existing mobile follow-up behavior", async () => {
    const app = fixture(false, "android");
    app.publishCompleteShiftSummary.mockRejectedValueOnce(new Error("connection lost after request"));

    await expect(app.mirror(50, "Closing note")).resolves.toMatchObject({ state: "CLOSED" });
    expect(app.publishCompleteShiftSummary).toHaveBeenCalledOnce();
    expect(app.toast.warning).not.toHaveBeenCalled();
    expect(app.recordDiagnostic).not.toHaveBeenCalled();
  });

  it("reports unconfirmed summary when reading browser credentials fails", async () => {
    const app = fixture(false);
    app.getPosCallerAuth.mockRejectedValueOnce(new Error("connection interrupted"));

    await expect(app.mirror(50, "Closing note")).resolves.toMatchObject({ state: "CLOSED" });
    expect(app.publishCompleteShiftSummary).not.toHaveBeenCalled();
    expect(app.toast.warning).toHaveBeenCalledOnce();
  });

  it("reports when the browser receives no summary confirmation", async () => {
    const app = fixture(false);
    app.publishCompleteShiftSummary.mockResolvedValueOnce(null);

    await expect(app.mirror(50, "Closing note")).resolves.toMatchObject({ state: "CLOSED" });
    expect(app.toast.warning).toHaveBeenCalledOnce();
  });

  it.each(["session", "branch", "branch generation", "actor"] as const)("omits a delayed summary warning after the %s changes", async scope => {
    const app = fixture(false);
    let rejectSummary!: (error: Error) => void;
    app.publishCompleteShiftSummary.mockReturnValueOnce(new Promise((_, reject) => { rejectSummary = reject; }));

    const closing = app.mirror(50, "Closing note");
    await vi.waitFor(() => expect(app.publishCompleteShiftSummary).toHaveBeenCalledOnce());
    app.changeScope[scope]();
    rejectSummary(new Error("connection interrupted"));

    await expect(closing).resolves.toMatchObject({ state: "CLOSED" });
    expect(app.toast.warning).not.toHaveBeenCalled();
    expect(app.recordDiagnostic).not.toHaveBeenCalled();
  });

  it("does not publish using credentials read after the browser session has changed", async () => {
    const app = fixture(false);
    let receiveCredentials!: (proof: { cashierToken: string }) => void;
    app.getPosCallerAuth.mockReturnValueOnce(new Promise(resolve => { receiveCredentials = resolve; }));

    const closing = app.mirror(50, "Closing note");
    await vi.waitFor(() => expect(app.getPosCallerAuth).toHaveBeenCalledOnce());
    app.changeScope.session();
    receiveCredentials({ cashierToken: "new-fixture-session" });

    await expect(closing).resolves.toMatchObject({ state: "CLOSED" });
    expect(app.publishCompleteShiftSummary).not.toHaveBeenCalled();
    expect(app.toast.warning).not.toHaveBeenCalled();
  });
});
