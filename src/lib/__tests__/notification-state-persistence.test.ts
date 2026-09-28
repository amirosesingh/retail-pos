import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const posFetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ ok: true }) }));
const readCredentials = vi.fn<
  () => Promise<{ sessionToken?: string; cashierToken?: string; accessToken?: string }>
>(async () => ({ cashierToken: "signed-in" }));
vi.mock("../server-origin", () => ({ posFetch }));
vi.mock("../pos-credentials", () => ({ readCredentials }));
vi.mock("../activity-events.functions", () => ({ pushActivityEvent: vi.fn() }));

const values = new Map<string, string>();
const localStorage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
  clear: () => values.clear(),
};

describe("per-user notification state", () => {
  beforeEach(() => {
    values.clear();
    posFetch.mockClear();
    readCredentials.mockReset();
    readCredentials.mockResolvedValue({ cashierToken: "signed-in" });
    Object.assign(globalThis, {
      window: { localStorage, dispatchEvent: vi.fn() },
      localStorage,
      CustomEvent: class {
        constructor(public type: string) {}
      },
    });
  });

  it("survives refresh and remains isolated between users", async () => {
    const activity = await import("../activity-events");
    expect(await activity.clearActivityEntry("manager-1", "event-1")).toBe(true);
    expect(activity.isCleared("manager-1", "event-1")).toBe(true);
    expect(activity.isCleared("manager-2", "event-1")).toBe(false);
    expect(posFetch).toHaveBeenCalledWith(
      "/api/v1/pos/activity-preferences",
      expect.objectContaining({
        body: expect.stringContaining('"eventId":"event-1"'),
      }),
    );
  });

  it("merges a dismissal made on another device", async () => {
    const activity = await import("../activity-events");
    const row = {
      id: "event-remote",
      clearedBy: ["MANAGER-1"],
    } as Parameters<typeof activity.mergeRemoteActivityPreferences>[1][number];
    activity.mergeRemoteActivityPreferences("manager-1", [row]);
    expect(activity.clearedIds("manager-1")).toContain("event-remote");
  });

  it("clears every active notification through one synchronized server action", async () => {
    const activity = await import("../activity-events");
    expect(await activity.clearAllActivityEntries("manager-1", ["event-1", "event-2"])).toBe(true);
    expect(activity.clearedIds("manager-1")).toEqual(
      expect.arrayContaining(["event-1", "event-2"]),
    );
    expect(posFetch).toHaveBeenCalledWith(
      "/api/v1/pos/activity-preferences",
      expect.objectContaining({ body: expect.stringContaining('"action":"clear_all"') }),
    );
  });

  it("keeps a notification visible when the server cannot save the clear", async () => {
    posFetch.mockResolvedValueOnce({ ok: false, json: async () => ({ ok: false }) });
    const activity = await import("../activity-events");
    expect(await activity.clearActivityEntry("manager-1", "event-2")).toBe(false);
    expect(activity.isCleared("manager-1", "event-2")).toBe(false);
  });

  it("does not call the protected endpoint without a signed-in person", async () => {
    readCredentials.mockResolvedValueOnce({});
    const activity = await import("../activity-events");
    expect(await activity.listActivityEvents()).toEqual([]);
    expect(posFetch).not.toHaveBeenCalled();
  });

  it("persists read markers across navigation and login cycles", async () => {
    const activity = await import("../activity-events");
    activity.markActivitySeen("2026-09-15T12:00:00.000Z", "manager-1");
    expect(activity.lastSeenAt("manager-1")).toBe("2026-09-15T12:00:00.000Z");
    expect(activity.lastSeenAt("manager-2")).toBe("");
  });

  it("requests server-side paging for large alert histories", async () => {
    posFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        total: 1204,
        rows: [
          {
            id: "alert-1",
            event_type: "stock_adjust",
            severity: "warning",
            title: "Stock changed",
            meta: { quantity: 4 },
            created_at: "2026-09-24T01:00:00.000Z",
          },
        ],
      }),
    });
    const activity = await import("../activity-events");
    const result = await activity.listActivityEventPage({
      limit: 25,
      offset: 50,
      query: "shuttle",
      severities: ["warning", "critical"],
    });
    expect(result.total).toBe(1204);
    expect(result.rows[0]?.meta).toEqual({ quantity: 4 });
    expect(posFetch).toHaveBeenCalledWith(
      "/api/v1/pos/activity-preferences",
      expect.objectContaining({
        body: expect.stringContaining('"offset":50'),
      }),
    );
  });

  it("allows terminal shells to call the hosted preference endpoint", () => {
    const route = readFileSync("src/routes/api/v1/pos/activity-preferences.ts", "utf8");
    expect(route).toContain("withCors(Response.json");
    expect(route).toContain("OPTIONS: async ({ request }) => corsPreflight(request)");
  });

  it("reuses the canonical relay identity scope for supervisor access", () => {
    const route = readFileSync("src/routes/api/v1/pos/activity-preferences.ts", "utf8");
    expect(route).toContain("resolveRelayScope(caller)");
    expect(route).toContain(
      "scope.isSupervisor || scope.permissions.can_view_audit_trail === true",
    );
    expect(route).not.toContain("const identities = [");
  });

  it("keeps bulk clear branch-scoped and publishes preference changes to Realtime", () => {
    const route = readFileSync("src/routes/api/v1/pos/activity-preferences.ts", "utf8");
    const activity = readFileSync("src/lib/activity-events.ts", "utf8");
    const migration = readFileSync(
      "supabase/migrations/20260928025126_sync_activity_notification_history.sql",
      "utf8",
    );
    expect(route).toContain('action: z.enum(["list", "clear", "clear_all"])');
    expect(route).toContain("p_store_id: isAdmin ? null : branch");
    expect(activity).toContain('table: "activity_events"');
    expect(migration).toContain("pos_set_all_activity_events_cleared");
    expect(migration).toContain(
      "ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_events",
    );
  });

  it("moves full history into Reports and uses compact dismissible stacked popups", () => {
    const bell = readFileSync("src/platforms/web/components/pos/ActivityBell.tsx", "utf8");
    const report = readFileSync("src/routes/reports.notifications.tsx", "utf8");
    const styles = readFileSync("src/styles.css", "utf8");
    expect(bell).not.toContain("Full log");
    expect(bell).toContain("Clear all");
    expect(bell).toContain("closeButton: true");
    expect(bell).toContain('position: "top-right"');
    expect(bell).toContain("newlyArrived.slice(0, 4).reverse()");
    expect(styles).toContain("translateX(calc(100% + 1rem))");
    expect(styles).toContain("transform 220ms ease-out");
    expect(report).toContain("Active and history");
    expect(report).toContain("Cleared history");
    expect(report).toContain("reopenActivityEntry");
  });
});
