import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

function vault(present: boolean, available: boolean, decryptFails = false) {
  const pair = { url: "https://tenant.example.com", key: "publishable-test-key" };
  const module = { exports: {} as { read: (options?: { strict: boolean }) => unknown; status: () => unknown } };
  runInNewContext(readFileSync("electron/cloud-credentials.cjs", "utf8"), {
    module,
    require: (name: string) => {
      if (name === "node:path") return { join: (...parts: string[]) => parts.join("/") };
      if (name === "node:fs") return {
        existsSync: (path: string) => present && path.endsWith(".bin"),
        readFileSync: () => "sealed",
      };
      if (name === "electron") return {
        app: { getPath: () => "/device" },
        safeStorage: {
          isEncryptionAvailable: () => available,
          decryptString: () => { if (decryptFails) throw new Error("DPAPI unavailable"); return JSON.stringify(pair); },
        },
      };
      throw new Error(name);
    },
  });
  return module.exports;
}

describe("Windows cloud vault restoration", () => {
  it("reports missing only when no saved file exists", () => {
    expect(vault(false, false).read({ strict: true })).toBeNull();
  });
  it("preserves an unreadable encrypted file as a restore error", () => {
    expect(() => vault(true, false).read({ strict: true })).toThrow("vault is not ready");
    expect(() => vault(true, true, true).status()).toThrow("DPAPI unavailable");
  });
  it("restores the existing pair when DPAPI is available", () => {
    expect(vault(true, true).read({ strict: true })).toEqual({ url: "https://tenant.example.com", key: "publishable-test-key" });
  });
});
