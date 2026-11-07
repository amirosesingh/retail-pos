import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { packageRecoveryMetadata, FORMAT, IDS } = require("../../../scripts/package-recovery-metadata.cjs");
const { digest } = require("../../../scripts/lib/existing-local-upgrade.cjs");
const source = JSON.parse(readFileSync("database/sqlserver/prepared/existing-upgrade-1.4.82.manifest.json", "utf8"));

describe("recovery-only packaged metadata contract", () => {
  it("reproduces all exact packaged bytes and keeps the manual upgrade unchanged", () => {
    const built = packageRecoveryMetadata();
    expect(readFileSync("database/sqlserver/recovery/shift-recovery-metadata.sql", "utf8")).toBe(built.installer);
    expect(readFileSync("database/sqlserver/recovery/shift-recovery-metadata-probe.sql", "utf8")).toBe(built.probe);
    expect(JSON.parse(readFileSync("database/sqlserver/recovery/shift-recovery-metadata.manifest.json", "utf8"))).toEqual(built.manifest);
    const manual = readFileSync("database/sqlserver/retail-pos-existing-upgrade-1.4.82.sql");
    expect(manual.length).toBe(559560); expect(digest(manual)).toBe(built.manifest.manualUpgrade.sha256);
  });
  it("ships only three reviewed recovery modules and four initially empty tables", () => {
    const { manifest, modules } = packageRecoveryMetadata();
    expect(manifest.format).toBe(FORMAT); expect(manifest.coreSchemaVersion).toBe(24);
    expect(modules.map((module: { id: string }) => module.id)).toEqual(IDS);
    expect(manifest.modules.flatMap((module: { tables: string[] }) => module.tables)).toEqual([
      "pos_shift_recovery_evidence", "pos_sync_shift_legacy_recoveries", "pos_sync_shift_legacy_recovery_receipts", "pos_shift_recovery_adoptions",
    ]);
    expect(modules.every((module: { id: string }) => !/^(025|026|027|031)_/.test(module.id))).toBe(true);
  });
  it("pins both bounded UTF8 files and each known whole-module prefix", () => {
    const { installer, probe, manifest } = packageRecoveryMetadata();
    expect(Buffer.byteLength(installer)).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(Buffer.byteLength(probe)).toBeLessThanOrEqual(1024 * 1024);
    expect(manifest.installer.sha256).toBe(digest(installer)); expect(manifest.probe.sha256).toBe(digest(probe));
    expect(manifest.prefixes.map((row: { prefix: number; state: string }) => [row.prefix, row.state])).toEqual([[0, "absent"], [1, "prefix"], [2, "prefix"], [3, "matching"]]);
    expect(new Set(manifest.prefixes.map((row: { schemaFingerprint: string }) => row.schemaFingerprint)).size).toBe(4);
    expect(installer).toContain("@expectedDatabaseGuid"); expect(installer).toContain("@expectedSchemaFingerprint");
    expect(installer).toContain("@LockTimeout=3000");
    const executable = installer.split("\n").filter((line: string) => line.trim() && !line.trimStart().startsWith("--")).join("\n");
    expect(executable).toMatch(/^IF @@TRANCOUNT<>0 BEGIN RAISERROR/);
    const attributes = readFileSync(".gitattributes", "utf8");
    for (const file of [manifest.installer.file, manifest.probe.file, "shift-recovery-metadata.manifest.json"]) {
      expect(attributes.split(/\r?\n/)).toContain(`/database/sqlserver/recovery/${file} text eol=lf`);
      expect(readFileSync(`database/sqlserver/recovery/${file}`, "utf8")).not.toContain("\r");
    }
  });
  it.each(["core", "module", "set"])("refuses changed reviewed %s evidence", kind => {
    const changed = structuredClone(source);
    if (kind === "core") changed.coreSources.schema = "0".repeat(64);
    if (kind === "module") changed.modules.find((module: { id: string }) => module.id === IDS[0]).sourceHash = "0".repeat(64);
    if (kind === "set") changed.modules = changed.modules.filter((module: { id: string }) => module.id !== IDS[1]);
    expect(() => packageRecoveryMetadata(changed)).toThrow();
  });
});
