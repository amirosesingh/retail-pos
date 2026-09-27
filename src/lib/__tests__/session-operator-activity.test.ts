import { beforeEach, describe, expect, it, vi } from "vitest";

const { serviceRest } = vi.hoisted(() => ({ serviceRest: vi.fn() }));

vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest }));

import { touchSession } from "@/lib/session-guard.server";

const liveRow = {
  id: "session-1",
  staff_user_id: "cashier",
  user_id: null,
  kind: "cashier",
  label: "Cashier",
  branch_id: "store-a",
  terminal_id: "terminal-a",
  idle_timeout_minutes: 15,
  last_activity_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  is_revoked: false,
};

describe("server session activity boundary", () => {
  beforeEach(() => serviceRest.mockReset());

  it("validates background traffic without refreshing last_activity_at", async () => {
    serviceRest.mockResolvedValueOnce(new Response(JSON.stringify([liveRow]), { status: 200 }));

    expect((await touchSession("token")).ok).toBe(true);
    expect(serviceRest).toHaveBeenCalledTimes(1);
  });

  it("refreshes last_activity_at only for explicit operator activity", async () => {
    serviceRest
      .mockResolvedValueOnce(new Response(JSON.stringify([liveRow]), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    expect((await touchSession("token", { operatorActivity: true })).ok).toBe(true);
    expect(serviceRest).toHaveBeenCalledTimes(2);
    expect(serviceRest.mock.calls[1]?.[1]?.body).toContain("last_activity_at");
  });
});
