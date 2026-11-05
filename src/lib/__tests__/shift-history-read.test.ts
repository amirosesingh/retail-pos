import { beforeEach, expect, it, vi } from "vitest";
import type { Shift } from "@/core/types/pos-types";
import { onlineManager, QueryClient } from "@tanstack/react-query";
const h=vi.hoisted(()=>({page:vi.fn()}));
vi.mock("@/core/api/pos-db",()=>({loadShiftPage:h.page}));
import { readCompleteShiftHistory, shiftHistoryNetworkMode } from "../shift-history-read";
const shift=(id:string,storeId="A",openedAt="2026-10-20T12:00:00Z")=>({id,storeId,openedAt} as Shift);
beforeEach(()=>h.page.mockReset());
it("reads beyond the initial 300 shifts and filters branch/business days",async()=>{
  h.page.mockResolvedValueOnce({rows:Array.from({length:500},(_,n)=>shift(String(n))),hasMore:true,cursor:{ts:"2026-10-20T12:00:00Z",id:"499"}})
    .mockResolvedValueOnce({rows:[shift("last"),shift("foreign","B"),shift("old","A","2026-09-30T12:00:00Z")],hasMore:false,cursor:null});
  const rows=await readCompleteShiftHistory("A","2026-10-01","2026-10-31","Asia/Kuala_Lumpur");
  expect(rows).toHaveLength(501);
  expect(h.page).toHaveBeenNthCalledWith(2,"A",{ts:"2026-10-20T12:00:00Z",id:"499"},500,expect.objectContaining({source:"auto"}));
});
it("refuses stuck cursors and failed reads rather than returning partial history",async()=>{
  h.page.mockResolvedValue({rows:[shift("one")],hasMore:true,cursor:{ts:"2026-10-20T12:00:00Z",id:"one"}});
  await expect(readCompleteShiftHistory("A","","","UTC")).rejects.toThrow("did not advance");
  h.page.mockRejectedValueOnce(new Error("Permission denied"));
  await expect(readCompleteShiftHistory("A","","","UTC")).rejects.toThrow("Permission denied");
});
it("discards a response cancelled while another branch is selected",async()=>{
  const controller=new AbortController();
  h.page.mockImplementationOnce(async()=>{controller.abort();return {rows:[shift("late")],hasMore:false,cursor:null};});
  await expect(readCompleteShiftHistory("A","","","UTC",controller.signal)).rejects.toThrow("cancelled");
});
it("refuses to mix a management replica page with a later cloud fallback",async()=>{
  h.page.mockResolvedValueOnce({rows:[shift("one")],hasMore:true,cursor:{ts:"2026-10-20T12:00:00Z",id:"one"},source:"management-local"})
    .mockResolvedValueOnce({rows:[shift("two")],hasMore:false,cursor:null,source:"cloud"});
  await expect(readCompleteShiftHistory("A","","","UTC")).rejects.toThrow("source changed");
});
it("executes the local/management reader while offline instead of pausing before authority checks",async()=>{
  const wasOnline=onlineManager.isOnline();
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  onlineManager.setOnline(false);
  h.page.mockResolvedValueOnce({rows:[shift("offline")],hasMore:false,cursor:null,source:"management-local"});
  try {
    const rows=await client.fetchQuery({queryKey:["offline-shifts"],networkMode:shiftHistoryNetworkMode("auto"),
      queryFn:()=>readCompleteShiftHistory("A","","","UTC")});
    expect(rows).toHaveLength(1);expect(h.page).toHaveBeenCalledTimes(1);
  } finally {client.clear();onlineManager.setOnline(wasOnline);}
});
