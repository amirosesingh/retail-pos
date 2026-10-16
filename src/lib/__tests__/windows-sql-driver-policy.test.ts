import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { sqlDriverFailures } = require("../../../scripts/windows-sql-driver-policy.cjs") as {
  sqlDriverFailures: (manifest: unknown, lock: unknown, installed: unknown) => string[];
};
const fixture = (version: string) => ({
  manifest: { dependencies: { mssql: version } },
  lock: {
    packages: {
      "": { dependencies: { mssql: version } },
      "node_modules/mssql": { version },
    },
  },
});

describe("Windows SQL Server driver consistency", () => {
  it.each(["12.7.2", "12.7.4", "12.7.5"])("accepts the selected exact driver %s", (version) => {
    const { manifest, lock } = fixture(version);
    expect(sqlDriverFailures(manifest, lock, version)).toEqual([]);
  });
  it.each(["^12.7.4", "~12.7.4", "latest", "12.x", ""])(
    "rejects an unpinned driver %s",
    (version) => {
      const { manifest, lock } = fixture(version);
      expect(sqlDriverFailures(manifest, lock, version)).toContain(
        "mssql must be pinned to an exact version",
      );
    },
  );
  it("rejects an old resolved lockfile despite an updated manifest", () => {
    const { manifest, lock } = fixture("12.7.4");
    lock.packages["node_modules/mssql"].version = "12.7.2";
    expect(sqlDriverFailures(manifest, lock, "12.7.4").join()).toContain("lockfile must match");
  });
  it("rejects old root lock metadata", () => {
    const { manifest, lock } = fixture("12.7.4");
    lock.packages[""].dependencies.mssql = "12.7.2";
    expect(sqlDriverFailures(manifest, lock, "12.7.4").join()).toContain("lockfile must match");
  });
  it("rejects an older installed driver even when the lockfile is current", () => {
    const { manifest, lock } = fixture("12.7.4");
    expect(sqlDriverFailures(manifest, lock, "12.7.2").join()).toContain(
      "installed mssql must match",
    );
  });
  it("rejects a missing lock entry", () => {
    const { manifest } = fixture("12.7.4");
    expect(sqlDriverFailures(manifest, {}, "12.7.4").join()).toContain("lockfile must match");
  });
});
