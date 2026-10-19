import { beforeEach, describe, expect, it, vi } from "vitest";
const { rest } = vi.hoisted(() => ({ rest: vi.fn() }));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: rest }));
import { readActiveSessions } from "../active-sessions.server";
import { isVisibleActiveSession, sessionActivityExpiresAt } from "../session-activity";
import type { DeviceSession } from "../user-sessions.functions";
const now = Date.parse("2026-10-19T09:00:00Z");
const row = (patch: Partial<DeviceSession> = {}): DeviceSession => ({
  id: "session", kind: "staff", label: "User", staff_user_id: "staff", branch_id: "branch-a",
  terminal_id: "terminal-a", platform: "android", idle_timeout_minutes: 30,
  last_activity_at: new Date(now - 60_000).toISOString(), is_revoked: false,
  created_at: new Date(now - 60_000).toISOString(), ...patch,
});
const json = (data: unknown) => new Response(JSON.stringify(data));
beforeEach(() => rest.mockReset());
describe("active session listing", () => {
  it("excludes revoked, signed-out, idle-expired, invalid and older-than-24-hour entries", () => {
    expect(isVisibleActiveSession(row(), now)).toBe(true);
    expect(isVisibleActiveSession(row({ is_revoked: true }), now)).toBe(false);
    expect(isVisibleActiveSession(row({ last_activity_at: new Date(now - 30 * 60_000).toISOString() }), now)).toBe(false);
    expect(isVisibleActiveSession(row({ idle_timeout_minutes: 1440, last_activity_at: new Date(now - 24 * 60 * 60_000).toISOString() }), now)).toBe(false);
    expect(isVisibleActiveSession(row({ last_activity_at: "invalid" }), now)).toBe(false);
    expect(sessionActivityExpiresAt(row({ last_activity_at: "invalid" }))).toBe(0);
    expect(isVisibleActiveSession(row({ last_activity_at: new Date(now + 60_000).toISOString() }), now)).toBe(false);
  });
  it("removes deleted/disabled accounts but keeps genuine concurrent sessions separately resettable", async () => {
    rest.mockResolvedValueOnce(json([
      row(), row({id: "another-device", terminal_id: "terminal-b"}),
      row({id: "removed", staff_user_id: "removed"}), row({id: "signed-out", is_revoked: true}),
    ])).mockResolvedValueOnce(json([{user_id: "staff"}]));
    expect((await readActiveSessions(now)).map(session => session.id)).toEqual(["session", "another-device"]);
    const query = new URLSearchParams(rest.mock.calls[0][0].split("?")[1]);
    expect(query.get("is_revoked")).toBe("eq.false");
    expect(query.get("last_activity_at")).toBe("gt.2026-10-18T09:00:00.000Z");
    expect(query.get("select")).not.toContain("token");
    const users = new URLSearchParams(rest.mock.calls[1][0].split("?")[1]);
    expect(users.get("is_active")).toBe("eq.true");
    expect(rest.mock.calls.every(call => call[1] === undefined)).toBe(true);
  });
  it("pages past expired records rather than hiding live sessions behind the old 200-row cap", async () => {
    rest.mockResolvedValueOnce(json(Array.from({length: 200}, (_, i) => row({id: String(i), last_activity_at: new Date(now - 31 * 60_000).toISOString()}))))
      .mockResolvedValueOnce(json([row()])).mockResolvedValueOnce(json([{user_id: "staff"}]));
    expect((await readActiveSessions(now)).map(session => session.id)).toEqual(["session"]);
    expect(new URLSearchParams(rest.mock.calls[1][0].split("?")[1]).get("offset")).toBe("200");
  });
  it("reports lookup failures rather than incorrectly claiming everyone signed out", async () => {
    rest.mockResolvedValueOnce(json([row()])).mockResolvedValueOnce(new Response(null, {status: 503}));
    await expect(readActiveSessions(now)).rejects.toThrow("Could not verify session accounts");
  });
});
