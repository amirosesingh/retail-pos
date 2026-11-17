import { describe, expect, it, vi } from "vitest";
import { resolveLocalWriteRoute } from "@/core/local-db/write-route";
import type { PosBridge } from "@/core/local-db/local-db";

const bridge = (state: unknown) => ({ database: { getState: vi.fn().mockResolvedValue(state) } }) as unknown as PosBridge;

describe("configured local write route", () => {
  it("allows the existing cloud route without a local bridge or with positively disabled SQL", async () => {
    await expect(resolveLocalWriteRoute(null)).resolves.toBe("cloud");
    await expect(resolveLocalWriteRoute(bridge({ enabled: false, connected: false }))).resolves.toBe("cloud");
  });
  it.each([
    { enabled: true, connected: true, tradingReady: true, configured: true },
    { enabled: true, connected: true }, // Existing native bridge compatibility.
  ])("keeps a ready SQL device local", async state => {
    await expect(resolveLocalWriteRoute(bridge(state))).resolves.toBe("local");
  });
  it.each([null, undefined, {}, [], { enabled: true }, { enabled: "false", connected: false },
    { enabled: true, connected: true, tradingReady: "true" },
    { enabled: true, connected: true, localRecoveryPending: "false" }])("refuses unreadable/malformed state %j", async state => {
    await expect(resolveLocalWriteRoute(bridge(state))).rejects.toMatchObject({ code: "ELOCAL_STATE_UNVERIFIED" });
  });
  it("refuses missing or rejected native status without copying unsafe error details", async () => {
    await expect(resolveLocalWriteRoute({} as PosBridge)).rejects.toMatchObject({ code: "ELOCAL_STATE_UNVERIFIED" });
    const device = bridge(null);
    device.database!.getState = vi.fn().mockRejectedValue(new Error("private connection details"));
    await expect(resolveLocalWriteRoute(device)).rejects.toThrow("saved local SQL Server state could not be verified");
  });
  it.each([
    { enabled: true, connected: false },
    { enabled: true, connected: true, tradingReady: false },
    { enabled: true, connected: true, configured: false },
    { enabled: true, connected: true, localRecoveryPending: true },
    { enabled: false, connected: true },
    { enabled: false, connected: false, localRecoveryPending: true },
    { enabled: false, connected: false, tradingReady: true },
  ])("does not bypass unavailable or contradictory SQL state %j", async state => {
    await expect(resolveLocalWriteRoute(bridge(state))).rejects.toMatchObject({ code: "ELOCAL_NOT_READY" });
  });
});
