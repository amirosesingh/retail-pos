import { describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import { validateStoredAuthSession, type AuthSessionApi } from "../auth-session-guard";

const session = (expiresAt = Math.floor(Date.now() / 1000) + 3600) =>
  ({ access_token: "access", expires_at: expiresAt, user: { id: "user-1" } }) as Session;

function auth(overrides: Partial<AuthSessionApi> = {}): AuthSessionApi {
  return {
    getSession: vi.fn(async () => ({ data: { session: session() }, error: null })),
    refreshSession: vi.fn(async () => ({ data: { session: session() }, error: null })),
    getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
    ...overrides,
  };
}

describe("persisted Supabase session validation", () => {
  it("logout prevents an older encrypted credential save from restoring the token", async () => {
    const storage = new Map<string,string>();
    vi.stubGlobal("window",{localStorage:{getItem:(key:string)=>storage.get(key)??null,
      setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)}});
    const {setDeviceSecret,clearDeviceSecret} = await import("../device-secrets");
    let finish!: (value: ArrayBuffer) => void;
    const encryption = vi.spyOn(crypto.subtle,"encrypt").mockImplementationOnce(()=>new Promise<ArrayBuffer>(resolve=>{finish=resolve;}));
    try {
      const saving = setDeviceSecret("pos-session-token","old-token");
      await vi.waitFor(()=>expect(encryption).toHaveBeenCalledOnce());
      clearDeviceSecret("pos-session-token");
      finish(new ArrayBuffer(16));
      await saving;
      expect(storage.has("pos.secure.pos-session-token")).toBe(false);
    } finally { encryption.mockRestore();vi.unstubAllGlobals(); }
  });

  it("concurrent token hydration waits for one read and cannot overwrite a newer login", async () => {
    const storage = new Map<string,string>();
    const methods = {getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)};
    vi.stubGlobal("window",{localStorage:methods,sessionStorage:methods});
    const {setDeviceSecret} = await import("../device-secrets");
    const {loadSessionToken,saveSessionToken,clearStoredCredentials} = await import("../pos-credentials");
    await setDeviceSecret("pos-session-token","old-token");
    let finish!: (value: ArrayBuffer) => void;
    const decrypt = vi.spyOn(crypto.subtle,"decrypt").mockImplementationOnce(()=>new Promise<ArrayBuffer>(resolve=>{finish=resolve;}));
    try {
      const first = loadSessionToken();const second = loadSessionToken();
      await vi.waitFor(()=>expect(decrypt).toHaveBeenCalledOnce());
      await saveSessionToken("new-token");
      finish(new TextEncoder().encode(JSON.stringify("old-token")).buffer);
      expect(await first).toBe("new-token");expect(await second).toBe("new-token");
      clearStoredCredentials();
      expect(await loadSessionToken()).toBeNull();
      expect(storage.has("pos.secure.pos-session-token")).toBe(false);
      expect(storage.has("pos.secure.cashier-session")).toBe(false);
    } finally {decrypt.mockRestore();vi.unstubAllGlobals();}
  });
  it("rejects a token whose server-side session no longer exists", async () => {
    const api = auth({
      getUser: vi.fn(async () => ({
        data: { user: null },
        error: { status: 403, message: "Session not found" },
      })),
    });

    await expect(validateStoredAuthSession(api, { online: true })).resolves.toEqual({
      state: "rejected",
      session: null,
    });
  });

  it("keeps a session available during a connectivity failure", async () => {
    const saved = session();
    const api = auth({
      getSession: vi.fn(async () => ({ data: { session: saved }, error: null })),
      getUser: vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    });

    await expect(validateStoredAuthSession(api, { online: true })).resolves.toEqual({
      state: "unverified",
      session: saved,
    });
  });

  it("does not contact Auth while the device is offline", async () => {
    const saved = session();
    const api = auth({
      getSession: vi.fn(async () => ({ data: { session: saved }, error: null })),
    });

    await expect(validateStoredAuthSession(api, { online: false })).resolves.toEqual({
      state: "unverified",
      session: saved,
    });
    expect(api.refreshSession).not.toHaveBeenCalled();
    expect(api.getUser).not.toHaveBeenCalled();
  });

  it("refreshes a nearly expired token before the authoritative user check", async () => {
    const oldSession = session(100);
    const freshSession = session(10_000);
    const api = auth({
      getSession: vi.fn(async () => ({ data: { session: oldSession }, error: null })),
      refreshSession: vi.fn(async () => ({ data: { session: freshSession }, error: null })),
    });

    await expect(
      validateStoredAuthSession(api, { online: true, now: 100_000, refreshLeewayMs: 1_000 }),
    ).resolves.toEqual({ state: "verified", session: freshSession });
    expect(api.refreshSession).toHaveBeenCalledTimes(1);
    expect(api.getUser).toHaveBeenCalledTimes(1);
  });

  it("can validate through the app server without a browser /auth/v1/user request", async () => {
    const api = auth();
    const verifySession = vi.fn(async () => "rejected" as const);

    await expect(
      validateStoredAuthSession(api, { online: true, verifySession }),
    ).resolves.toEqual({ state: "rejected", session: null });
    expect(verifySession).toHaveBeenCalledWith(expect.objectContaining({ access_token: "access" }));
    expect(api.getUser).not.toHaveBeenCalled();
  });

  it("keeps the local session when server-side validation is unavailable", async () => {
    const saved = session();
    const api = auth({
      getSession: vi.fn(async () => ({ data: { session: saved }, error: null })),
    });

    await expect(
      validateStoredAuthSession(api, {
        online: true,
        verifySession: vi.fn(async () => "unavailable" as const),
      }),
    ).resolves.toEqual({ state: "unverified", session: saved });
    expect(api.getUser).not.toHaveBeenCalled();
  });
});
