import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { staleKeys, shellUpgraded } from "@/platforms/mobile/device-cleanup";

const require = createRequire(import.meta.url);
const hygiene = require(path.resolve(process.cwd(), "electron/storage-hygiene.cjs"));

describe("Windows till storage hygiene", () => {
  it("never treats identity or configuration as cache", () => {
    for (const name of [
      "pos_config.json",
      "terminal-config.bin",
      "local-db-config.bin",
      "cloud-credentials.bin",
    ]) {
      expect(hygiene.isRequiredEntry(name)).toBe(true);
      expect(hygiene.isDisposableCacheDir(name)).toBe(false);
    }
  });

  it("does not preserve retired local database files", () => {
    for (const name of ["pos-local.db", "pos-local.db-wal", "pos-local.db-shm"]) {
      expect(hygiene.isRequiredEntry(name)).toBe(false);
    }
  });

  it("classes Chromium scratch folders as disposable", () => {
    for (const name of ["Cache", "Code Cache", "GPUCache", "Crashpad"]) {
      expect(hygiene.isDisposableCacheDir(name)).toBe(true);
    }
  });

  it("clears caches but keeps required files, and only bumps on a new version", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-userdata-"));
    fs.mkdirSync(path.join(dir, "Cache"));
    fs.writeFileSync(path.join(dir, "Cache", "data_1"), "x");
    fs.writeFileSync(path.join(dir, "pos_config.json"), "{}");
    fs.writeFileSync(path.join(dir, "terminal-config.bin"), "sealed");

    const first = hygiene.runOnLaunch(dir, "1.0.0");
    expect(first.upgraded).toBe(true); // fresh install
    expect(fs.existsSync(path.join(dir, "Cache", "data_1"))).toBe(false);
    expect(fs.readFileSync(path.join(dir, "terminal-config.bin"), "utf8")).toBe("sealed");
    expect(fs.existsSync(path.join(dir, "pos_config.json"))).toBe(true);

    expect(hygiene.runOnLaunch(dir, "1.0.0").upgraded).toBe(false);
    expect(hygiene.runOnLaunch(dir, "1.0.1").upgraded).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reports disposable, diagnostic and retained bytes without reading values", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-userdata-"));
    fs.mkdirSync(path.join(dir, "Cache"));
    fs.writeFileSync(path.join(dir, "Cache", "data"), "cache");
    fs.writeFileSync(path.join(dir, "connection.log"), "diagnostic");
    fs.writeFileSync(path.join(dir, "terminal-config.bin"), "sealed");

    expect(hygiene.usage(dir)).toEqual({
      totalBytes: 21,
      cacheBytes: 5,
      diagnosticBytes: 10,
      retainedBytes: 6,
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("exposes a real Electron cache clear and byte report to Settings", () => {
    const main = fs.readFileSync(path.resolve(process.cwd(), "electron/main.cjs"), "utf8");
    const preload = fs.readFileSync(path.resolve(process.cwd(), "electron/preload.cjs"), "utf8");
    const panel = fs.readFileSync(
      path.resolve(process.cwd(), "src/platforms/web/components/pos/settings/panels/SystemStatusPanel.tsx"),
      "utf8",
    );
    expect(main).toContain('ipcMain.handle("cache:status"');
    expect(main).toContain("session.defaultSession.clearCache()");
    expect(main).toContain("session.defaultSession.clearStorageData");
    expect(preload).toContain('clearAppCache: () => invoke("cache:clear")');
    expect(panel).toContain("disposable cache");
    expect(panel).toContain("Clear app cache & reload");
  });
});

describe("phone storage hygiene", () => {
  const keys = [
    "pos.terminal.config",
    "pos.terminal.token",
    "pos.secure.cloud",
    "pos.theme",
    "pos.color-theme",
    "pos.accent-color",
    "pos.cart.draft.1",
    "pos.ui.webBundle",
    "pos.report.cache",
    "pos.shell.version",
  ];

  it("keeps identity, configuration, preferences and the open ticket", () => {
    const removed = staleKeys(keys, true);
    expect(removed).not.toContain("pos.terminal.config");
    expect(removed).not.toContain("pos.terminal.token");
    expect(removed).not.toContain("pos.secure.cloud");
    expect(removed).not.toContain("pos.theme");
    expect(removed).not.toContain("pos.color-theme");
    expect(removed).not.toContain("pos.accent-color");
    expect(removed).not.toContain("pos.cart.draft.1");
    expect(removed).not.toContain("pos.shell.version");
    expect(removed).not.toContain("pos.ui.webBundle");
  });

  it("drops derived caches on an upgrade", () => {
    expect(staleKeys(keys, true)).toContain("pos.report.cache");
    // The updater owns this pointer and clears it only after directory removal.
    expect(staleKeys(keys, true)).not.toContain("pos.ui.webBundle");
  });

  it("detects the first launch after a version change", () => {
    expect(shellUpgraded(null, "1.4.0")).toBe(true);
    expect(shellUpgraded("1.3.9", "1.4.0")).toBe(true);
    expect(shellUpgraded("1.4.0", "1.4.0")).toBe(false);
  });
});

describe("device lifecycle preserves business data", () => {
  it("the Windows installer preserves application data for recovery", () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"));
    expect(pkg.build.nsis.deleteAppDataOnUninstall).toBe(false);
  });

  it("the Android manifest patcher disables Auto Backup", () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "scripts/android-permissions.cjs"),
      "utf8",
    );
    expect(src).toContain('"allowBackup", "false"');
    expect(src).toContain('"fullBackupContent", "false"');
    expect(src).toContain("data_extraction_rules");
  });
});
