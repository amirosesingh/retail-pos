import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/pos-session.server", () => ({
  verifyCashierSession: (token: string) =>
    token === "verified-person" ? { id: "person-id", username: "shop-admin" } : null,
}));

vi.mock("@/lib/session-guard.server", () => ({
  touchSession: (token: string) =>
    token === "current-session"
      ? Promise.resolve({
          ok: true,
          session: {
            kind: "cashier",
            label: "shop-admin",
            staff_user_id: "shop-admin",
            branch_id: null,
          },
        })
      : Promise.resolve({ ok: false, reason: "revoked" }),
}));

vi.mock("@/lib/external-supabase-config", () => ({
  runtimeEnvValue: () => "service-key",
  supabaseConfig: () => ({ url: "https://example.supabase.co", key: "publishable-key" }),
}));

import { verifyRelayCaller } from "@/core/api/pos-relay.server";

describe("relay caller identity", () => {
  it("keeps the verified PIN user when a terminal Auth token is also present", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const caller = await verifyRelayCaller({
        cashierToken: "verified-person",
        accessToken: "terminal-machine-account",
      });
      expect(caller).toMatchObject({ kind: "cashier", staffUserId: "shop-admin" });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("uses the activated terminal branch even when the signed-in user has another scope", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: "terminal-1",
            status: "active",
            location_id: "activated-branch",
            revoked_at: null,
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    try {
      const caller = await verifyRelayCaller({
        sessionToken: "current-session",
        terminalToken: "terminal-1",
      });
      expect(caller).toMatchObject({
        kind: "cashier",
        storeId: "activated-branch",
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("does not let an alternative proof revive a revoked device session", async () => {
    await expect(verifyRelayCaller({
      sessionToken: "older-revoked-session",
      cashierToken: "verified-person",
    })).rejects.toThrow("Your session has ended");
  });

  it("still rejects a stale session when no other POS proof verifies", async () => {
    await expect(
      verifyRelayCaller({
        sessionToken: "older-revoked-session",
        cashierToken: "invalid-person",
      }),
    ).rejects.toThrow("Your session has ended");
  });
});
