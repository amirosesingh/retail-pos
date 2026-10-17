import { hostedFunction } from "./hosted-function-client";
import { loadStoreGroupsForCaller as loadStoreGroupsForCallerDirect, saveStoreGroupForCaller as saveStoreGroupForCallerDirect } from "./store-groups.functions";
export const loadStoreGroupsForCaller = hostedFunction("store-groups.loadStoreGroupsForCaller", loadStoreGroupsForCallerDirect);
export const saveStoreGroupForCaller = hostedFunction("store-groups.saveStoreGroupForCaller", saveStoreGroupForCallerDirect);
