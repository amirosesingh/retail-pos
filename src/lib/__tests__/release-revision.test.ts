import { describe, expect, it } from "vitest";
import { displayReleaseVersion } from "../release-version";
import { compareVersions } from "../update-manifest";
import { newer } from "@/platforms/ios/manifest";

describe("stable revision identity", () => {
  it("displays the requested label without changing the machine identity", () => {
    expect(displayReleaseVersion("1.4.77+revision.1")).toBe("1.4.77 (1)");
    expect(displayReleaseVersion("1.4.78-beta.1")).toBe("1.4.78-beta.1");
  });
  it("orders revisions numerically and preserves stable/prerelease precedence", () => {
    for (const [a, b] of [
      ["1.4.77+revision.1", "1.4.77"],
      ["1.4.77+revision.10", "1.4.77+revision.2"],
      ["1.4.78", "1.4.77+revision.10"],
      ["1.4.77", "1.4.77-beta.9"],
    ]) {
      expect(compareVersions(a, b)).toBe(1);
      expect(compareVersions(b, a)).toBe(-1);
      expect(newer(a, b)).toBe(true);
      expect(newer(b, a)).toBe(false);
    }
    expect(compareVersions("1.4.77+other.1", "1.4.77")).toBe(0);
    expect(newer("1.4.77+revision.1", "1.4.77+revision.1")).toBe(false);
  });
});
