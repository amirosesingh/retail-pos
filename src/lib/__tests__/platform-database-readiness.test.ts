import { createRequire } from "node:module";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { inspectLocalSupport } = require("../../../electron/db/health.cjs");

it("detects missing SQL support tables even when business tables are present", () => {
  const empty = inspectLocalSupport(new Map());
  expect(empty.details.map((item: { table: string }) => item.table)).toContain(
    "local_operation_receipts",
  );
  expect(empty.details.map((item: { table: string }) => item.table)).toContain(
    "pos_document_counters",
  );
  const complete = new Map<string, Map<string, unknown>>(
    empty.details.map((item: { table: string; missingColumns: string[] }) => [
      item.table,
      new Map(item.missingColumns.map((name) => [name, {}])),
    ]),
  );
  expect(inspectLocalSupport(complete).differences).toEqual([]);
  complete.get("sync_change_journal")!.delete("aggregate_id");
  expect(inspectLocalSupport(complete).differences).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        table: "sync_change_journal",
        object: "aggregate_id",
        issue: "missing",
      }),
    ]),
  );
});

it("removes stale generated Android push configuration while preserving unrelated services", () => {
  const root = mkdtempSync(join(tmpdir(), "pos-android-push-"));
  try {
    mkdirSync(join(root, "scripts"));
    copyFileSync(
      resolve("scripts/android-push-setup.cjs"),
      join(root, "scripts/android-push-setup.cjs"),
    );
    const main = join(root, "android/app/src/main");
    const java = join(main, "java/com/luckycharms/pos");
    mkdirSync(java, { recursive: true });
    const config = join(root, "android/app/google-services.json");
    const service = join(java, "PosFirebaseMessagingService.java");
    writeFileSync(config, "{}");
    writeFileSync(service, "generated");
    const manifest = join(main, "AndroidManifest.xml");
    writeFileSync(
      manifest,
      `<application><service android:name="OtherService" />
      <service android:name="com.capacitorjs.plugins.pushnotifications.MessagingService" tools:node="remove" />
      <service android:name="com.luckycharms.pos.PosFirebaseMessagingService" android:exported="false"><intent-filter /></service></application>`,
    );
    const env: NodeJS.ProcessEnv = { ...process.env, VITE_ANDROID_PUSH_ENABLED: "false" };
    delete env.ANDROID_GOOGLE_SERVICES_JSON;
    delete env.POS_ANDROID_FIREBASE_CONFIG;
    const result = spawnSync(process.execPath, [join(root, "scripts/android-push-setup.cjs")], {
      env,
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(config)).toBe(false);
    expect(existsSync(service)).toBe(false);
    expect(readFileSync(manifest, "utf8")).toContain("OtherService");
    expect(readFileSync(manifest, "utf8")).not.toContain("MessagingService");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
