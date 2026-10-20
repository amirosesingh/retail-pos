import { beforeEach, expect, it, vi } from "vitest";
const { rest, supervisor } = vi.hoisted(() => ({rest: vi.fn(), supervisor: vi.fn()}));
vi.mock("@/core/api/pos-relay.server", () => ({serviceRest: rest}));
vi.mock("@/lib/external-supabase-config", () => ({supabaseConfig: () => ({url: "https://pos.example", key: "publishable"})}));
vi.mock("@tanstack/react-start", () => ({createServerFn: () => ({validator: (parse: (v: unknown) => unknown) => ({
  handler: (fn: (v: {data: unknown}) => unknown) => (v: {data: unknown}) => fn({data: parse(v.data)}),
})})}));
import { listDeviceSessions, revokeDeviceSessions } from "../user-sessions.functions";
beforeEach(() => {rest.mockReset(); supervisor.mockReset(); vi.stubGlobal("fetch", supervisor);});
it("does not read sessions or reset users without supervisor verification", async () => {
  supervisor.mockResolvedValue(new Response("false"));
  expect((await listDeviceSessions({data: {accessToken: "staff"}})).ok).toBe(false);
  supervisor.mockResolvedValue(new Response("false"));
  expect((await revokeDeviceSessions({data: {accessToken: "staff", sessionId: "session"}})).ok).toBe(false);
  expect(rest).not.toHaveBeenCalled();
});
it("does not claim a failed remote reset succeeded", async () => {
  supervisor.mockResolvedValue(new Response("true"));
  rest.mockResolvedValue(new Response(null, {status: 503}));
  const result = await revokeDeviceSessions({data: {accessToken: "admin", sessionId: "session"}});
  expect(result.ok).toBe(false);
  expect(result.revoked).toBe(0);
});
