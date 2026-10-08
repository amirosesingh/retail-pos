import { describe, expect, it } from "vitest";
import { boundedSelectOptions } from "../bounded-select";
describe("large catalogue selectors", () => {
  const options = Array.from({ length: 100000 }, (_, index) => ({
    value: String(index),
    label: `Product ${index}`,
  }));
  it("limits visible options while retaining the full searchable catalogue", () => {
    expect(boundedSelectOptions(options, "").items).toHaveLength(100);
    expect(boundedSelectOptions(options, "").hasMore).toBe(true);
    expect(boundedSelectOptions(options, "product 99999")).toEqual({
      items: [options[99999]],
      hasMore: false,
    });
  });
  it("finds by identifier and returns an empty result safely", () => {
    expect(boundedSelectOptions(options, "99999").items[0].value).toBe("99999");
    expect(boundedSelectOptions(options, "unknown")).toEqual({ items: [], hasMore: false });
  });
});
