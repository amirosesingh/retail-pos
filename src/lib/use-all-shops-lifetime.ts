import { useEffect } from "react";
import { useQuery,useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./pos-auth";
import { PAGE_DATA_CACHE,pageDataScope } from "./page-data-cache";
import { canonicalBranchId } from "./branch-id";
import { subscribeBackgroundRefresh } from "./background-refresh";
import { subscribeSalesChange } from "./sync-engine";
import { loadAllShopsLifetime } from "./all-shops-lifetime";

export function useAllShopsLifetime(storeIds: readonly string[],through:string,enabled:boolean,includeProfit=false) {
 const {ready,user}=useAuth();
 const client=useQueryClient();
 const stores=[...new Set(storeIds.filter(Boolean).map(canonicalBranchId))].sort().join("|");
 const scope=JSON.stringify(pageDataScope(user));
 const active=enabled && ready && Boolean(user) && Boolean(stores);
 const query=useQuery({queryKey:["all-shops-lifetime",scope,stores,through,includeProfit],enabled:active,networkMode:"always",
   ...PAGE_DATA_CACHE,retry:false,meta:{tables:["sales","sale_items"]},
   queryFn:()=>loadAllShopsLifetime(stores.split("|"),through,includeProfit)});
 useEffect(()=>{
   if(!active) return;
   const key=["all-shops-lifetime",scope,stores,through,includeProfit];
   let timer:ReturnType<typeof setTimeout>|undefined;
   const refresh=()=>{void client.invalidateQueries({queryKey:key,exact:true});};
   const off=subscribeSalesChange(change=>{
     if(change?.storeId && !stores.split("|").includes(canonicalBranchId(change.storeId))) return;
     if(timer) return;
     timer=setTimeout(()=>{timer=undefined;refresh();},100);
   });
   const catchup=subscribeBackgroundRefresh(refresh,300_000,true);
   return()=>{off();catchup();if(timer) clearTimeout(timer);};
 },[active,client,scope,stores,through,includeProfit]);
 return {totals:active ? query.data : undefined,loading:active && query.isPending,
   refreshing:active && query.isFetching,error:active && query.error ? query.error.message : ""};
}
