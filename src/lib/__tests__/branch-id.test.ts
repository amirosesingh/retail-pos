import { describe, expect, it } from "vitest";
import { canonicalBranchId, canonicalStockMap, sameBranchId } from "../branch-id";

describe("branch identity", () => {
  const lower = "15a19c3f-1805-428b-8606-e82e474f0db3";
  const upper = lower.toUpperCase();

  it("normalizes UUID branch identifiers without changing human codes", () => {
    expect(canonicalBranchId(upper)).toBe(lower);
    expect(canonicalBranchId(" LC361D ")).toBe("LC361D");
    expect(sameBranchId(lower, upper)).toBe(true);
  });

  it("merges split stock buckets without losing units", () => {
    expect(canonicalStockMap({ [lower]: 2, [upper]: -1, warehouse: 4 })).toEqual({
      [lower]: 1,
      warehouse: 4,
    });
  });
});
