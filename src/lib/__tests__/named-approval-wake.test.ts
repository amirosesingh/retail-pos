import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  project: "https://owned.test",
  gate: "https://owned.test" as string | undefined,
  token: "verified-staff" as string | undefined,
  staff: true,
  getSession: vi.fn(),
  channel: vi.fn(),
  removeChannel: vi.fn(async () => undefined),
  send: vi.fn(async () => new Response(null, { status: 204 })),
}));
vi.mock("@/integrations/supabase/external-client", () => ({
  externalClientSnapshot: () => ({
    auth: { getSession: fixture.getSession }, channel: fixture.channel, removeChannel: fixture.removeChannel,
  }),
  subscribeExternalClientReset: () => () => {},
}));
vi.mock("@/core/api/sync-relay", () => ({ hasStaffSession: () => fixture.staff }));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: fixture.send }));
vi.mock("../external-supabase-config", () => ({
  supabaseConfig: () => ({ url: fixture.project, key: "fixture" }),
  runtimeEnvValue: () => fixture.gate,
}));
vi.mock("../session-presence", () => ({
  centralAuthAccessToken: () => fixture.token,
  subscribeCentralAuthSession: () => () => {},
}));

import { subscribeNamedApprovalWake } from "../named-approval-wake";
import { namedApprovalWakeProject, wakeNamedApprovers } from "../named-approval-wake.server";
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
});
