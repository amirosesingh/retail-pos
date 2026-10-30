import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  sessionReason: "idle" as "idle" | "revoked" | "unavailable" | "ok",
  relay: vi.fn(),
  rest: vi.fn(),
}));

vi.mock("@/core/api/pos-relay.server", () => ({
  hasServiceKey: () => true,
  serviceRest: mocks.rest,
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
    mocks.rest.mockReset();
    mocks.rest.mockResolvedValue(new Response(JSON.stringify([{ is_active: true, store_id: null }])));
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

  it.each([false, true])("checks current account status before restoring Auth (active=%s)", async (active) => {
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ id: "auth-user" })));
    mocks.rest.mockResolvedValueOnce(new Response(JSON.stringify([{ is_active: active, store_id: null }])));
    try {
      expect(await verifySessionServer({ accessToken: "valid-saved-token" })).toEqual(active
        ? { ok: true, kind: "staff", storeId: null } : { ok: false, reason: "revoked" });
      expect(mocks.rest).toHaveBeenCalledWith("app_users?auth_user_id=eq.auth-user&select=is_active,store_id&limit=1", expect.anything());
    } finally { request.mockRestore(); }
  });

  it.each(["cashier", "staff"])("rejects disabled %s person sessions even with a valid registered terminal", async (kind) => {
    mocks.sessionReason = "ok";
    mocks.relay.mockResolvedValue({ kind, staffUserId: "sports-warehouse", storeId: null });
    mocks.rest.mockResolvedValueOnce(new Response(JSON.stringify([{ is_active: false, store_id: null }])));
    expect(await verifySessionServer({ sessionToken: "valid-session", terminalToken: "registered" })).toEqual({ ok: false, reason: "revoked" });
  });

  it("does not misclassify account database downtime as deactivation", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ id: "auth-user" })));
    mocks.rest.mockRejectedValueOnce(new TypeError("offline"));
    try { expect(await verifySessionServer({ accessToken: "valid-saved-token" })).toEqual({ ok: false, reason: "unavailable" }); }
    finally { request.mockRestore(); }
  });

  it("keeps terminal-only registration separate from staff account status", async () => {
    mocks.relay.mockResolvedValue({ kind: "terminal", storeId: null });
    expect(await verifySessionServer({ terminalToken: "registered" })).toEqual({ ok: true, kind: "terminal", storeId: null });
    expect(mocks.rest).not.toHaveBeenCalled();
  });
  it("does not report a branch deleted or validate its existence when the branch read fails", async () => {
    mocks.relay.mockResolvedValue({ kind: "terminal", storeId: "branch-a" });
    mocks.rest.mockResolvedValueOnce(new Response(null, { status: 503 }));
    expect(await verifySessionServer({ terminalToken: "registered" })).toEqual({ ok: false, reason: "unavailable" });
  });
  it("still rejects an authoritatively missing branch", async () => {
    mocks.relay.mockResolvedValue({ kind: "terminal", storeId: "branch-a" });
    mocks.rest.mockResolvedValueOnce(Response.json([]));
    expect(await verifySessionServer({ terminalToken: "registered" })).toMatchObject({ ok: false, reason: "branch_missing", storeId: "branch-a" });
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
  it("bounds a stalled Auth check without declaring the saved token revoked", async () => {
    vi.useFakeTimers();
    const request = vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })));
    try {
      const result = verifySessionServer({ accessToken: "saved-token" });
      await vi.advanceTimersByTimeAsync(8_000);
      expect(await result).toEqual({ ok: false, reason: "unavailable" });
      expect(mocks.rest).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally { request.mockRestore(); vi.useRealTimers(); }
  });
  it.each([null, {}, { id: 123 }])("keeps malformed Auth identity %j unavailable", async payload => {
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(payload));
    try {
      expect(await verifySessionServer({ accessToken: "saved-token" })).toEqual({ ok: false, reason: "unavailable" });
      expect(mocks.rest).not.toHaveBeenCalled();
    } finally { request.mockRestore(); }
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
    expect(auth).toContain('centralSessionVerifiedRef.current = Boolean(next && checked.state === "verified")');
    const client = readFileSync("src/integrations/supabase/external-client.ts", "utf8");
    expect(client).toContain('new URL(requestUrl).pathname.endsWith("/auth/v1/logout")');
    expect(client).toContain('await client.auth.signOut({ scope: "local" })');
  });

  it("validates restored browser sessions behind the app server boundary", () => {
    const auth = readFileSync("src/lib/pos-auth.tsx", "utf8");
    expect(auth).toContain('import("@/lib/session-verify-client")');
    expect(auth).toContain("data: { accessToken: current.access_token }");
    expect(auth).toContain("validateCentralAuthSession(");
    expect(auth).toContain('resumedAuthProof(authCheck, centralSessionVerifiedRef.current, operatorAuthId.current)');
    expect(auth).toContain('if (resumedProof)');
  });
});
