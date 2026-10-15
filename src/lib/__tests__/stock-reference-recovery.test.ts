import { beforeEach, describe, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({reserveStockCounter:vi.fn()}));
vi.mock("@/core/local-db/local-db", () => ({ localDb: () => bridge, readLocalSetting:vi.fn(async () => null), writeLocalSetting:vi.fn(async () => true) }));
vi.mock("../document-origin", () => ({documentOrigin: () => "B1-WIN-DEVICE"}));
import {nextStockRef, saveStockDraftReference} from "../stock-ref";
beforeEach(() => vi.clearAllMocks());
const duplicate = {sqlNumber:2601,table:"stock_count_drafts",sqlDetail:"Cannot insert duplicate key row with unique index 'UX_stock_count_drafts_reference'."};
describe("stock reference reservation and recovery", () => {
  it("uses durable Main reservations for counts, receiving notes, requests and transfers", async () => {
    bridge.reserveStockCounter.mockImplementation(async () => ({ok:true,sequence:82}));
    const at = new Date(2026,9,15);
    for (const [series,prefix] of [["stock","SC"],["receiving","GRN"],["request","SR"],["transfer","ST"]] as const) {
      expect(await nextStockRef({},"B1",series,at)).toBe(`${prefix}-B1-WIN-DEVICE-202610-0082`);
      expect(bridge.reserveStockCounter).toHaveBeenLastCalledWith(`${prefix}-B1-WIN-DEVICE-202610`,expect.any(Number));
    }
    bridge.reserveStockCounter.mockResolvedValue({ok:false,error:"Counter disk failure"});
    await expect(nextStockRef({},"B1","stock",at)).rejects.toThrow("Counter disk failure");
  });
  it("resaves only a new draft with a fresh reference and the same write callback", async () => {
    const save = vi.fn().mockRejectedValueOnce(duplicate).mockResolvedValueOnce("local");
    const reserve = vi.fn(async () => "SC-new");
    await expect(saveStockDraftReference("SC-old",save,reserve,true)).resolves.toBe("SC-new");
    expect(save.mock.calls).toEqual([["SC-old"],["SC-new"]]);
    expect(reserve).toHaveBeenCalledOnce();
  });
  it("never renumbers existing drafts, swallows other conflicts, or retries indefinitely", async () => {
    const reserve = vi.fn(async () => "new");
    for (const error of [duplicate,{...duplicate,table:"products"},{...duplicate,sqlDetail:"unique index 'another_index'"},{...duplicate,sqlNumber:1205}]) {
      const save = vi.fn().mockRejectedValue(error);
      await expect(saveStockDraftReference("old",save,reserve,false)).rejects.toEqual(error);
      if(error!==duplicate) await expect(saveStockDraftReference("old",save,reserve,true)).rejects.toEqual(error);
    }
    expect(reserve).not.toHaveBeenCalled();
    const save = vi.fn().mockRejectedValue(duplicate);
    await expect(saveStockDraftReference("old",save,reserve,true)).rejects.toEqual(duplicate);
    expect(save).toHaveBeenCalledTimes(2);
  });
});
