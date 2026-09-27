import { describe, expect, it } from "vitest";
import type { Store } from "@/core/types/pos-types";
import { canonicalLocations, descendants, locationTree } from "@/lib/locations";

const store = (id: string, parentId?: string): Store => ({
  id,
  code: id.toUpperCase(),
  name: id,
  address: "",
  phone: "",
  active: true,
  parentId,
});

describe("location lifecycle", () => {
  it("keeps one current row per location id", () => {
    const rows = canonicalLocations([
      { ...store("branch"), name: "Old name" },
      { ...store("branch"), name: "Current name" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Current name");
  });

  it("renders corrupt parent cycles once instead of recursing forever", () => {
    const rows = [store("a", "b"), store("b", "a")];
    expect(locationTree(rows).map(({ store: row }) => row.id)).toEqual(["a", "b"]);
    expect(descendants(rows, "a").map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("never restores an archived location to the active tree", () => {
    expect(locationTree([{ ...store("old"), active: false }, store("live")])).toMatchObject([
      { store: { id: "live" }, depth: 0 },
    ]);
  });
});
