import { describe, expect, it } from "vitest";
import type { Store } from "@/core/types/pos-types";
import { companyStoreScope } from "../company-store-scope";
const stores = [
  { id: "a", groupId: "company-a" }, { id: "a2", groupId: "company-a" },
  { id: "b", groupId: "company-b" }, { id: "unassigned" }, { id: "unassigned2" },
] as Store[];
describe("selected company report context", () => {
  it("aggregates branches in the selected company without combining other companies", () => {
    expect(companyStoreScope(stores, "a").map(store => store.id)).toEqual(["a", "a2"]);
    expect(companyStoreScope(stores, "b").map(store => store.id)).toEqual(["b"]);
    expect(stores).toHaveLength(5);
  });
  it("keeps a branch device or fixed user on its own branch even within the same company", () => {
    expect(companyStoreScope(stores, "a", true).map(store => store.id)).toEqual(["a"]);
  });
  it("never treats missing group or unknown branch as an all-company selection", () => {
    expect(companyStoreScope(stores, "unassigned").map(store => store.id)).toEqual(["unassigned"]);
    expect(companyStoreScope(stores, "missing")).toEqual([]);
  });
  it("normalizes local SQL UUID casing for both branch and company identifiers", () => {
    const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    const group = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
    expect(companyStoreScope([{ id, groupId: group.toUpperCase() }, { id: "sibling", groupId: group }] as Store[], id.toUpperCase())).toHaveLength(2);
  });
});
