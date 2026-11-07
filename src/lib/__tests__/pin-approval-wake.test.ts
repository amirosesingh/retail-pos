import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  const subscribe = vi.fn();
  const unsubscribe = vi.fn();
  const getSession = vi.fn();
  const getUser = vi.fn();
  const profile = vi.fn();
  const query = { select: vi.fn(), eq: vi.fn(), limit: vi.fn(), setHeader: profile };
  const from = vi.fn(() => query);
  const sharedSetAuth = vi.fn();
  return {
    subscribe, unsubscribe, getSession, getUser, profile, query, from, sharedSetAuth,
    client: { auth: { getSession, getUser, onAuthStateChange: subscribe }, from, realtime: { setAuth: sharedSetAuth } },
    sockets: [] as Array<{
      setAuth: ReturnType<typeof vi.fn>;
      channel: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
      subscribe: ReturnType<typeof vi.fn>;
      removeAllChannels: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    }>,
    construct: vi.fn(),
    readCredentials: vi.fn(),
    verify: vi.fn(),
    epoch: 1,
    signedIn: true,
    staff: false,
    platform: "android" as "android" | "ios" | "electron" | "web",
    pin: "person-pin-proof" as string | null,
    raw: "raw-person-proof" as string | null,
    terminal: { tokenId: "terminal-1", locationId: "branch-a", deviceUse: "operations" },
    project: { url: "https://pos.example", key: "publishable" },
    rebind: () => {},
    reset: () => {},
    central: () => {},
    credentials: () => {},
  };
});

vi.mock("@supabase/supabase-js", () => ({
  RealtimeClient: class {
    setAuth = vi.fn(async () => {});
    channel = vi.fn(() => this);
    on = vi.fn(() => this);
    subscribe = vi.fn(() => this);
    removeAllChannels = vi.fn(async () => []);
    disconnect = vi.fn(async () => {});
    constructor(...args: unknown[]) {
      fixture.construct(...args);
      fixture.sockets.push(this);
    }
  },
}));
vi.mock("@/core/activation/terminal-tokens", () => ({
  readTerminalConfig: () => fixture.terminal,
  subscribeTerminalConfig: (callback: () => void) => { fixture.rebind = callback; return () => {}; },
}));
vi.mock("@/core/activation/connection-health", () => ({ APP_RESUME_EVENT: "pos:app-resume" }));
vi.mock("@/core/api/sync-relay", () => ({ hasStaffSession: () => fixture.staff }));
vi.mock("@/platform-config/platform", () => ({ platformName: () => fixture.platform }));
vi.mock("@/integrations/supabase/external-client", () => ({
  externalClientSnapshot: () => fixture.client,
  subscribeExternalClientReset: (callback: () => void) => { fixture.reset = callback; return () => {}; },
}));
vi.mock("../external-supabase-config", () => ({ supabaseConfig: () => fixture.project }));
vi.mock("../pos-credentials", () => ({
  cashierTokenSync: () => fixture.pin,
  sessionTokenSync: () => fixture.raw,
  readCredentials: fixture.readCredentials,
  subscribeCredentialChanges: (callback: () => void) => { fixture.credentials = callback; return () => {}; },
}));
vi.mock("../session-epoch", () => ({ sessionEpoch: () => fixture.epoch }));
vi.mock("../session-presence", () => ({
  hasSignedInIdentity: () => fixture.signedIn,
  subscribeCentralAuthSession: (callback: () => void) => { fixture.central = callback; return () => {}; },
}));
vi.mock("../session-verify-client", () => ({ verifySession: fixture.verify }));

import { subscribeMobilePinActivityWake, subscribePinApprovalWake } from "../pin-approval-wake";

