import { describe, expect, it } from "vitest";
import {
  hasTelemetryAuthSession,
  health,
  mergeTerminalTelemetry,
  type TelemetryRow,
} from "../telemetry";

const live: TelemetryRow = {
  terminal_id: "terminal-live",
  store_id: "store-1",
  terminal_name: null,
  staff_name: "Asha",
  staff_role: "cashier",
  db_mode: "local",
  connection_status: "online",
  storage_engine: "sqlserver",
  pending_count: 0,
  conflict_count: 0,
  last_synced_at: "2026-09-27T10:00:00.000Z",
  app_version: null,
  platform: null,
  last_seen_at: "2026-09-27T10:00:00.000Z",
  last_heartbeat_at: "2026-09-27T10:00:00.000Z",
};

describe("current terminal telemetry", () => {
  it("does not publish during the Supabase sign-out transition", () => {
    expect(hasTelemetryAuthSession(null)).toBe(false);
    expect(hasTelemetryAuthSession({ access_token: "" })).toBe(false);
    expect(hasTelemetryAuthSession({ access_token: "authenticated-jwt" })).toBe(true);
  });

  it("shows every registered terminal, including one that has never checked in", () => {
    const rows = mergeTerminalTelemetry(
      [live],
      [
        {
          id: "terminal-live",
          location_id: "store-1",
          location_name: "Main Branch",
          device_name: "Till 1",
          status: "used",
          platform: "pc",
          app_version: "1.3.262",
          last_seen_at: live.last_seen_at,
          last_sync_at: live.last_synced_at,
        },
        {
          id: "terminal-new",
          location_id: "store-1",
          location_name: "Main Branch",
          device_name: "Till 2",
          status: "active",
          platform: "pc",
          app_version: null,
          last_seen_at: null,
          last_sync_at: null,
        },
      ],
    );

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.terminal_id === "terminal-live")).toMatchObject({
      device_name: "Till 1",
      location_name: "Main Branch",
      staff_name: "Asha",
    });
    const unseen = rows.find((row) => row.terminal_id === "terminal-new")!;
    expect(unseen.session_status).toBe("never_seen");
    expect(health(unseen)).toBe("unknown");
  });

  it("drops orphaned heartbeat rows after a terminal is revoked or deleted", () => {
    expect(mergeTerminalTelemetry([live], [])).toEqual([]);
  });
});
