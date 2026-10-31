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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require_ = createRequire(import.meta.url);
const storePath = require_.resolve("../../../../electron/terminal-store.cjs");
const electronPath = require_.resolve("electron");

let dir = "";
let sealAvailable = true;
let decryptFailure = false;

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
        decryptString: (b: Buffer) => {
          if (decryptFailure) throw new Error("DPAPI temporarily unavailable");
          return Buffer.from(b.toString(), "base64").toString("utf8");
        },
      },
    },
  } as never;
  return require_(storePath) as {
    read: (options?: { strict?: boolean }) => { tokenId?: string } | null;
    wasProvisioned: () => boolean;
    write: (c: unknown) => { ok: boolean; error?: string };
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pos-terminal-"));
  sealAvailable = true;
  decryptFailure = false;
});

afterEach(() => {
  vi.restoreAllMocks();
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
    writeFileSync(join(dir, "terminal-config.bin"), Buffer.from(JSON.stringify({ tokenId: "old-activation" })).toString("base64"));
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

  it("returns an absent registration only when neither saved activation exists", () => {
    expect(loadStore().read({ strict: true })).toBeNull();
    expect(existsSync(join(dir, "terminal-provisioned"))).toBe(false);
  });

  it.each(["vault", "decrypt", "json", "identity"])("keeps a saved %s failure distinct from absence and retryable", (failure) => {
    const store = loadStore();
    expect(store.write({ tokenId: "t-1", locationId: "branch-a" }).ok).toBe(true);
    const sealedPath = join(dir, "terminal-config.bin");
    const saved = readFileSync(sealedPath);
    if (failure === "vault") sealAvailable = false;
    if (failure === "decrypt") decryptFailure = true;
    if (failure === "json") writeFileSync(sealedPath, Buffer.from("broken JSON").toString("base64"));
    if (failure === "identity") writeFileSync(sealedPath, Buffer.from(JSON.stringify({ locationId: "branch-a" })).toString("base64"));
    const unreadable = readFileSync(sealedPath);

    expect(() => store.read({ strict: true })).toThrow(/saved terminal registration|Windows.*vault/i);
    // Existing background callers can pause without throwing from Main startup.
    expect(store.read()).toBeNull();
    expect(readFileSync(sealedPath)).toEqual(unreadable);
    expect(store.wasProvisioned()).toBe(true);

    sealAvailable = true;
    decryptFailure = false;
    if (failure === "json" || failure === "identity") writeFileSync(sealedPath, saved);
    expect(store.read({ strict: true })).toMatchObject({ tokenId: "t-1", locationId: "branch-a" });
  });

  it("never replaces unreadable sealed registration with an editable legacy activation", () => {
    const store = loadStore();
    store.write({ tokenId: "t-1", locationId: "branch-a" });
    const sealedPath = join(dir, "terminal-config.bin");
    const saved = readFileSync(sealedPath);
    const legacyPath = join(dir, "terminal-config.json");
    const legacy = JSON.stringify({ tokenId: "different-terminal", locationId: "branch-b" });
    writeFileSync(legacyPath, legacy);
    decryptFailure = true;

    expect(() => store.read({ strict: true })).toThrow();
    expect(store.read()).toBeNull();
    expect(readFileSync(sealedPath)).toEqual(saved);
    expect(readFileSync(legacyPath, "utf8")).toBe(legacy);

    decryptFailure = false;
    expect(store.read({ strict: true })).toMatchObject({ tokenId: "t-1", locationId: "branch-a" });
  });

  it.each(["vault", "decrypt", "json", "identity"])("refuses replacement and clearing after a %s failure without changing origin bytes", (failure) => {
    const store = loadStore();
    store.write({ tokenId: "t-1", locationId: "branch-a" });
    if (failure === "vault") sealAvailable = false;
    if (failure === "decrypt") decryptFailure = true;
    if (failure === "json") writeFileSync(join(dir, "terminal-config.bin"), Buffer.from("broken JSON").toString("base64"));
    if (failure === "identity") writeFileSync(join(dir, "terminal-config.bin"), Buffer.from(JSON.stringify({ locationId: "branch-a" })).toString("base64"));
    const names = ["terminal-config.bin", "terminal-last-binding.bin", "terminal-provisioned"];
    const before = names.map(name => readFileSync(join(dir, name)));

    expect(store.write({ tokenId: "t-2", locationId: "branch-b" }).ok).toBe(false);
    expect(store.write(null).ok).toBe(false);
    expect(names.map(name => readFileSync(join(dir, name)))).toEqual(before);
  });

  it("keeps a legacy activation inert and retryable when the vault is unavailable", () => {
    const legacyPath = join(dir, "terminal-config.json");
    const legacy = JSON.stringify({ tokenId: "t-3" });
    writeFileSync(legacyPath, legacy);
    sealAvailable = false;
    const store = loadStore();

    expect(() => store.read({ strict: true })).toThrow();
    expect(store.read()).toBeNull();
    expect(store.write({ tokenId: "replacement" }).ok).toBe(false);
    expect(store.write(null).ok).toBe(false);
    expect(readFileSync(legacyPath, "utf8")).toBe(legacy);
    expect(existsSync(join(dir, "terminal-config.bin"))).toBe(false);
    expect(existsSync(join(dir, "terminal-last-binding.bin"))).toBe(false);
    expect(existsSync(join(dir, "terminal-provisioned"))).toBe(false);

    sealAvailable = true;
    expect(store.read({ strict: true })?.tokenId).toBe("t-3");
    expect(existsSync(legacyPath)).toBe(false);
  });

  it.each(["broken JSON", JSON.stringify({ locationId: "branch-a" })])("preserves malformed legacy bytes on strict restore, replacement and clear refusal", (legacy) => {
    const legacyPath = join(dir, "terminal-config.json");
    writeFileSync(legacyPath, legacy);
    const store = loadStore();

    expect(() => store.read({ strict: true })).toThrow(/saved terminal registration/);
    expect(store.read()).toBeNull();
    expect(store.write({ tokenId: "replacement", locationId: "branch-b" }).ok).toBe(false);
    expect(store.write(null).ok).toBe(false);
    expect(readFileSync(legacyPath, "utf8")).toBe(legacy);
    expect(existsSync(join(dir, "terminal-config.bin"))).toBe(false);
    expect(existsSync(join(dir, "terminal-last-binding.bin"))).toBe(false);
    expect(existsSync(join(dir, "terminal-provisioned"))).toBe(false);
  });

  it("refuses replacement and clearing when an existing legacy activation cannot be read", () => {
    const legacyPath = join(dir, "terminal-config.json");
    const legacy = JSON.stringify({ tokenId: "t-3", locationId: "branch-a" });
    writeFileSync(legacyPath, legacy);
    const store = loadStore();
    const actualFs = require_("node:fs");
    const originalRead = actualFs.readFileSync;
    const unavailable = vi.spyOn(actualFs, "readFileSync").mockImplementation((...args: unknown[]) => {
      if (args[0] === legacyPath) throw Object.assign(new Error("Fixture access denied"), { code: "EACCES" });
      return originalRead(...args);
    });

    expect(() => store.read({ strict: true })).toThrow(/saved terminal registration/);
    expect(store.write({ tokenId: "replacement", locationId: "branch-b" }).ok).toBe(false);
    expect(store.write(null).ok).toBe(false);
    unavailable.mockRestore();
    expect(readFileSync(legacyPath, "utf8")).toBe(legacy);
    expect(existsSync(join(dir, "terminal-config.bin"))).toBe(false);
    expect(existsSync(join(dir, "terminal-last-binding.bin"))).toBe(false);
    expect(existsSync(join(dir, "terminal-provisioned"))).toBe(false);
    expect(store.read({ strict: true })?.tokenId).toBe("t-3");
  });

  it("returns an explicit failure from the installed Main read handler and recovers on retry", () => {
    const store = loadStore();
    const source = readFileSync(join(storePath, "..", "main.cjs"), "utf8");
    const from = source.indexOf('  ipcMain.handle("terminal:read",');
    const to = source.indexOf('  ipcMain.handle("terminal:write",', from);
    let handler!: () => unknown;
    const ipcMain = { handle: (_name: string, read: () => unknown) => { handler = read; } };
    require_("../../../../electron/ipc-privilege.cjs").install(ipcMain, {
      isFirstRun: () => !store.wasProvisioned(), isManagementDevice: () => false,
    });
    new Function("ipcMain", "terminalStore", source.slice(from, to))(ipcMain, store);

    expect(handler()).toEqual({ ok: true, config: null });
    expect(store.write({ tokenId: "t-1", locationId: "branch-a" }).ok).toBe(true);
    decryptFailure = true;
    expect(handler()).toMatchObject({ ok: false, code: "EACTIVATION_STORE" });
    expect(handler()).not.toHaveProperty("config");
    decryptFailure = false;
    expect(handler()).toMatchObject({ ok: true, config: { tokenId: "t-1", locationId: "branch-a" } });
  });
});
