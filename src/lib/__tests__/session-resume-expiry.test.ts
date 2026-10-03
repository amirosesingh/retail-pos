import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  sessionReason: "idle" as "idle" | "revoked" | "unavailable" | "ok",
  relay: vi.fn(),
}));

vi.mock("@/core/api/pos-relay.server", () => ({
  hasServiceKey: () => true,
  serviceRest: vi.fn(),
  verifyRelayCaller: mocks.relay,
}));

vi.mock("@/lib/session-guard.server", () => ({
  touchSession: vi.fn(async () =>
    mocks.sessionReason === "ok"
      ? { ok: true, session: { kind: "staff", label: "Sam", branch_id: null } }
      : { ok: false, reason: mocks.sessionReason },
  ),
}));

vi.mock("@/lib/external-supabase-config", () => ({
  supabaseConfig: () => ({
    url: "https://project-ref.supabase.co",
    key: "sb_publishable_test",
  }),
}));

import { verifySessionServer } from "@/lib/session-verify.server";

describe("session verification after resume", () => {
  beforeEach(() => {
    mocks.sessionReason = "idle";
    mocks.relay.mockReset();
    mocks.relay.mockResolvedValue({ kind: "staff", label: "Sam", storeId: null });
  });

  it("does not let a refreshed Auth token hide an idle-expired POS session", async () => {
    await expect(
      verifySessionServer({
        sessionToken: "expired-person-session",
        accessToken: "still-refreshable-supabase-session",
        terminalToken: "registered-terminal",
      }),
    ).resolves.toEqual({ ok: false, reason: "revoked" });
    expect(mocks.relay).not.toHaveBeenCalled();
  });

  it("keeps connectivity failures non-destructive", async () => {
    mocks.sessionReason = "unavailable";
    await expect(
      verifySessionServer({ sessionToken: "person-session", accessToken: "auth-token" }),
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
    expect(mocks.relay).not.toHaveBeenCalled();
  });

  it("maps a server-side GoTrue refusal to a clean revoked result", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response('{"code":"session_not_found"}', { status: 403 }),
    );

    await expect(verifySessionServer({ accessToken: "revoked-token" })).resolves.toEqual({
      ok: false,
      reason: "revoked",
    });
    expect(request).toHaveBeenCalledWith(
      "https://project-ref.supabase.co/auth/v1/user",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer revoked-token" }),
      }),
    );
    expect(mocks.relay).not.toHaveBeenCalled();
    request.mockRestore();
  });

  it("does not sign out when server-side Auth validation is unavailable", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("offline"));

    await expect(verifySessionServer({ accessToken: "saved-token" })).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(mocks.relay).not.toHaveBeenCalled();
    request.mockRestore();
  });
});

describe("logout scope", () => {
  it("ends only this device session instead of every Supabase login", () => {
    const auth = readFileSync("src/lib/pos-auth.tsx", "utf8");
    const activation = readFileSync("src/core/activation/terminal-tokens.ts", "utf8");
    expect(auth).not.toContain(".auth.signOut();");
    expect(activation).not.toContain(".auth.signOut();");
    expect(auth).toContain('.auth.signOut({ scope: "local" })');
    expect(activation).toContain('.auth.signOut({ scope: "local" })');
    expect(auth).toContain('reason === "expired"');
    expect(auth).toContain("await discardRejectedExternalAuthSession()");
    expect(auth).toContain('centralSessionVerifiedRef.current = checked.state === "verified"');
    const client = readFileSync("src/integrations/supabase/external-client.ts", "utf8");
    expect(client).toContain('new URL(requestUrl).pathname.endsWith("/auth/v1/logout")');
    expect(client).toContain('await client.auth.signOut({ scope: "local" })');
  });

  it("validates restored browser sessions behind the app server boundary", () => {
    const auth = readFileSync("src/lib/pos-auth.tsx", "utf8");
    expect(auth).toContain('import("@/lib/session-verify.functions")');
    expect(auth).toContain("data: { accessToken: current.access_token }");
    expect(auth).toContain("validateCentralAuthSession(");
  });
});
