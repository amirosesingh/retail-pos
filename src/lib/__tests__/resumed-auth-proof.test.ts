import type { Session } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { resumedAuthProof } from "../resumed-auth-proof";
import { validateStoredAuthSession } from "../auth-session-guard";

const operator = { access_token: "verified-bearer", user: { id: "operator", email: "staff@example.test" } } as Session;

describe("operator proof after an Auth resume check", () => {
  it("leaves an existing proof and bearer untouched when session restore fails", async () => {
    const result = await validateStoredAuthSession({
      getSession: async () => ({ data: { session: null }, error: { status: 503, message: "Database timeout" } }),
      getUser: vi.fn(), refreshSession: vi.fn(),
    }, { online: true });
    expect(result).toEqual({ state: "unavailable", session: null });
    const publish = vi.fn();
    const update = resumedAuthProof(result, true, "operator");
    if (update) publish(update.verified, update.accessToken);
    expect(publish).not.toHaveBeenCalled();
  });

  it("cannot grant a previously unverified account during an outage", () => {
    expect(resumedAuthProof({ state: "unavailable", session: null }, false, "operator")).toBeNull();
    expect(resumedAuthProof({ state: "unverified", session: operator }, false, "operator"))
      .toEqual({ verified: false, accessToken: undefined });
  });

  it("releases a stalled browser/phone check without publishing a new proof or deleting the old bearer", async () => {
    vi.useFakeTimers();
    try {
      const checking = validateStoredAuthSession({
        getSession: async () => new Promise(() => {}),
        getUser: vi.fn(), refreshSession: vi.fn(),
      }, { online: true, timeoutMs: 20_000 });
      await vi.advanceTimersByTimeAsync(20_000);
      const result = await checking;
      expect(result).toEqual({ state: "unavailable", session: null });
      expect(resumedAuthProof(result, true, "operator")).toBeNull();
      expect(resumedAuthProof(result, false, "operator")).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it.each(["signed-out", "rejected"] as const)("clears proof for a definite %s result", state => {
    expect(resumedAuthProof({ state, session: null }, true, "operator"))
      .toEqual({ verified: false, accessToken: undefined });
  });

  it("rejects a different operator or machine identity even after successful verification", () => {
    expect(resumedAuthProof({ state: "verified", session: operator }, true, "someone-else")?.verified).toBe(false);
    const machine = { ...operator, user: { id: "operator", email: "terminal@pos.local" } } as Session;
    expect(resumedAuthProof({ state: "verified", session: machine }, true, "operator")?.verified).toBe(false);
  });

  it("accepts only the matching verified operator and retains prior proof during a network-only failure", () => {
    expect(resumedAuthProof({ state: "verified", session: operator }, false, "operator"))
      .toEqual({ verified: true, accessToken: "verified-bearer" });
    expect(resumedAuthProof({ state: "unverified", session: operator }, true, "operator"))
      .toEqual({ verified: true, accessToken: "verified-bearer" });
  });
});
