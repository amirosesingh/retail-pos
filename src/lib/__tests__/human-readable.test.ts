import { describe, expect, it } from "vitest";
import { branchDisplayName, friendlyReference, humanizeText } from "../human-readable";

const stores = [{ id: "15a19c3f-1805-428b-8606-e82e474f0db3", name: "Guangdong 1" }];

describe("human-readable references", () => {
  it("shows the actual branch name instead of its database identifier", () => {
    expect(branchDisplayName(stores, stores[0].id)).toBe("Guangdong 1");
    expect(humanizeText(`Shift opened at ${stores[0].id}`, { stores })).toBe(
      "Shift opened at Guangdong 1",
    );
    expect(friendlyReference(stores[0].id, { stores })).toBe("Guangdong 1");
  });

  it("uses a safe label when a branch is absent instead of leaking its identifier", () => {
    const missingId = "6aa0e15a-777e-4f01-8ef2-a191c32e818c";
    expect(branchDisplayName(stores, missingId)).toBe("Unknown branch");
    expect(branchDisplayName(stores, missingId, "Unassigned branch")).toBe("Unassigned branch");
  });
});
