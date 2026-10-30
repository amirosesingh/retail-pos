import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./pos-auth";
import { PAGE_DATA_CACHE,pageDataScope } from "./page-data-cache";
import { canonicalBranchId } from "./branch-id";
import { loadAllShopsLifetime } from "./all-shops-lifetime";

export function useAllShopsLifetime(storeIds: readonly string[],through:string,enabled:boolean,includeProfit=false) {
 const {ready,user}=useAuth();
 const stores=[...new Set(storeIds.filter(Boolean).map(canonicalBranchId))].sort().join("|");
 const scope=JSON.stringify(pageDataScope(user));
 const active=enabled && ready && Boolean(user) && Boolean(stores);
 const query=useQuery({queryKey:["all-shops-lifetime",scope,stores,through,includeProfit],enabled:active,networkMode:"always",
   ...PAGE_DATA_CACHE,retry:false,refetchOnWindowFocus:false,refetchOnReconnect:false,
   meta:{tables:["sales","sale_items","payment_transactions"],liveRefresh:{allowOffline:true,storeIds:stores.split("|"),salesHints:true}},
   queryFn:()=>loadAllShopsLifetime(stores.split("|"),through,includeProfit)});
 return {totals:active ? query.data : undefined,loading:active && query.isPending,
   refreshing:active && query.isFetching,error:active && query.error ? query.error.message : ""};
}
