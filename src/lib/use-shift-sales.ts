import { useEffect } from "react";
import { useQuery,useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./pos-auth";
import { PAGE_DATA_CACHE,pageDataScope } from "./page-data-cache";
import { canonicalBranchId } from "./branch-id";
import { subscribePageDataRefresh } from "./page-data-refresh";
import { readCompleteShiftSales } from "./shift-sales-read";
import type { Shift } from "@/core/types/pos-types";
import { sessionEpoch,isCurrentEpoch } from "./session-epoch";

export function useShiftSales(branchId:string,shiftId:string|undefined,enabled=true){
 const {user,ready}=useAuth();const client=useQueryClient();
 const scope=JSON.stringify(pageDataScope(user));
 const branch=canonicalBranchId(branchId);const shift=canonicalBranchId(shiftId);
 const active=enabled && ready && !!user && !!branch && !!shift;
 const key=["complete-shift-sales",scope,branch,shift];
 const query=useQuery({queryKey:key,enabled:active,networkMode:"always",...PAGE_DATA_CACHE,retry:false,
  meta:{tables:["sales","sale_items","payment_transactions"]},queryFn:({signal})=>readCompleteShiftSales(branchId,shiftId!,signal)});
 useEffect(()=>{
  if(!active)return;
  return subscribePageDataRefresh(()=>client.invalidateQueries({queryKey:["complete-shift-sales",scope,branch,shift],exact:true}),
   ["sales","sale_items","payment_transactions"],{allowOffline:true});
 },[active,client,scope,branch,shift]);
 const readForPrint=async(selected:Shift)=>{
  if(!ready || !user || canonicalBranchId(selected.storeId)!==branch) throw new Error("Choose a shift from the current branch.");
  const epoch=sessionEpoch();
  const sales=await client.fetchQuery({queryKey:["complete-shift-sales",scope,branch,canonicalBranchId(selected.id)],...PAGE_DATA_CACHE,
   staleTime:0,retry:false,networkMode:"always",meta:{tables:["sales","sale_items","payment_transactions"]},
   queryFn:({signal})=>readCompleteShiftSales(branchId,selected.id,signal)});
  if(!isCurrentEpoch(epoch)) throw new Error("Sign-in changed while preparing the shift report.");
  return sales;
 };
 return {sales:active ? query.data : undefined,loading:active && query.isPending,error:active && query.error ? query.error.message : "",readForPrint};
}
