import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import path from "node:path";

function fixture(module: string) {
  const files = new Map<string, string | Buffer>();
  const vault = { ready: true };
  const fs = {
    existsSync: (file: string) => files.has(file),
    readFileSync: (file: string) => { if (!files.has(file)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(file); },
    writeFileSync: (file: string, value: string | Buffer) => files.set(file, value),
    rmSync: (file: string) => files.delete(file),
  };
  const safeStorage = {
    isEncryptionAvailable: () => vault.ready,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => { if (!vault.ready) throw new Error("vault not ready"); return value.toString(); },
  };
  const box = { exports: {} as Record<string, (...args: unknown[]) => unknown> };
  runInNewContext(readFileSync(`electron/${module}.cjs`, "utf8"), { module: box, exports: box.exports, Buffer, process: { platform: "win32" }, require: (name: string) => name === "electron" ? { app: { getPath: () => "/profile" }, safeStorage } : name === "node:fs" ? fs : path });
  return { store: box.exports, files, vault };
}

describe("Windows connection persistence", () => {
  it("does not mistake a locked or unreadable config for a fresh device or overwrite it", () => {
    const { store, files, vault } = fixture("config-store");
    expect(store.getStrict("backendUrl")).toBeNull();
    expect(store.set("backendUrl", "https://pos.example.com")).toMatchObject({ ok: true, sealed: true });
    const before = [...files.entries()];
    vault.ready = false;
    expect(() => store.getStrict("backendUrl")).toThrow(/vault/);
    expect(store.set("backendUrl", "https://other.example.com")).toMatchObject({ ok: false });
    expect([...files.entries()]).toEqual(before);
    vault.ready = true;
    expect(store.getStrict("backendUrl")).toBe("https://pos.example.com");
    files.set(store.filePath() as string, "broken JSON");
    expect(() => store.getStrict("backendUrl")).toThrow();
    expect(store.merge({ backendUrl: "new" })).toMatchObject({ ok: false });
    expect(files.get(store.filePath() as string)).toBe("broken JSON");
  });
  it("never writes plaintext Windows connection data when the vault is unavailable", () => {
    for (const name of ["config-store", "cloud-credentials"]) {
      const { store, files, vault } = fixture(name);
      vault.ready = false;
      const result = name === "config-store" ? store.writeAll({ backendUrl: "https://pos.example.com" }) : store.write({ url: "https://tenant.example.com", key: "publishable-test-key" });
      expect(result).toMatchObject({ ok: false });
      expect(files.size).toBe(0);
    }
  });
});
