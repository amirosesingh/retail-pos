import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({rest:vi.fn()}));
vi.mock("@/core/api/pos-relay.server",()=>({serviceRest:mocks.rest}));
beforeEach(()=>{vi.resetModules();mocks.rest.mockReset();});
it("keeps existing synchronization intact before the preservation migration is installed",async()=>{
 mocks.rest.mockResolvedValue(Response.json([]));
 const {commerceSyncIsolationReady}=await import("../commerce-sync-readiness.server");
 expect(await commerceSyncIsolationReady()).toBe(false);
});
it("enables isolation only with the database migration marker and coalesces repeated checks",async()=>{
 mocks.rest.mockResolvedValue(Response.json([{enabled:true}]));
 const {commerceSyncIsolationReady}=await import("../commerce-sync-readiness.server");
 expect(await Promise.all([commerceSyncIsolationReady(),commerceSyncIsolationReady()])).toEqual([true,true]);
 expect(mocks.rest).toHaveBeenCalledTimes(1);
});
it("does not break established till synchronization during a capability read failure",async()=>{
 mocks.rest.mockRejectedValue(new Error("temporarily unavailable"));
 const {commerceSyncIsolationReady}=await import("../commerce-sync-readiness.server");
 expect(await commerceSyncIsolationReady()).toBe(false);
});
