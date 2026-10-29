import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), snapshot: vi.fn(), query: vi.fn(), replica:vi.fn(), local: false, management:false }));
vi.mock("@/integrations/supabase/external-client", () => ({ supabaseExternal: {}, authenticatedExternalClientSnapshot: mocks.snapshot }));
vi.mock("@/core/local-db/db-mode", () => ({ effectiveDatabaseMode: () => mocks.local ? "local" : "online" }));
vi.mock("@/core/api/db-query", () => ({ routedQuery: mocks.query }));
vi.mock("@/lib/management-device",()=>({isManagementDevice:()=>mocks.management}));
vi.mock("@/lib/management-report-client",()=>({readManagementReport:mocks.replica}));
import { loadShiftPage, loadShiftsByIds } from "@/core/api/pos-db";
beforeEach(() => {
  vi.clearAllMocks(); mocks.local = false;mocks.management=false;mocks.replica.mockResolvedValue(null);
  mocks.snapshot.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: [], error: null });
  mocks.query.mockResolvedValue([]);
});
it("uses the secure projection for every online ID batch without a direct table read", async () => {
  const ids = Array.from({ length: 501 }, (_, index) => `shift-${index}`);
  await expect(loadShiftsByIds(ids)).resolves.toEqual([]);
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
  expect(mocks.rpc).toHaveBeenNthCalledWith(1, "shift_rows_secure", { p_ids: ids.slice(0, 500) });
  expect(mocks.rpc).toHaveBeenNthCalledWith(2, "shift_rows_secure", { p_ids: ids.slice(500) });
  expect(mocks.query).not.toHaveBeenCalled();
});
it("retains Electron's local SQL path without requiring cloud authentication", async () => {
  mocks.local = true;
  await expect(loadShiftsByIds(["local-shift"])).resolves.toEqual([]);
  expect(mocks.snapshot).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.query).toHaveBeenCalledWith("shifts", expect.objectContaining({ in: { column: "id", values: ["local-shift"] } }));
});
it("does not turn a refused or unauthenticated refresh into a successful empty result", async () => {
  mocks.snapshot.mockResolvedValueOnce(null);
  await expect(loadShiftsByIds(["shift"])).rejects.toThrow("session");
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error("Permission denied") });
  await expect(loadShiftsByIds(["shift"])).rejects.toThrow("Permission denied");
});

it("pages cloud shift history through the masked projection without a direct table read",async()=>{
  await loadShiftPage("branch-a",{ts:"2026-10-20T12:00:00Z",id:"shift-id"},500,{from:"2026-10-01T00:00:00Z",to:"2026-10-31T23:59:59Z"});
  expect(mocks.rpc).toHaveBeenCalledWith("shift_page_secure",{
    p_store_id:"branch-a",p_before_opened_at:"2026-10-20T12:00:00Z",p_before_id:"shift-id",p_limit:500,
    p_from:"2026-10-01T00:00:00Z",p_to:"2026-10-31T23:59:59Z",
  });
  expect(mocks.query).not.toHaveBeenCalled();
});

it("retains native date/keyset paging and normalizes SQL dates before making the next cursor",async()=>{
  mocks.local=true;
  mocks.query.mockResolvedValueOnce([{id:"shift-id",store_id:"branch-a",opened_at:new Date("2026-10-20T12:00:00Z")}]);
  const page=await loadShiftPage("branch-a",null,1,{from:"2026-10-01T00:00:00Z",to:"2026-10-31T23:59:59Z"});
  expect(page.cursor).toEqual({ts:"2026-10-20T12:00:00.000Z",id:"shift-id"});
  expect(mocks.query).toHaveBeenCalledWith("shifts",expect.objectContaining({match:{store_id:"branch-a"},dateRange:{column:"opened_at",from:"2026-10-01T00:00:00Z",to:"2026-10-31T23:59:59Z"}}));
  expect(mocks.snapshot).not.toHaveBeenCalled();
});

it("can explicitly read cloud history on a management replica and refuses an absent session",async()=>{
  mocks.local=true;
  await loadShiftPage("branch-a",null,500,{source:"cloud"});
  expect(mocks.rpc).toHaveBeenCalled();expect(mocks.query).not.toHaveBeenCalled();
  mocks.snapshot.mockResolvedValueOnce(null);
  await expect(loadShiftPage("branch-a",null,500,{source:"cloud"})).rejects.toThrow("session");
});

it("uses the verified read-only management capability and never opens generic local queries",async()=>{
  mocks.local=true;mocks.management=true;
  mocks.replica.mockResolvedValueOnce({rows:[{id:"shift-id",store_id:"branch-a",opened_at:"2026-10-20T12:00:00Z"}],complete:true});
  const page=await loadShiftPage("branch-a",null,1,{businessFrom:"2026-10-01",businessTo:"2026-10-31",timeZone:"Asia/Kuala_Lumpur"});
  expect(page.source).toBe("management-local");
  expect(mocks.replica).toHaveBeenCalledWith(expect.objectContaining({kind:"shifts",storeIds:["branch-a"],from:"2026-10-01",to:"2026-10-31",zone:"Asia/Kuala_Lumpur"}));
  expect(mocks.query).not.toHaveBeenCalled();expect(mocks.snapshot).not.toHaveBeenCalled();
});

it("falls back to cloud if the management replica is incomplete, without generic local access",async()=>{
  mocks.local=true;mocks.management=true;
  const page=await loadShiftPage("branch-a");
  expect(page.source).toBe("cloud");expect(mocks.query).not.toHaveBeenCalled();expect(mocks.rpc).toHaveBeenCalled();
});
