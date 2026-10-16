/**
 * The desktop shell must never keep a terminal's identity in clear text.
 *
 * These run the real `electron/terminal-store.cjs` against a stubbed Electron
 * module, so the two states it is allowed to be in — sealed, or refused — are
 * checked rather than described.
 */
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require_ = createRequire(import.meta.url);
const storePath = require_.resolve("../../../../electron/terminal-store.cjs");
const electronPath = require_.resolve("electron");

let dir = "";
let sealAvailable = true;

function loadStore() {
  delete require_.cache[storePath];
  require_.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      app: { getPath: () => dir },
      safeStorage: {
        isEncryptionAvailable: () => sealAvailable,
        // Stand-in for DPAPI: reversible, but not readable as JSON on disk.
        encryptString: (s: string) => Buffer.from(s, "utf8").toString("base64"),
        decryptString: (b: Buffer) => Buffer.from(b.toString(), "base64").toString("utf8"),
      },
    },
  } as never;
  return require_(storePath) as {
    read: () => { tokenId?: string } | null;
    wasProvisioned: () => boolean;
    write: (c: unknown) => { ok: boolean; error?: string };
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pos-terminal-"));
  sealAvailable = true;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete require_.cache[electronPath];
});

describe("desktop activation store", () => {
  it("keeps provisioning complete after revocation and a module reload", () => {
    const store = loadStore();
    expect(store.wasProvisioned()).toBe(false);
    expect(store.write(null).ok).toBe(true);
    expect(store.wasProvisioned()).toBe(false);
    expect(store.write({ tokenId: "t-1" }).ok).toBe(true);
    expect(store.write(null).ok).toBe(true);
    expect(loadStore().wasProvisioned()).toBe(true);
    expect(loadStore().read()).toBeNull();
  });

  it("migrates provisioning state before removing an older activation", () => {
    writeFileSync(join(dir, "terminal-config.bin"), "old activation");
    const store = loadStore();
    expect(store.wasProvisioned()).toBe(true);
    expect(store.write(null).ok).toBe(true);
    expect(store.wasProvisioned()).toBe(true);
  });

  it("seals the activation and leaves no readable copy", () => {
    const store = loadStore();
    expect(store.write({ tokenId: "t-1", locationId: "b-1" }).ok).toBe(true);
    expect(existsSync(join(dir, "terminal-config.json"))).toBe(false);
    const raw = readFileSync(join(dir, "terminal-config.bin"), "utf8");
    expect(raw).not.toContain("t-1");
    expect(store.read()?.tokenId).toBe("t-1");
  });

  it("refuses to store the activation when the machine's vault is unavailable", () => {
    sealAvailable = false;
    const store = loadStore();
    const result = store.write({ tokenId: "t-2" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/secure store is unavailable/i);
    expect(existsSync(join(dir, "terminal-config.json"))).toBe(false);
  });

  it("migrates an older plain activation into the vault and deletes the plain file", () => {
    writeFileSync(join(dir, "terminal-config.json"), JSON.stringify({ tokenId: "t-3" }), "utf8");
    const store = loadStore();
    expect(store.read()?.tokenId).toBe("t-3");
    expect(existsSync(join(dir, "terminal-config.json"))).toBe(false);
    expect(existsSync(join(dir, "terminal-config.bin"))).toBe(true);
  });
});
