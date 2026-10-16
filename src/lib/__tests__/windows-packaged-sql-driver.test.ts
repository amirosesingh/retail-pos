import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const asar = require("@electron/asar") as {
  createPackage: (source: string, archive: string) => Promise<void>;
  extractFile: (archive: string, filename: string) => Buffer;
};
const { packagedSqlDriverFailures } = require("../../../scripts/windows-sql-driver-policy.cjs") as {
  packagedSqlDriverFailures: (reader: typeof asar, archive: string, selected: string) => string[];
};
const temporaryDirectories: string[] = [];

async function archiveFixture(version?: string) {
  const directory = mkdtempSync(path.join(tmpdir(), "pos-packaged-sql-"));
  temporaryDirectories.push(directory);
  const source = path.join(directory, "app");
  mkdirSync(source);
  writeFileSync(path.join(source, "package.json"), JSON.stringify({ name: "fixture" }));
  if (version) {
    const driver = path.join(source, "node_modules", "mssql");
    mkdirSync(driver, { recursive: true });
    writeFileSync(path.join(driver, "package.json"), JSON.stringify({ name: "mssql", version }));
  }
  const archive = path.join(directory, "app.asar");
  await asar.createPackage(source, archive);
  return archive;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("packaged SQL driver ASAR lookup", () => {
  it("reads the existing driver using the platform's native separators", async () => {
    const archive = await archiveFixture("12.7.4");
    if (process.platform === "win32") {
      expect(() => asar.extractFile(archive, "node_modules/mssql/package.json")).toThrow(
        "was not found",
      );
    }
    expect(packagedSqlDriverFailures(asar, archive, "12.7.4")).toEqual([]);
  });

  it("still rejects a packaged driver that differs from the selected version", async () => {
    const archive = await archiveFixture("12.7.2");
    expect(packagedSqlDriverFailures(asar, archive, "12.7.4")).toEqual([
      "packaged SQL Server driver version differs from the selected version",
    ]);
  });

  it("still fails when the driver is genuinely missing from the archive", async () => {
    const archive = await archiveFixture();
    expect(() => packagedSqlDriverFailures(asar, archive, "12.7.4")).toThrow("was not found");
  });
});
