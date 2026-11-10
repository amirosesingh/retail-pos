import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  project: "https://owned.test",
  gate: "https://owned.test" as string | undefined,
  token: "verified-staff" as string | undefined,
  staff: true,
  getSession: vi.fn(),
  channel: vi.fn(),
  removeChannel: vi.fn(async () => undefined),
  send: vi.fn(async (_path: string, _init?: RequestInit) => new Response(null, { status: 204 })),
  verify: vi.fn(),
  scope: vi.fn(),
  rules: vi.fn(),
  posFetch: vi.fn(),
  sessionListeners: new Set<() => void>(),
}));
vi.mock("@/integrations/supabase/external-client", () => ({
  externalClientSnapshot: () => ({
    auth: { getSession: fixture.getSession }, channel: fixture.channel, removeChannel: fixture.removeChannel,
  }),
  subscribeExternalClientReset: () => () => {},
}));
vi.mock("@/core/api/sync-relay", () => ({ hasStaffSession: () => fixture.staff }));
vi.mock("@/core/api/pos-relay.server", () => ({
  serviceRest: fixture.send, verifyRelayCaller: fixture.verify, RelayAuthenticationError: Error,
}));
vi.mock("@/core/api/relay-policy.server", () => ({ resolveRelayScope: fixture.scope }));
vi.mock("../authorization.server", () => ({ loadRuleRows: fixture.rules }));
vi.mock("../external-supabase-config", () => ({
  supabaseConfig: () => ({ url: fixture.project, key: "fixture" }),
  runtimeEnvValue: () => fixture.gate,
}));
vi.mock("../session-presence", () => ({
  centralAuthAccessToken: () => fixture.token,
  subscribeCentralAuthSession: (listener: () => void) => {
    fixture.sessionListeners.add(listener);
    return () => fixture.sessionListeners.delete(listener);
  },
}));
vi.mock("../server-origin", () => ({ posFetch: fixture.posFetch }));
vi.mock("../pos-credentials", () => ({ readCredentials: async () => ({}) }));

import { subscribeNamedApprovalWake } from "../named-approval-wake";
import { subscribeNamedApprovalBadge } from "../named-approval-badge";
import { namedApprovalWakeProject, readNamedApprovalBadge, wakeNamedApprovers } from "../named-approval-wake.server";
import { normalizeRule } from "../authorization";
import type { AuthorizationRequest } from "../authorization";

const id = "00000000-0000-4000-8000-000000000001";
const savedRequest = {
  id, approvalRoute: { ruleScopeType: "global", primaryUserIds: ["named"] },
} as AuthorizationRequest;
const cleanup: Array<() => void> = [];

beforeEach(() => {
  vi.stubGlobal("window", {});
  vi.clearAllMocks();
  fixture.gate = fixture.project;
  fixture.staff = true;
  fixture.token = "verified-staff";
  fixture.send.mockReset().mockImplementation(async () => new Response(null, { status: 204 }));
});
afterEach(() => {
  for (const stop of cleanup.splice(0)) stop();
  vi.unstubAllGlobals();
});

