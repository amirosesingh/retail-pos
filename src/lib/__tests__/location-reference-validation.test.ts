import { describe, expect, it } from "vitest";
import { validateLocationReferences } from "@/lib/location-reference-validation";

describe("location reference validation", () => {
  const locations = [{ id: "branch-a" }, { id: "warehouse-a" }];
  const groups = [{ id: "group-a" }];

  it("accepts current group and parent references", () => {
    expect(
      validateLocationReferences(
        { id: "branch-a", groupId: "group-a", parentId: "warehouse-a" },
        locations,
        groups,
      ),
    ).toBeNull();
  });

  it("rejects a group retained from a stale device cache", () => {
    expect(validateLocationReferences({ groupId: "deleted-group" }, locations, groups)).toContain(
      "group no longer exists",
    );
  });

  it("rejects missing and self-referencing parents", () => {
    expect(
      validateLocationReferences({ id: "branch-a", parentId: "missing" }, locations, groups),
    ).toContain("parent location no longer exists");
    expect(
      validateLocationReferences({ id: "branch-a", parentId: "branch-a" }, locations, groups),
    ).toContain("own parent");
    expect(
      validateLocationReferences({ id: " branch-a ", parentId: "branch-a" }, locations, groups),
    ).toContain("own parent");
  });
});
