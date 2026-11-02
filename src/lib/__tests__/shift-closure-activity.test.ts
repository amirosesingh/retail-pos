import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SHIFT_CLOSURE_UNCONFIRMED_NOTICE,
  unconfirmedShiftClosureActivityRow,
} from "../../../electron/shift-closure-activity.mjs";

const { send, park, values } = vi.hoisted(() => ({ send: vi.fn(), park: vi.fn(), values: new Map<string, string>() }));
vi.mock("../activity-events-client", () => ({ pushActivityEvent: send }));
vi.mock("../pos-credentials", () => ({ readCredentials: async () => ({ cashierToken: "verified-session" }) }));
vi.mock("../business-storage", () => ({ readBusinessValue: (key: string) => values.get(key), writeBusinessValue: (key: string, value: string) => values.set(key, value) }));
vi.mock("../governance-offline", () => ({ parkGovernanceRow: park }));
vi.mock("../server-origin", () => ({ posFetch: vi.fn() }));
vi.mock("@/integrations/supabase/external-client", () => ({ supabaseExternal: {} }));
vi.mock("@/core/local-db/local-db", () => ({ localDb: () => null }));

const event = { type: "shift_close", title: "Shift closed", message: "Cashier closed the shift with 50 counted.", entityType: "shift", entityId: "shift-a", storeId: "branch-a", amount: 50, meta: { note: "end of day" } };

describe("durable shift closure report status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    values.clear();
    park.mockResolvedValue({ parked: false });
    send.mockResolvedValue({ ok: true });
    vi.stubGlobal("window", { localStorage: { getItem: () => null }, sessionStorage: { getItem: () => null } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("parks a clearly unconfirmed Electron report before contacting central delivery", async () => {
    window.pos = {} as typeof window.pos;
    park.mockResolvedValue({ parked: true });
    const { recordActivity } = await import("../activity-events");
    await recordActivity(event);
    expect(send).not.toHaveBeenCalled();
    expect(park).toHaveBeenCalledWith("activity_events", expect.objectContaining({
      event_type: "shift_close", title: "Shift closure reported", store_id: "branch-a", amount: 50,
      message: `${event.message}\n${SHIFT_CLOSURE_UNCONFIRMED_NOTICE}`,
      meta: { note: "end of day", client_reported: true, shift_closure_status: "unconfirmed" },
    }));
  });

  it("retains an offline browser report and reuses its identity on the next delivery attempt", async () => {
    send.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true });
    const { recordActivity, flushActivityQueue, pendingActivityCount } = await import("../activity-events");
    await recordActivity(event);
    expect(pendingActivityCount()).toBe(1);
    const first = send.mock.calls[0][0].data;
    await flushActivityQueue();
    const retry = send.mock.calls[1][0].data;
    expect(retry.clientEventId).toBe(first.clientEventId);
    expect(retry.message).toBe(first.message);
    expect(retry.meta.shift_closure_status).toBe("unconfirmed");
    expect(pendingActivityCount()).toBe(0);
  });

  it("normalizes an existing queued raw closure without trusting its claimed confirmation", async () => {
    values.set("pos.activity.queue.v1", JSON.stringify([{ ...event, clientEventId: "original-event", createdAt: "2026-10-30T01:00:00Z", meta: { shift_closure_status: "central_confirmed", shift_closure_closed_at: "forged", note: "keep" } }]));
    const { flushActivityQueue } = await import("../activity-events");
    await flushActivityQueue();
    const data = send.mock.calls[0][0].data;
    expect(data.title).toBe("Shift closure reported");
    expect(data.meta).toEqual({ note: "keep", client_reported: true, shift_closure_status: "unconfirmed" });
    expect(data.clientEventId).toBe("original-event");
  });

  it("is idempotent for native retry payloads and never mutates the durable source row", () => {
    const row = { event_type: "shift_close", title: "Shift closed", message: "Counted 50", meta: JSON.stringify({ note: "keep", shift_closure_status: "central_confirmed" }), store_id: "branch-a", client_event_id: "same-event" };
    const once = unconfirmedShiftClosureActivityRow(row);
    expect(unconfirmedShiftClosureActivityRow(once)).toEqual(once);
    expect(row.title).toBe("Shift closed");
    expect(typeof row.meta).toBe("string");
    expect(once.store_id).toBe(row.store_id);
    expect(once.client_event_id).toBe(row.client_event_id);
    expect(once.meta).toEqual({ note: "keep", client_reported: true, shift_closure_status: "unconfirmed" });
  });

  it("keeps a full-length report deliverable without truncating its original detail", async () => {
    const message = "x".repeat(1000);
    send.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true });
    const { recordActivity, flushActivityQueue } = await import("../activity-events");
    await recordActivity({ ...event, message });
    await flushActivityQueue();
    for (const [call] of send.mock.calls) {
      expect(call.data.message).toBe(message);
      expect(call.data.title).toBe("Shift closure reported");
      expect(call.data.meta.shift_closure_status).toBe("unconfirmed");
    }
    expect(send.mock.calls[0][0].data.clientEventId).toBe(send.mock.calls[1][0].data.clientEventId);
  });

  it("leaves every non-closure notification unchanged", async () => {
    const row = { event_type: "sale_complete", title: "Sale completed", message: "Saved", meta: { audience_user_ids: ["selected"] } };
    expect(unconfirmedShiftClosureActivityRow(row)).toBe(row);
    const { recordActivity } = await import("../activity-events");
    await recordActivity({ type: row.event_type, title: row.title, message: row.message, meta: row.meta });
    expect(send).toHaveBeenCalledWith({ data: expect.objectContaining({ title: row.title, message: row.message, meta: row.meta }) });
  });
});
