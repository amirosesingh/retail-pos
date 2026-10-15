import { describe, expect, it, vi } from "vitest";
import { closedShiftEffects } from "../closed-shift-effects";

describe("committed shift closure", () => {
  it("prints before sync and preserves the print result when sync fails", async () => {
    const order: string[] = [];
    const result = await closedShiftEffects({
      print: async () => { order.push("print"); return { ok: true }; },
      synchronize: async () => { order.push("sync"); return { ok: false, error: "Network interrupted" }; },
    });
    expect(order).toEqual(["print", "sync"]);
    expect(result).toEqual({ printed: { ok: true }, synchronized: { ok: false, error: "Network interrupted" } });
  });
  it("still syncs after a printer exception, so reprinting never recounts cash", async () => {
    const synchronize = vi.fn(async () => ({ ok: true as const }));
    const result = await closedShiftEffects({ print: async () => { throw new Error("Printer offline"); }, synchronize });
    expect(synchronize).toHaveBeenCalledOnce();
    expect(result.printed).toEqual({ ok: false, error: "Printer offline" });
    expect(result.synchronized.ok).toBe(true);
  });
  it("handles a rejected sync after printing", async () => {
    const print = vi.fn(async () => ({ ok: true }));
    const result = await closedShiftEffects({ print, synchronize: async () => { throw new Error("Sync failed"); } });
    expect(print).toHaveBeenCalledOnce();
    expect(result.synchronized).toEqual({ ok: false, error: "Sync failed" });
  });
});