const email = "terminal.terminal-1@pos.local";
const user = { id: "machine-user", email };
const session = (bearer = "machine-jwt") => ({ access_token: bearer, user, expires_at: Date.now() / 1000 + 300 });
const profile = { auth_user_id: user.id, email, role: "staff", store_id: "branch-a", is_active: true };
const proofs = { cashierToken: "person-pin-proof", sessionToken: "raw-person-proof", terminalToken: "terminal-1", deviceBindingProof: "a".repeat(64) };
const stops: Array<() => void> = [];
const watch = (branch = "branch-a", wake = vi.fn(), subscribe = subscribePinApprovalWake) => {
  const stop = subscribe(branch, wake);
  stops.push(stop);
  return { stop, wake };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  fixture.sockets.length = 0;
  fixture.epoch = 1;
  fixture.signedIn = true;
  fixture.staff = false;
  fixture.platform = "android";
  fixture.pin = proofs.cashierToken;
  fixture.raw = proofs.sessionToken;
  fixture.terminal = { tokenId: proofs.terminalToken, locationId: "branch-a", deviceUse: "operations" };
  fixture.project = { url: "https://pos.example", key: "publishable" };
  fixture.getSession.mockReset().mockImplementation(async () => ({ data: { session: session() }, error: null }));
  fixture.getUser.mockReset().mockResolvedValue({ data: { user }, error: null });
  fixture.profile.mockReset().mockResolvedValue({ data: [profile], error: null });
  fixture.readCredentials.mockReset().mockResolvedValue({ ...proofs, accessToken: "ignore-other-bearer" });
  fixture.verify.mockReset().mockResolvedValue({ ok: true, kind: "cashier", storeId: "branch-a" });
  fixture.query.select.mockReturnValue(fixture.query);
  fixture.query.eq.mockReturnValue(fixture.query);
  fixture.query.limit.mockReturnValue(fixture.query);
  fixture.subscribe.mockImplementation((callback: (event: string, value: ReturnType<typeof session> | null) => void) => {
    callback("INITIAL_SESSION", session());
    return { data: { subscription: { unsubscribe: fixture.unsubscribe } } };
  });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", { onLine: true });
});

