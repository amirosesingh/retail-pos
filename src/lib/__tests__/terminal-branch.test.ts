import { beforeEach, describe, expect, it, vi } from "vitest";

// A minimal browser storage stand-in so the resolver can persist a branch.
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
};

vi.mock("@/core/activation/terminal-tokens", () => ({ readTerminalConfig: () => null }));
vi.mock("@/core/local-db/local-db", () => ({ readBranch: () => ({ branchId: null, branchName: null }) }));

import { activeBranchId, bindTerminalBranch, setKnownBranches } from "../active-branch";
import { describeError } from "../notify";

describe("terminal branch binding", () => {
  beforeEach(() => {
    store.clear();
    setKnownBranches([]);
  });

  it("keeps the bound branch across reads once it is set", () => {
    bindTerminalBranch("branch-1", "Main Street");
    expect(activeBranchId(null)).toBe("branch-1");
  });

  it("prefers the bound branch over the branch merely in view", () => {
    bindTerminalBranch("branch-1", "Main Street");
    expect(activeBranchId("other-branch")).toBe("branch-1");
  });

  it("uses the only branch that exists when nothing is bound", () => {
    setKnownBranches(["only-branch"]);
    expect(activeBranchId(null)).toBe("only-branch");
  });
});

describe("error messages", () => {
  it("explains a foreign key block in plain words", () => {
    const message = describeError(
      { code: "23503", message: 'violates foreign key constraint "sale_items_product_id_fkey"' },
      "Deleting this product",
    );
    expect(message).toContain("other records still point at this entry");
  });

  it("does not describe a location-save foreign key failure as a delete blocker", () => {
    const message = describeError(
      { code: "23503", message: 'violates foreign key constraint "stores_group_id_fkey"' },
      "Saving location",
    );
    expect(message).toContain("selected group or parent location no longer exists");
    expect(message).not.toContain("other records still point at this entry");
  });

  it("does not promise an online-only action was stored", () => {
    expect(describeError(new Error("Failed to fetch"), "Saving the sale")).toContain(
      "internet connection",
    );
  });

  it("turns an access-rule refusal into an actionable sentence", () => {
    expect(describeError({ code: "42501", message: "permission denied for table sales" })).toContain(
      "don't have permission",
    );
  });
});