describe("named approval hints", () => {
  it("only sends the saved request identity through the enabled project", async () => {
    fixture.gate = undefined;
    await wakeNamedApprovers(savedRequest);
    fixture.gate = "https://another.test";
    await wakeNamedApprovers(savedRequest);
    expect(fixture.send).not.toHaveBeenCalled();
    fixture.gate = fixture.project;
    expect(namedApprovalWakeProject()).toBe(fixture.project);
    await wakeNamedApprovers(savedRequest);
    expect(fixture.send).toHaveBeenCalledExactlyOnceWith("rpc/pos_send_named_approval_wake_v1", {
      method: "POST", signal: expect.any(AbortSignal), body: JSON.stringify({ p_request_id: id }),
    });
  });

  it("joins only the verified person's private topic and ignores a stale session callback", async () => {
    fixture.getSession.mockResolvedValue({ data: { session: {
      access_token: fixture.token, user: { id, email: "staff@example.test" },
    } } });
    const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() };
    fixture.channel.mockReturnValue(channel);
    const wake = vi.fn(), live = vi.fn();
    cleanup.push(subscribeNamedApprovalWake(fixture.project, wake, live));
    await vi.waitFor(() => expect(channel.subscribe).toHaveBeenCalledOnce());
    expect(fixture.channel).toHaveBeenCalledExactlyOnceWith(`pos-approval-wake:v1:${id}`, { config: { private: true } });
    channel.subscribe.mock.calls[0][0]("SUBSCRIBED");
    channel.on.mock.calls[0][2]();
    expect(wake).toHaveBeenCalledTimes(2);
    fixture.token = "changed-session";
    channel.on.mock.calls[0][2]();
    expect(wake).toHaveBeenCalledTimes(2);
    cleanup.pop()?.();
    await vi.waitFor(() => expect(fixture.removeChannel).toHaveBeenCalledExactlyOnceWith(channel));
  });

  it("delivers one private topic to both the badge and open page until the last listener leaves", async () => {
    fixture.getSession.mockResolvedValue({ data: { session: {
      access_token: fixture.token, user: { id, email: "staff@example.test" },
    } } });
    const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() };
    fixture.channel.mockReturnValue(channel);
    const badge = vi.fn(), page = vi.fn();
    const offBadge = subscribeNamedApprovalWake(fixture.project, badge, vi.fn());
    cleanup.push(offBadge, subscribeNamedApprovalWake(fixture.project, page, vi.fn()));
    await vi.waitFor(() => expect(channel.subscribe).toHaveBeenCalledOnce());
    channel.on.mock.calls[0][2]();
    expect(badge).toHaveBeenCalledOnce();
    expect(page).toHaveBeenCalledOnce();
    offBadge();
    channel.on.mock.calls[0][2]();
    expect(badge).toHaveBeenCalledOnce();
    expect(page).toHaveBeenCalledTimes(2);
    expect(fixture.removeChannel).not.toHaveBeenCalled();
  });

  it("returns only exact pending cross-store assignments backed by current person, rule and permissions", async () => {
    const query = { action: "named_approval_badge", projectUrl: fixture.project, accessToken: "verified-staff" };
    fixture.verify.mockResolvedValue({ kind: "staff", authUserId: id, email: "staff@example.test" });
    const scope = { staffUserId: "Named", storeId: "B", role: "staff", permissions: { can_process_refund: true } };
    fixture.scope.mockResolvedValue(scope);
    const rule = normalizeRule({
      action_key: "refund", scope_type: "global", mode: "request", is_enabled: true, allowed_user_ids: ["Named"],
    });
    fixture.rules.mockResolvedValue([rule]);
    const row = {
      id, action_key: "refund", requested_by: "requester", store_id: "A", status: "pending",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      approval_route: { ruleScopeType: "global", primaryUserIds: ["named"], primaryApprovers: [{ id: "Named" }] },
    };
    fixture.send.mockImplementation(async () => Response.json([row,
      { ...row, id: "another-branch-item", approval_route: { ...row.approval_route, primaryApprovers: [{ id: "Someone else" }] } },
      { ...row, id: "same-store-item", store_id: "B" },
      { ...row, id: "resolved-item", status: "approved" },
    ]));
    const signal = new AbortController().signal;
    expect(await readNamedApprovalBadge(query, signal)).toEqual({
      status: 200, body: { ok: true, project: fixture.project, approvalIds: [id] },
    });
    expect(new URL(fixture.send.mock.calls[0]?.[0] ?? "", fixture.project).searchParams.get("approval_route"))
      .toBe('cs.{"ruleScopeType":"global","primaryUserIds":["named"]}');
    fixture.rules.mockResolvedValue([{ ...rule, allowedUserIds: ["Named", "!Named"] }]);
    expect((await readNamedApprovalBadge(query, signal)).body).toMatchObject({ approvalIds: [] });
    fixture.rules.mockResolvedValue([rule]);
    fixture.scope.mockResolvedValue({ ...scope, permissions: {} });
    expect((await readNamedApprovalBadge(query, signal)).body).toMatchObject({ approvalIds: [] });
    fixture.scope.mockResolvedValue({ ...scope, branchRestricted: true });
    expect((await readNamedApprovalBadge(query, signal)).body).toMatchObject({ approvalIds: [] });
    expect(await readNamedApprovalBadge({ ...query, storeId: "A" }, signal)).toMatchObject({ status: 400 });
  });

  it("checks a disabled badge only once per current session and never opens a socket", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", Object.assign(new EventTarget(), { setInterval, clearInterval }));
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    vi.stubGlobal("navigator", { onLine: true });
    fixture.posFetch.mockImplementation(async () => Response.json({ ok: true, enabled: false, approvalIds: [] }));
    const setIds = vi.fn();
    const stop = subscribeNamedApprovalBadge(setIds);
    try {
      await vi.advanceTimersByTimeAsync(1);
      expect(fixture.posFetch).toHaveBeenCalledOnce();
      expect(setIds).toHaveBeenCalledWith([]);
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(120_000);
      expect(fixture.posFetch).toHaveBeenCalledOnce();
      expect(fixture.channel).not.toHaveBeenCalled();
      fixture.token = "another-verified-staff";
      fixture.sessionListeners.forEach(listener => listener());
      await vi.advanceTimersByTimeAsync(1);
      expect(fixture.posFetch).toHaveBeenCalledTimes(2);
    } finally {
      stop();
      vi.useRealTimers();
    }
  });
});
