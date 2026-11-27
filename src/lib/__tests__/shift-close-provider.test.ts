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

function fixture(native: boolean) {
  const activeShift: Shift = {
    id: "fixture-shift", storeId: "fixture-branch", terminalId: "fixture-terminal",
    cashier: "Cashier", openingFloat: 20, openedAt: "2026-11-27T01:00:00.000Z",
    closedAt: null, countedCash: null, note: "", status: "OPEN", state: "CASH_COUNT_REQUIRED",
  };
  let state = { shifts: [activeShift] };
  const rawUpsert = vi.fn().mockRejectedValue(new Error("SHIFT_OPEN_INVALID"));
  const recordActivity = vi.fn().mockResolvedValue(undefined);
  const trackTransition = vi.fn().mockResolvedValue(undefined);
  const publishCompleteShiftSummary = vi.fn().mockResolvedValue({ ok: true });
  const endShiftSessions = vi.fn();
  const setDbShift = vi.fn();
  const context = {
    useCallback: (work: unknown) => work,
    activeShift, isAdmin: false, can: () => false, user: { name: "Cashier", staffId: "staff-a", role: "staff" },
    terminalUser: null, readTerminalConfig: () => ({ tokenId: activeShift.terminalId }), sameRecordId,
    localTerminalId: () => activeShift.terminalId, localDb: () => native ? {} : null,
    db: { commitShift: rawUpsert }, isShiftOverdue: () => false, defaultTradingHours: {},
    justOpenedRef: { current: null }, shiftReadSequence: { current: 0 }, shiftMutationSequence: { current: 0 },
    setState: (update: (current: typeof state) => typeof state) => { state = update(state); },
    setDbShift, setShiftChecked: vi.fn(), endShiftSessions, trackTransition, recordActivity, logger: { log: vi.fn() },
    notifyError: vi.fn(), require: (name: string) => {
      if (name === "./shift-summary-client") return { publishCompleteShiftSummary };
      if (name === "./pos-caller-auth") return { getPosCallerAuth: async () => ({ cashierToken: "fixture" }) };
      throw new Error(`Unexpected fixture import ${name}`);
    },
  };
  const mirror = runInNewContext(`${callback}\ncloseShift;`, context) as
    (countedCash: number, note: string, extras?: Partial<Shift>) => Promise<Shift | null>;
  return { mirror, rawUpsert, recordActivity, trackTransition, publishCompleteShiftSummary, endShiftSessions, setDbShift, state: () => state };
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
  });
});
