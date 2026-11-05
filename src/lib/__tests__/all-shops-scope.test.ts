import { describe,expect,it } from "vitest";
import type { Store } from "@/core/types/pos-types";
import { allShopsScope,allShopsTotalsScope,shopClusterKey } from "../all-shops-scope";
import { companyStoreScope } from "../company-store-scope";
const stores=[{id:"a",groupId:"one"},{id:"a2",groupId:"one"},{id:"b",groupId:"two"},{id:"unassigned"},{id:"unassigned2"}] as Store[];
describe("All Shops management scope",()=>{
 it("shows every authorized shop independently while default totals stay in the selected cluster",()=>{
  const visible=allShopsScope(stores,"a",true);
  expect(visible.map(store=>store.id)).toEqual(["a","a2","b","unassigned","unassigned2"]);
  expect(allShopsTotalsScope(visible,shopClusterKey(stores[0])).map(store=>store.id)).toEqual(["a","a2"]);
  expect(allShopsTotalsScope(visible,"cluster:two").map(store=>store.id)).toEqual(["b"]);
  expect(allShopsTotalsScope(visible,"all")).toHaveLength(5);
  expect(companyStoreScope(visible,"a").map(store=>store.id)).toEqual(["a","a2"]);
 });
 it("never expands a fixed branch even when another cluster or all clusters is selected",()=>{
  const visible=allShopsScope(stores,"a",false);
  expect(visible.map(store=>store.id)).toEqual(["a"]);
  expect(allShopsTotalsScope(visible,"all").map(store=>store.id)).toEqual(["a"]);
  expect(allShopsTotalsScope(visible,"cluster:two")).toEqual([]);
  expect(allShopsScope(stores,"unknown",false)).toEqual([]);
 });
 it("does not combine ungrouped branches into an accidental shared catalogue",()=>{
  expect(allShopsTotalsScope(stores,shopClusterKey(stores[3])).map(store=>store.id)).toEqual(["unassigned"]);
 });
 it("normalizes SQL UUID casing while respecting the provided authorized directory",()=>{
  const id="aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
  const group="bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
  const visible=allShopsScope([{id,groupId:group.toUpperCase()}] as Store[],id.toUpperCase(),false);
  expect(allShopsTotalsScope(visible,`cluster:${group}`)).toHaveLength(1);
  expect(allShopsTotalsScope(visible,"all")).toHaveLength(1);
 });
});
