import { beforeEach, describe, expect, it, vi } from "vitest";
import { SHIFT_CLOSURE_UNCONFIRMED_NOTICE } from "../../../electron/shift-closure-activity.mjs";

const { rest, write, scope } = vi.hoisted(() => ({
  rest: vi.fn(), write: vi.fn(),
  scope: { current: { kind: "cashier", staffUserId: "cashier-a", role: "staff", roleSlug: "cashier", actorName: "Cashier", terminalId: "terminal-a", storeId: "branch-a", isSupervisor: false, branchRestricted: true, stale: false } },
}));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => ({ validator: (parse: (input: unknown) => unknown) => ({ handler: (fn: (input: { data: unknown }) => unknown) => (input: { data: unknown }) => fn({ data: parse(input.data) }) }) }) }));
vi.mock("@/core/api/pos-relay.server", () => ({ verifyRelayCaller: async () => ({}), serviceRest: rest }));
vi.mock("@/core/api/relay-policy.server", () => ({ resolveRelayScope: async () => scope.current, canCrossBranches: (value: typeof scope.current) => value.isSupervisor && !value.branchRestricted }));
vi.mock("../activity-events.server", () => ({ writeActivityEvent: write }));

import { pushActivityEvent } from "../activity-events.functions";

const id = "10000000-0000-4000-8000-000000000001";
const closedAt = "2026-10-30T12:00:00Z";
const event = { type: "shift_close", title: "Shift closed", message: "Counted 50", storeId: "branch-a", entityType: "shift", entityId: id, amount: 50, cashierToken: "valid", meta: { note: "keep", shift_closure_status: "central_confirmed", notification_routes: { app: ["forged"] }, audience_user_ids: ["forged"] } };
const closed = { id, store_id: "branch-a", status: "CLOSED", state: "CLOSED", closed_at: closedAt };

beforeEach(() => {
  vi.clearAllMocks();
  scope.current = { kind: "cashier", staffUserId: "cashier-a", role: "staff", roleSlug: "cashier", actorName: "Cashier", terminalId: "terminal-a", storeId: "branch-a", isSupervisor: false, branchRestricted: true, stale: false };
  write.mockResolvedValue({ ok: true });
  rest.mockResolvedValue(new Response(JSON.stringify([closed])));
});

describe("authoritative central shift closure notification status", () => {
  it("confirms only the same persisted shift and branch and preserves attribution and delivery identity", async () => {
    expect(await pushActivityEvent({ data: { ...event, clientEventId: "same-report" } })).toEqual({ ok: true });
    expect(rest).toHaveBeenCalledWith(`shifts?id=eq.${id}&store_id=eq.branch-a&select=id,store_id,status,state,closed_at&limit=1`, { signal: expect.any(AbortSignal) });
    expect(write).toHaveBeenCalledWith(expect.objectContaining({
      event_type: "shift_close", title: "Shift closure confirmed", message: "Counted 50\nCentral record confirmed closed.",
      actor_id: "cashier-a", store_id: "branch-a", entity_id: id, amount: 50, client_event_id: "same-report",
      meta: { note: "keep", client_reported: true, shift_closure_status: "central_confirmed", shift_closure_closed_at: closedAt },
    }));
  });

  it.each([
    [], [{ ...closed, status: "OPEN", state: "ACTIVE", closed_at: null }],
    [{ ...closed, state: "PENDING_APPROVAL" }], [{ ...closed, id: "different-shift" }],
    [{ ...closed, store_id: "branch-b" }], [{ ...closed, closed_at: "invalid" }],
    { status: "CLOSED" }, [closed, closed],
  ])("retains an explicitly unconfirmed report for an absent, conflicting or malformed central row: %j", async rows => {
    rest.mockResolvedValue(new Response(JSON.stringify(rows)));
    expect(await pushActivityEvent({ data: event })).toEqual({ ok: true });
    const row = write.mock.calls[0][0];
    expect(row.title).toBe("Shift closure reported");
    expect(row.message).toBe(`Counted 50\n${SHIFT_CLOSURE_UNCONFIRMED_NOTICE}`);
    expect(row.meta).toEqual({ note: "keep", client_reported: true, shift_closure_status: "unconfirmed" });
  });

  it.each(["response", "timeout"])("does not drop the report if central verification fails: %s", async failure => {
    if (failure === "response") rest.mockResolvedValue(new Response(null, { status: 503 }));
    else rest.mockRejectedValue(new Error("timed out"));
    expect(await pushActivityEvent({ data: event })).toEqual({ ok: true });
    expect(write.mock.calls[0][0].title).toBe("Shift closure reported");
    expect(write.mock.calls[0][0].meta.shift_closure_status).toBe("unconfirmed");
  });

  it("pins a normal terminal manager's report and verification to the registered branch", async () => {
    scope.current.isSupervisor = true;
    scope.current.roleSlug = "manager";
    await pushActivityEvent({ data: { ...event, storeId: "branch-b" } });
    expect(rest.mock.calls[0][0]).toContain("store_id=eq.branch-a");
    expect(write.mock.calls[0][0].store_id).toBe("branch-a");
  });

  it("retains authorized management branch selection", async () => {
    scope.current.isSupervisor = true;
    scope.current.branchRestricted = false;
    rest.mockResolvedValue(new Response(JSON.stringify([{ ...closed, store_id: "branch-b" }])));
    await pushActivityEvent({ data: { ...event, storeId: "branch-b" } });
    expect(rest.mock.calls[0][0]).toContain("store_id=eq.branch-b");
    expect(write.mock.calls[0][0].title).toBe("Shift closure confirmed");
  });

  it("does not query a different entity type or invalid shift identifier", async () => {
    await pushActivityEvent({ data: { ...event, entityType: "sale" } });
    await pushActivityEvent({ data: { ...event, entityId: "not-a-uuid" } });
    expect(rest).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[0][0].title).toBe("Shift closure reported");
  });

  it("does not change unrelated events or their write result", async () => {
    write.mockResolvedValue({ ok: false, error: "pending" });
    expect(await pushActivityEvent({ data: { type: "sale_complete", title: "Sale completed", message: "Saved", meta: { note: "keep" } } })).toEqual({ ok: false, error: "pending" });
    expect(rest).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ title: "Reported activity: Sale completed", message: "Saved", meta: { note: "keep", client_reported: true } }));
  });

  it("accepts a 1,000-character source report and preserves it when status cannot fit", async () => {
    const message = "x".repeat(1000);
    expect(await pushActivityEvent({ data: { ...event, message } })).toEqual({ ok: true });
    expect(write.mock.calls[0][0]).toMatchObject({ title: "Shift closure confirmed", message });
    rest.mockResolvedValue(new Response(JSON.stringify([])));
    expect(await pushActivityEvent({ data: { ...event, message } })).toEqual({ ok: true });
    expect(write.mock.calls[1][0]).toMatchObject({ title: "Shift closure reported", message,
      meta: { shift_closure_status: "unconfirmed" } });
  });
});
