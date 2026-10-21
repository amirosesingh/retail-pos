import { afterEach, beforeEach, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({ status: (_s: string) => {}, change: () => {}, staff: true, filter: {} as { filter?: string }, off: vi.fn() }));
vi.mock("../owned-postgres-subscription", () => ({ subscribeOwnedPostgresChanges: (_c: unknown, _t: string, filter: { filter?: string }, change: () => void, status: (s: string) => void) => { Object.assign(hooks, { status, change, filter }); return hooks.off; } }));
vi.mock("@/integrations/supabase/external-client", () => ({ supabaseExternal: {} }));
vi.mock("@/core/api/sync-relay", () => ({ hasStaffSession: () => hooks.staff }));
vi.mock("../authorization-client", () => ({ claimAuthorizationRequest: vi.fn(), listAuthorizationRequests: vi.fn() }));
vi.mock("../pos-caller-auth", () => ({ getPosCallerAuth: vi.fn() }));
vi.mock("../held-orders", () => ({ heldOrderForRequest: vi.fn(), markHeldReady: vi.fn() }));
vi.mock("../active-branch", () => ({ activeBranchId: () => "branch-a" }));
vi.mock("@/core/local-db/local-db", () => ({ localDb: () => null }));
import { subscribeApprovals } from "../approval-centre";
beforeEach(() => {
 vi.useFakeTimers(); hooks.staff = true;
 vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
 vi.stubGlobal("window", Object.assign(new EventTarget(), { setInterval, clearInterval }));
 vi.stubGlobal("navigator", { onLine: true });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("uses changes while subscribed, preserves the missed-event safety check and restores polling on disconnect", async () => {
 const read = vi.fn(async () => {}); const stop = subscribeApprovals(read);
 expect(hooks.filter.filter).toBe("store_id=eq.branch-a");
 hooks.status("SUBSCRIBED"); await vi.advanceTimersByTimeAsync(100); read.mockClear();
 await vi.advanceTimersByTimeAsync(290000); expect(read).not.toHaveBeenCalled();
 hooks.change(); hooks.change(); await vi.advanceTimersByTimeAsync(100); expect(read).toHaveBeenCalledOnce();
 await vi.advanceTimersByTimeAsync(305000); expect(read).toHaveBeenCalledTimes(2);
 hooks.status("CHANNEL_ERROR"); await vi.advanceTimersByTimeAsync(10100); expect(read.mock.calls.length).toBeGreaterThan(2);
 stop(); const count = read.mock.calls.length; await vi.advanceTimersByTimeAsync(60000); expect(read).toHaveBeenCalledTimes(count);
});
it("pauses hidden/offline requests, catches up on resume and supports the all-branch page", async () => {
 const read = vi.fn(async () => {}); const stop = subscribeApprovals(read, { allBranches: true });
 expect(hooks.filter.filter).toBeUndefined();
 Object.assign(document, { visibilityState: "hidden" }); hooks.change(); await vi.advanceTimersByTimeAsync(60000); expect(read).not.toHaveBeenCalled();
 Object.assign(document, { visibilityState: "visible" }); Object.assign(navigator, { onLine: false }); await vi.advanceTimersByTimeAsync(60000); expect(read).not.toHaveBeenCalled();
 Object.assign(navigator, { onLine: true }); window.dispatchEvent(new Event("online")); await vi.advanceTimersByTimeAsync(100); expect(read).toHaveBeenCalledOnce(); stop();
});
it("keeps remote decisions timely for PIN sessions without direct Realtime", async () => {
 hooks.staff = false; const read = vi.fn(async () => {}); const stop = subscribeApprovals(read);
 await vi.advanceTimersByTimeAsync(5100); expect(read).toHaveBeenCalledOnce(); stop();
});
