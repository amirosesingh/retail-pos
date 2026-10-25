import { afterEach, expect, it, vi } from "vitest";
vi.mock("../external-supabase-config", () => ({ supabaseConfig: () => ({ url: "https://example.supabase.co" }) }));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceKey: () => "sb_secret_test", serviceRest: vi.fn() }));
import { staffLastSignIns } from "../staff-admin.server";
afterEach(() => vi.unstubAllGlobals());
it("returns only requested user timestamps and keeps metadata server-side", async () => {
 const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ id: "a", last_sign_in_at: "2026-10-19T00:00:00Z", email: "private@example.test" }));
 vi.stubGlobal("fetch", fetcher);
 expect(await staffLastSignIns(["A"])).toEqual(new Map([["a", "2026-10-19T00:00:00Z"]]));
 expect(fetcher).toHaveBeenCalledTimes(1);
 expect(fetcher.mock.calls[0][0]).toContain("/auth/v1/admin/users/a");
});
it("does not block staff loading when Auth metadata fails or there are no linked users", async () => {
 const fetcher = vi.fn(async () => { throw new Error("network unavailable"); });
 vi.stubGlobal("fetch", fetcher);
 expect(await staffLastSignIns([])).toEqual(new Map()); expect(fetcher).not.toHaveBeenCalled();
 expect(await staffLastSignIns(["a"])).toEqual(new Map());
});
