import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const yaml = require("js-yaml");
const { verifyPlatformRelease, publishAndroidArchive } = require("../../../scripts/verify-platform-release.cjs");
const commit = "abcdef0" + "1".repeat(33), version = "1.4.74", rid = `v${version}-abcdef0`;
let root: string, windows: string, android: string;
const json = (dir: string, name: string, value: unknown) => writeFileSync(join(dir, name), JSON.stringify(value));
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pos-paired-release-"));
  windows = join(root, "windows"); android = join(root, "android"); mkdirSync(windows); mkdirSync(android);
  const exe = Buffer.from("signed installer fixture"), name = `Retail Setup ${version}.exe`;
  const sha512 = createHash("sha512").update(exe).digest("base64");
  writeFileSync(join(windows, name), exe); writeFileSync(join(windows, name + ".blockmap"), "map");
  writeFileSync(join(windows, "latest.yml"), yaml.dump({ version, path: name, sha512, files: [{ url: name, sha512, size: exe.length }] }));
  json(windows, "release.json", { version, tag: `v${version}`, commit, path: `pos-app/releases/${rid}/` });
  json(android, "latest.json", { version, tag: `v${version}`, commit, path: `pos-app/releases/${rid}/android/`, file: `Retail-${version}.apk` });
  writeFileSync(join(android, `Retail-${version}.apk`), Buffer.from([0x50, 0x4b, 0x03, 0x04, 1]));
  const manifest = { version, buildNumber: 100, bundleEpoch: 7,
    apkUrl: `https://updatecms.luckycharmsdnbhd.com/pos-app/releases/${rid}/android/Retail-${version}.apk`,
    windowsUrl: `https://updatecms.luckycharmsdnbhd.com/pos-app/latest/Retail%20Setup%20${version}.exe` };
  for (const dir of [windows, android]) json(dir, "manifest.json", manifest);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
it("requires all three independent stable builds before the serialized publishing job", () => {
  const workflow = yaml.load(readFileSync(".github/workflows/platform-release.yml", "utf8"));
  expect(workflow.jobs.windows.needs).toBeUndefined(); expect(workflow.jobs.android.needs).toBeUndefined();
  expect(workflow.jobs.ios.needs).toBeUndefined();
  expect(workflow.jobs.ios.with.release_channel).toBe("stable");
  expect(workflow.jobs.publish.needs).toEqual(["windows", "android", "ios"]);
  expect(workflow.jobs.publish.if).toBeUndefined();
  expect(workflow.jobs.publish.concurrency.group).toBe("pos-release-publish");
  for (const platform of ["desktop-release", "android-apk"]) {
    const build = yaml.load(readFileSync(`.github/workflows/${platform}.yml`, "utf8"));
    expect(build.on.workflow_call.inputs.build_only.default).toBe(true);
    expect(build.on.push).toBeUndefined();
    const steps = Object.values(build.jobs)[0] as { steps: { name?: string; if?: string }[] };
    expect(steps.steps.find(s => s.name === "Deploy to Cloudflare R2")?.if).toContain("!inputs.build_only");
  }
});
it("accepts verified matching packages and rejects mismatched commits or manifests", () => {
  expect(verifyPlatformRelease(windows, android, { version, commit })).toEqual({ version, releaseId: rid });
  const file = join(android, "latest.json"), metadata = JSON.parse(readFileSync(file, "utf8"));
  json(android, "latest.json", { ...metadata, commit: "2".repeat(40) });
  expect(() => verifyPlatformRelease(windows, android, { version, commit })).toThrow("same release");
  json(android, "latest.json", metadata);
  const manifest = JSON.parse(readFileSync(join(android, "manifest.json"), "utf8"));
  json(android, "manifest.json", { ...manifest, buildNumber: 101 });
  expect(() => verifyPlatformRelease(windows, android, { version, commit })).toThrow("identities differ");
});
it("rejects corrupted installers before any publishing can start", () => {
  writeFileSync(join(windows, `Retail Setup ${version}.exe`), "damaged");
  expect(() => verifyPlatformRelease(windows, android, { version, commit })).toThrow("SHA-512");
});
it("uploads and verifies the Android archive without changing an update pointer", async () => {
  const bytes = readFileSync(join(android, `Retail-${version}.apk`)), upload = vi.fn();
  const remote = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(bytes).mockResolvedValueOnce(Buffer.from([0x50]));
  await publishAndroidArchive(android, { remote, upload });
  expect(upload).toHaveBeenCalledWith(join(android, `Retail-${version}.apk`), `releases/${rid}/android/Retail-${version}.apk`, true);
  expect(upload).toHaveBeenCalledOnce();
});
it("refuses to replace different historical Android bytes", async () => {
  const upload = vi.fn();
  await expect(publishAndroidArchive(android, { remote: async () => Buffer.from("old bytes"), upload })).rejects.toThrow("historical");
  expect(upload).not.toHaveBeenCalled();
});
