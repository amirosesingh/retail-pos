import { describe, expect, it } from "vitest";
import { salesReportScope } from "../sales-report-scope";
const base = { currentStoreId: "branch-a", selectedStoreId: "branch-a", storeIds: ["branch-a", "branch-b"], canSwitchStores: true };
describe("sales workspace branch scope", () => {
  it("starts on the selected branch and aggregates only after an explicit permitted All selection", () => {
    expect(salesReportScope(base)).toMatchObject({ storeId: "branch-a", storeIds: ["branch-a"], canAggregate: true });
    expect(salesReportScope({ ...base, selectedStoreId: "all" }).storeIds).toEqual(["branch-a", "branch-b"]);
    expect(salesReportScope({ ...base, currentStoreId: "branch-b", selectedStoreId: "branch-b" }).storeIds).toEqual(["branch-b"]);
  });
  it("keeps branch-registered operations devices pinned even for an elevated user", () => {
    expect(salesReportScope({ ...base, selectedStoreId: "all", terminalStoreId: "branch-a" })).toMatchObject({ canAggregate: false, storeId: "branch-a", storeIds: ["branch-a"], allowedStoreIds: ["branch-a"] });
    expect(salesReportScope({ ...base, selectedStoreId: "branch-b", terminalStoreId: "branch-a" }).storeIds).toEqual(["branch-a"]);
  });
  it("retains a fixed user's assignment and never uses an empty branch as an unscoped read", () => {
    expect(salesReportScope({ ...base, selectedStoreId: "all", userStoreId: "branch-b" }).storeIds).toEqual(["branch-b"]);
    expect(salesReportScope({ ...base, currentStoreId: "", selectedStoreId: "", canSwitchStores: false }).storeIds).toEqual([]);
    expect(salesReportScope({ ...base, selectedStoreId: "foreign" }).storeIds).toEqual(["branch-a"]);
  });
  it("normalizes SQL Server UUID casing without losing a terminal's pinned branch", () => {
    const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    expect(salesReportScope({ ...base, terminalStoreId: id.toUpperCase(), storeIds: [id] }).storeIds).toEqual([id]);
  });
});
