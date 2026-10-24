import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rest: vi.fn(), send: vi.fn(), scope: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    validator: (parse: (value: unknown) => unknown) => ({
      handler: (handler: (input: { data: unknown }) => unknown) => (input: { data: unknown }) =>
        handler({ data: parse(input.data) }),
    }),
  }),
}));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: mocks.rest }));
vi.mock("../activity-events.server", () => ({
  sendWhatsApp: mocks.send,
  DEFAULT_NOTIFICATION_SETTINGS: { enabled: false, recipients: [], channels: {} },
}));
vi.mock("../privileged-caller.server", () => ({ requireCallerScope: mocks.scope }));
vi.mock("../activity-events", () => ({
  EVENT_CATALOG: [{ types: [{ type: "sale_complete", label: "Sale completed" }] }],
}));
import { drainNotificationWhatsApp } from "../notification-delivery.server";
import {
  loadNotificationRuleTable,
  saveNotificationRuleTable,
} from "../notification-rules.functions";
import { newNotificationRule, importNotificationRules } from "../notification-rules";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.scope.mockResolvedValue({ kind: "auth", staffUserId: "owner", role: "admin" });
});
describe("notification delivery and save boundaries", () => {
  it("imports each shift summary once and honours its own disabled preference", () => {
    const events = [{type:"shift_summary",label:"Day-end shift summary"}];
    expect(importNotificationRules({shiftAlerts:{inApp:false}}, events)).toEqual([]);
    const rules = importNotificationRules({}, events);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({event:"shift_summary",roles:["admin"],channels:["app"]});
  });
  it("sends only the durably claimed recipients and records provider acceptance", async () => {
    mocks.rest
      .mockResolvedValueOnce(
        Response.json([{ id: "claim-1", recipient: "6731234567", message: "Confirmed event" }]),
      )
      .mockResolvedValue(new Response(null, { status: 204 }));
    mocks.send.mockResolvedValue(null);
    await drainNotificationWhatsApp(3);
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith("6731234567", "Confirmed event");
    expect(mocks.rest.mock.calls[0]).toEqual([
      "rpc/claim_notification_whatsapp",
      { method: "POST", body: '{"p_limit":3}' },
    ]);
    expect(JSON.parse(mocks.rest.mock.calls[1][1].body)).toMatchObject({ status: "sent" });
  });
  it("does not retry an ambiguous send or claim an already claimed message", async () => {
    mocks.rest
      .mockResolvedValueOnce(
        Response.json([{ id: "claim-1", recipient: "6731234567", message: "Confirmed event" }]),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json([]));
    mocks.send.mockRejectedValue(new Error("timeout"));
    await drainNotificationWhatsApp();
    await drainNotificationWhatsApp();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mocks.rest.mock.calls[1][1].body).status).toBe("unknown");
  });
  it("does not send if the durable claim fails", async () => {
    mocks.rest.mockResolvedValue(new Response(null, { status: 503 }));
    await drainNotificationWhatsApp();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("rejects notification editing and history access without owner authority", async () => {
    mocks.scope.mockResolvedValue({
      kind: "cashier",
      staffUserId: "cashier",
      role: "cashier",
      permissions: { can_access_pos_settings: true },
    });
    expect(await loadNotificationRuleTable({ data: {} })).toMatchObject({ ok: false });
    expect(await saveNotificationRuleTable({ data: { rules: [], expected: null } })).toMatchObject({
      ok: false,
    });
    expect(mocks.rest).not.toHaveBeenCalled();
  });
  it("does not substitute default rules when reading saved settings fails", async () => {
    mocks.rest.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith("pos_settings") ? new Response(null, { status: 503 }) : Response.json([]),
      ),
    );
    expect(await loadNotificationRuleTable({ data: {} })).toMatchObject({ ok: false });
    expect(
      mocks.rest.mock.calls.some((call) => call[0] === "rpc/save_notification_rule_table"),
    ).toBe(false);
  });
  it("saves the full validated table using an expected revision and uses the returned result", async () => {
    const rule = { ...newNotificationRule(), name: "Owner rule" };
    mocks.rest.mockResolvedValue(Response.json([rule]));
    expect(
      await saveNotificationRuleTable({ data: { rules: [rule], expected: null } }),
    ).toMatchObject({ ok: true, rules: [rule] });
    expect(JSON.parse(mocks.rest.mock.calls[0][1].body)).toEqual({
      p_rules: [rule],
      p_expected: null,
    });
  });
  it("surfaces a concurrent-save conflict without overwriting", async () => {
    mocks.rest.mockResolvedValue(
      new Response("Notification rules changed on another device", { status: 409 }),
    );
    expect(await saveNotificationRuleTable({ data: { rules: [], expected: [] } })).toMatchObject({
      ok: false,
      error: expect.stringContaining("changed on another device"),
    });
    expect(mocks.rest).toHaveBeenCalledTimes(1);
  });
});
