import { describe, expect, it, vi } from "vitest";
import { terminalVerdict } from "../use-revocation-check";

type Status = Awaited<ReturnType<typeof import("@/core/activation/terminal-tokens").fetchTokenStatus>>;

const row = (status: "active" | "used" | "revoked"): Status => ({
  status,
  locationName: "Main",
  locationId: "loc-1",
  isClaimed: true,
  expiresAt: null,
});

const online = () => true;
const deps = (lookup: (id: string) => Promise<Status>) => ({
  lookup: lookup as never,
  isOnline: online,
  confirmDelayMs: 0,
});

describe("terminalVerdict", () => {
  it("releases an offline cold start when a network lookup never settles", async () => {
    vi.useFakeTimers();
    try {
      const lookup = vi.fn(() => new Promise<Status>(() => {}));
      const result = terminalVerdict("t1", { ...deps(lookup), timeoutMs: 8000 });
      await vi.advanceTimersByTimeAsync(8000);
      expect(await result).toEqual({ outcome: "unknown" });
      expect(lookup).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it("accepts a live registration", async () => {
    const r = await terminalVerdict("t1", deps(async () => row("used")));
    expect(r.outcome).toBe("ok");
  });

  it("reports a revoked registration", async () => {
    const r = await terminalVerdict("t1", deps(async () => row("revoked")));
    expect(r.outcome).toBe("revoked");
  });

  it("expires the terminal when the record was deleted (confirmed twice)", async () => {
    const lookup = vi.fn(async () => null as Status);
    const r = await terminalVerdict("t1", deps(lookup));
    expect(r.outcome).toBe("missing");
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("does not lock when a single empty answer is followed by a real row", async () => {
    const lookup = vi.fn();
    lookup.mockResolvedValueOnce(null).mockResolvedValueOnce(row("used"));
    const r = await terminalVerdict("t1", deps(lookup as never));
    expect(r.outcome).toBe("ok");
  });

  it("ignores a lookup error", async () => {
    const r = await terminalVerdict(
      "t1",
      deps(async () => {
        throw new Error("network");
      }),
    );
    expect(r.outcome).toBe("unknown");
  });

  it("ignores an error on the confirmation attempt", async () => {
    const lookup = vi.fn();
    lookup.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("network"));
    const r = await terminalVerdict("t1", deps(lookup as never));
    expect(r.outcome).toBe("unknown");
  });

  it("gives no verdict while offline", async () => {
    const lookup = vi.fn(async () => null as Status);
    const r = await terminalVerdict("t1", {
      lookup: lookup as never,
      isOnline: () => false,
      confirmDelayMs: 0,
    });
    expect(r.outcome).toBe("unknown");
    expect(lookup).not.toHaveBeenCalled();
  });

  it("gives no verdict when the link drops between the two attempts", async () => {
    let up = true;
    const lookup = vi.fn(async () => {
      up = false;
      return null as Status;
    });
    const r = await terminalVerdict("t1", {
      lookup: lookup as never,
      isOnline: () => up,
      confirmDelayMs: 0,
    });
    expect(r.outcome).toBe("unknown");
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});
