import { describe, expect, it } from "vitest";
import { confirmedPresentation } from "../use-confirmed-presentation";

describe("confirmed summary presentation", () => {
  it("keeps unknown or failed first reads hidden, including positive seeds", () => {
    expect(confirmedPresentation(null, "branch-A", [123], false)).toBeNull();
    expect(confirmedPresentation(null, null, [123], true)).toBeNull();
  });
  it("keeps the previous confirmed values through background loading/error rather than showing temporary zeros", () => {
    const previous = confirmedPresentation(null, "A|period|user|permissions", [42, -3], true);
    expect(confirmedPresentation(previous, "A|period|user|permissions", [0, 0], false)).toBe(previous);
  });
  it("reveals resolved nonzero changes and keeps meaningful losses without making any request", () => {
    const empty = confirmedPresentation(null, "A", [], true);
    const changed = confirmedPresentation(empty, "A", [5, -10], true);
    expect(changed?.value).toEqual([5, -10]);
    expect(empty?.value).toEqual([]);
  });
  it("drops a retained view when branch, filter, date, user or permissions change", () => {
    const previous = confirmedPresentation(null, "original", [9], true);
    for (const key of ["other-branch", "other-cluster", "other-period", "other-user", "revoked-permissions", "other-timezone", "other-sponsorship-policy"])
      expect(confirmedPresentation(previous, key, [0], false)).toBeNull();
  });
});