afterEach(async () => {
  for (const stop of stops.splice(0)) stop();
  await vi.advanceTimersByTimeAsync(1);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("enrolled PIN approval wake", () => {
  it("shares one private branch socket after verifying the exact machine and PIN session", async () => {
    const first = watch();
    const second = watch();
    const other = watch("branch-b");
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.construct).toHaveBeenCalledExactlyOnceWith("wss://pos.example/realtime/v1", { params: { apikey: "publishable" } });
    expect(fixture.getUser).toHaveBeenCalledExactlyOnceWith("machine-jwt");
    expect(fixture.query.eq).toHaveBeenCalledExactlyOnceWith("auth_user_id", user.id);
    expect(fixture.profile).toHaveBeenCalledExactlyOnceWith("Authorization", "Bearer machine-jwt");
    expect(fixture.verify).toHaveBeenCalledExactlyOnceWith({ data: proofs, signal: expect.any(AbortSignal) });
    expect(fixture.sharedSetAuth).not.toHaveBeenCalled();
    const socket = fixture.sockets[0];
    expect(socket.setAuth).toHaveBeenCalledExactlyOnceWith("machine-jwt");
    expect(socket.channel).toHaveBeenCalledExactlyOnceWith("pos-sync:default:branch:branch-a", { config: { private: true } });
    const notify = socket.on.mock.calls[0][2];
    const status = socket.subscribe.mock.calls[0][0];
    status("SUBSCRIBED");
    status("SUBSCRIBED");
    notify({ payload: { table: "sales" } });
    notify({ payload: { table: "authorization_requests" } });
    expect(first.wake).toHaveBeenCalledTimes(2);
    expect(second.wake).toHaveBeenCalledTimes(2);
    expect(other.wake).not.toHaveBeenCalled();
    first.stop();
    expect(socket.removeAllChannels).not.toHaveBeenCalled();
    second.stop();
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.removeAllChannels).toHaveBeenCalledOnce();
  });

  it.each(["android", "ios"] as const)("wakes the %s bell from the committed activity row on the same socket", async platform => {
    fixture.platform = platform;
    const approval = watch();
    const badge = watch("branch-a", vi.fn(), subscribeMobilePinActivityWake);
    const otherBadge = watch("branch-b", vi.fn(), subscribeMobilePinActivityWake);
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.construct).toHaveBeenCalledOnce();
    const socket = fixture.sockets[0];
    const notify = socket.on.mock.calls[0][2];
    const status = socket.subscribe.mock.calls[0][0];
    status("SUBSCRIBED");
    expect(badge.wake).toHaveBeenCalledOnce();
    notify({ payload: { table: "authorization_requests" } });
    expect(badge.wake).toHaveBeenCalledOnce();
    expect(approval.wake).toHaveBeenCalledTimes(2);
    notify({ payload: { table: "activity_events" } });
    expect(badge.wake).toHaveBeenCalledTimes(2);
    expect(approval.wake).toHaveBeenCalledTimes(2);
    expect(otherBadge.wake).not.toHaveBeenCalled();
    badge.stop();
    notify({ payload: { table: "activity_events" } });
    expect(badge.wake).toHaveBeenCalledTimes(2);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it.each(["electron", "web"] as const)("leaves the %s badge on its current delivery path", async platform => {
    fixture.platform = platform;
    const badge = watch("branch-a", vi.fn(), subscribeMobilePinActivityWake);
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.construct).not.toHaveBeenCalled();
    expect(badge.wake).not.toHaveBeenCalled();
  });

  it.each([
    ["no signed-in person", () => { fixture.signedIn = false; }],
    ["staff already owns its verified wake", () => { fixture.staff = true; }],
    ["Management enrollment", () => { fixture.terminal.deviceUse = "management"; }],
    ["another machine session", () => { fixture.getSession.mockResolvedValueOnce({ data: { session: { ...session(), user: { ...user, email: "terminal.other@pos.local" } } } }); }],
    ["unverified bearer identity", () => { fixture.getUser.mockResolvedValueOnce({ data: { user: { ...user, id: "replaced" } } }); }],
    ["disabled machine profile", () => { fixture.profile.mockResolvedValueOnce({ data: [{ ...profile, is_active: false }] }); }],
    ["another machine profile branch", () => { fixture.profile.mockResolvedValueOnce({ data: [{ ...profile, store_id: "branch-b" }] }); }],
    ["another terminal proof", () => { fixture.readCredentials.mockResolvedValueOnce({ ...proofs, terminalToken: "different" }); }],
    ["revoked PIN relay session", () => { fixture.verify.mockResolvedValueOnce({ ok: false, reason: "revoked" }); }],
    ["another verified relay branch", () => { fixture.verify.mockResolvedValueOnce({ ok: true, kind: "cashier", storeId: "branch-b" }); }],
  ])("leaves polling in place for %s", async (_case, alter) => {
    alter();
    const { wake } = watch();
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.construct).not.toHaveBeenCalled();
    expect(wake).not.toHaveBeenCalled();
  });

  it("ignores a pending proof after the terminal is rebound", async () => {
    let finish!: (value: unknown) => void;
    fixture.verify.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const { wake } = watch();
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.verify).toHaveBeenCalledOnce();
    fixture.terminal = { tokenId: "terminal-2", locationId: "branch-b", deviceUse: "operations" };
    fixture.rebind();
    finish({ ok: true, kind: "cashier", storeId: "branch-a" });
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.construct).not.toHaveBeenCalled();
    expect(wake).not.toHaveBeenCalled();
  });

  it("serializes bearer rotation and suppresses stale signals as soon as the person signs out", async () => {
    const { wake } = watch();
    await vi.advanceTimersByTimeAsync(1);
    const authChanged = fixture.subscribe.mock.calls[0][0];
    const first = fixture.sockets[0];
    fixture.getSession.mockResolvedValueOnce({ data: { session: session("new-machine-jwt") }, error: null });
    authChanged("TOKEN_REFRESHED", session("new-machine-jwt"));
    await vi.advanceTimersByTimeAsync(1);
    expect(first.removeAllChannels).toHaveBeenCalledOnce();
    expect(fixture.sockets).toHaveLength(2);
    const second = fixture.sockets[1];
    expect(second.setAuth).toHaveBeenCalledExactlyOnceWith("new-machine-jwt");
    const notify = second.on.mock.calls[0][2];
    fixture.epoch += 1;
    fixture.pin = null;
    fixture.raw = null;
    fixture.credentials();
    notify({ payload: { table: "authorization_requests" } });
    expect(wake).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(second.disconnect).toHaveBeenCalledOnce();
    expect(second.removeAllChannels).toHaveBeenCalledOnce();
  });

  it("disconnects when the verified machine JWT expires without a refresh", async () => {
    fixture.getSession.mockResolvedValueOnce({ data: { session: { ...session(), expires_at: Date.now() / 1000 + 1 } }, error: null });
    watch();
    await vi.advanceTimersByTimeAsync(1);
    const socket = fixture.sockets[0];
    expect(socket.removeAllChannels).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(socket.disconnect).toHaveBeenCalledOnce();
    expect(socket.removeAllChannels).toHaveBeenCalledOnce();
    expect(fixture.construct).toHaveBeenCalledOnce();
  });
});
