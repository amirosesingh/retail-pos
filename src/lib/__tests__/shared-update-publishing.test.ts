import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { promoteSharedManifest } = require("../../../scripts/publish-update-manifest.cjs");
const base = "https://updatecms.luckycharmsdnbhd.com/pos-app/";
const manifest = { version: "1.4.72", apkUrl: `${base}releases/v1.4.72-abcdef0/android/Retail-1.4.72.apk`, windowsUrl: `${base}latest/Retail%20Setup%201.4.72.exe` };
let directory: string;
let file: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "pos-shared-test-")); file = join(directory, "manifest.json"); writeFileSync(file, JSON.stringify(manifest)); });
afterEach(() => { unlinkSync(file); rmdirSync(directory); });
describe("verified cross-platform update publication", () => {
  it.each(["apkUrl", "windowsUrl"] as const)("keeps the old manifest when %s is missing", async (field) => {
    const upload = vi.fn();
    const remote = vi.fn(async (url: string) => url === manifest[field] ? null : Buffer.from("x"));
    expect(await promoteSharedManifest(file, { remote, upload, log: vi.fn() })).toBe(false);
    expect(upload).not.toHaveBeenCalled();
  });
  it("publishes both shared pointers only after both files are verified", async () => {
    const upload = vi.fn();
    const remote = vi.fn(async (url: string) => url.endsWith("manifest.json") ? null : Buffer.from("x"));
    expect(await promoteSharedManifest(file, { remote, upload, log: vi.fn() })).toBe(true);
    expect(remote.mock.calls.slice(0, 2).map(([url]) => url)).toEqual([manifest.apkUrl, manifest.windowsUrl]);
    expect(upload.mock.calls).toEqual([[file, "manifest.json", false], [file, "latest/manifest.json", false]]);
  });
  it("does not replace a newer completed release", async () => {
    const upload = vi.fn();
    const remote = vi.fn(async (url: string) => Buffer.from(url.endsWith("manifest.json") ? JSON.stringify({ version: "1.4.73" }) : "x"));
    expect(await promoteSharedManifest(file, { remote, upload, log: vi.fn() })).toBe(false);
    expect(upload).not.toHaveBeenCalled();
  });
  it("does not interpret a verification failure as a valid artifact", async () => {
    const upload = vi.fn();
    await expect(promoteSharedManifest(file, { remote: async () => { throw new Error("HTTP 403"); }, upload })).rejects.toThrow("HTTP 403");
    expect(upload).not.toHaveBeenCalled();
  });
  it("rejects an unrelated download origin", async () => {
    writeFileSync(file, JSON.stringify({ ...manifest, apkUrl: "https://other.invalid/Retail-1.4.72.apk" }));
    await expect(promoteSharedManifest(file, { remote: vi.fn(), upload: vi.fn() })).rejects.toThrow("Invalid apkUrl");
  });
});
