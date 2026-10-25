import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
function diagnostics() {
  const files = new Map<string, string>();
  const folder = path.resolve("test-diagnostics");
  const key = (file: string) => path.basename(file);
  const fs = {
    statSync(file: string) { if (!files.has(key(file))) throw new Error("missing"); return { size: files.get(key(file))!.length }; },
    appendFileSync(file: string, value: string) { files.set(key(file), (files.get(key(file)) ?? "") + value); },
    writeFileSync(file: string, value: string) { files.set(key(file), value); },
    readFileSync(file: string) { if (!files.has(key(file))) throw new Error("missing"); return files.get(key(file)); },
    renameSync(from: string, to: string) { files.set(key(to), files.get(key(from))!); files.delete(key(from)); },
    readdirSync() { return []; },
  };
  const module = { exports: {} as { logConnection: (event: string, detail?: object) => void; logServer: (text: string) => void; logCrash: (event: string, detail?: object) => void; databaseErrors: () => Array<{ code: string }>; writeReport: () => unknown } };
  new Function("require", "module", readFileSync("electron/diagnostics.cjs", "utf8"))((name: string) =>
    name === "node:fs" ? fs : name === "electron" ? { app: { getPath: () => folder } } : require(name), module);
  return { files, ...module.exports };
}
afterEach(() => vi.useRealTimers());

it("writes successes and failures to separate rotated files with credential redaction", () => {
  const log = diagnostics();
  log.logConnection("application.started", { state: "starting" });
  log.logConnection("database.state", { state: "enabled_connecting", connected: false });
  log.logConnection("checkout.commit.failed", { category: "database", stage: "sale", code: "PERMISSION_DENIED", message: "password=private pin=123456 https://example.test/private", token: "must-not-appear" });
  log.logServer("Server ready"); log.logServer("ERR Connection failed");
  log.logCrash("window.unresponsive", { window: "main" });
  log.logCrash("window.responsive", { window: "main" });
  expect([...log.files.keys()].sort()).toEqual(["failure.log", "success.log"]);
  expect(log.files.get("success.log")).toContain("enabled_connecting");
  expect(log.files.get("success.log")).not.toContain("checkout.commit.failed");
  expect(log.files.get("failure.log")).toContain("PERMISSION_DENIED");
  expect(log.files.get("failure.log")).not.toMatch(/private|123456|must-not-appear|example\.test/);
  expect(log.files.get("failure.log")).toContain("window.unresponsive");
  log.files.set("success.log", "x".repeat(512 * 1024));
  log.logConnection("database.state", { state: "enabled_ready", connected: true });
  expect(log.files.has("success.log.1")).toBe(true);
});

it("keeps recovery ordering across both files even when events share a millisecond", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-25T00:00:00Z"));
  const log = diagnostics();
  log.logConnection("application.started");
  log.logConnection("synchronization.automatic.failed", { category: "synchronization", stage: "automatic", code: "ESYNC" });
  expect(log.databaseErrors()).toMatchObject([{ code: "ESYNC" }]);
  log.logConnection("synchronization.automatic.succeeded", { category: "synchronization", stage: "automatic" });
  expect(log.databaseErrors()).toEqual([]);
  log.logConnection("checkout.commit.failed", { category: "database", stage: "sale", code: "PERMISSION_DENIED" });
  expect(log.databaseErrors()).toMatchObject([{ code: "PERMISSION_DENIED" }]);
  log.logConnection("application.started");
  expect(log.databaseErrors()).toEqual([]);
});

it("retains legacy evidence and includes both new files in support reports", () => {
  const log = diagnostics();
  const legacy = '2026-10-24T00:00:00.000Z checkout.commit.failed {"category":"database","code":"OLD"}\n';
  log.files.set("connection.log", legacy);
  expect(log.databaseErrors()).toMatchObject([{ code: "OLD" }]);
  log.logConnection("application.started");
  log.logConnection("checkout.commit.failed", { code: "NEW" });
  log.writeReport();
  expect(log.files.get("connection.log")).toBe(legacy);
  expect(log.files.get("diagnostic-report.txt")).toContain("failure.log");
  expect(log.files.get("diagnostic-report.txt")).toContain("success.log");
});
