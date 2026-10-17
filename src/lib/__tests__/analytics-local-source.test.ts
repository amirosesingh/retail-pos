import { beforeEach, describe, expect, it, vi } from "vitest";
const h=vi.hoisted(()=>({bridge:null as null|{analytics:ReturnType<typeof vi.fn>},from:vi.fn()}));
vi.mock("@/core/local-db/local-db",()=>({localDb:()=>h.bridge}));
vi.mock("@/core/local-db/db-mode",()=>({effectiveDatabaseMode:()=>"local"}));
vi.mock("@/integrations/supabase/external-client",()=>({supabaseExternal:{from:h.from}}));
import { fetchBoard } from "../analytics-board";
beforeEach(()=>{h.bridge=null;h.from.mockReset();});
describe("native analytics source and identities",()=>{
  it("does not silently switch a SQL terminal to the cloud when its bridge is missing",async()=>{
    await expect(fetchBoard("2026-10-17","2026-10-17")).rejects.toThrow("Local SQL analytics are unavailable");
    expect(h.from).not.toHaveBeenCalled();
  });
  it("normalizes every local branch UUID before branch selections are applied",async()=>{
    const id="A611A328-2217-4D77-944A-5F6A637D123B";
    h.bridge={analytics:vi.fn().mockResolvedValue({ok:true,storeDays:[{store_id:id}],itemDays:[{store_id:id}],bills:[{store_id:id,created_at:"2026-10-17T00:00:00Z"}],directory:[]})};
    const result=await fetchBoard("2026-10-17","2026-10-17");
    expect(result.storeDays[0].store_id).toBe(id.toLowerCase());
    expect(result.itemDays[0].store_id).toBe(id.toLowerCase());
    expect(result.bills[0].store_id).toBe(id.toLowerCase());
    expect(result.localOnly).toBe(true);expect(h.from).not.toHaveBeenCalled();
  });
});
