import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createTerminalOnlineRecovery } = require("../../../../electron/terminal-online-recovery.cjs");
const activationBoundary = require("../../../../electron/verified-activation.cjs");
const directories: string[] = [];
const previous = { tokenId: "10000000-0000-4000-8000-000000000001", deviceType: "pc", deviceUse: "operations", locationId: "branch-a" };
const evidence = { sealed: "opaque-retained-cipher", plain: "opaque-retained-plain", key: "opaque-retained-key" };
const replacement = { ...previous, tokenId: "20000000-0000-4000-8000-000000000002", deviceBindingProof: "a".repeat(64),
  supabaseUrl: "https://fixture-project.invalid", supabaseKey: "fixture-publishable", backendUrl: "https://fixture-pos.invalid" };

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pos-online-recovery-")); directories.push(directory);
  let active: object | null = null, marker: object | null = { ...previous }, provisioned = true;
  let profile: unknown = { host: "fixture-sql", database: "retained", authMode: "windows" }, enabled: unknown = true;
  let cloud = { url: replacement.supabaseUrl, key: replacement.supabaseKey }, backend = replacement.backendUrl, available = true;
  const vault = {
    isEncryptionAvailable: vi.fn(() => available),
    encryptString: vi.fn((raw: string) => Buffer.from("fixture-seal:" + Buffer.from(raw).toString("base64"))),
    decryptString: vi.fn((raw: Buffer) => {
      if (!raw.toString().startsWith("fixture-seal:")) throw new Error("private vault detail");
      return Buffer.from(raw.toString().slice("fixture-seal:".length), "base64").toString();
    }),
  };
  const configStore = { getStrict: vi.fn((key: string) => {
    const values: Record<string, unknown> = { localDatabaseProfile: profile, localDatabaseEnabled: enabled, backendUrl: backend };
    return values[key] ?? null;
  }), set: vi.fn() };
  const terminalStore = { read: vi.fn(() => active), lastBinding: vi.fn(() => marker), wasProvisioned: vi.fn(() => provisioned), write: vi.fn() };
  const cloudCredentials = { read: vi.fn(() => cloud) };
  const create = () => createTerminalOnlineRecovery({ app: { getPath: () => directory }, safeStorage: vault,
    configStore, terminalStore, activationBoundary, cloudCredentials });
  const store = create();
  const file = path.join(directory, "terminal-online-recovery.bin");
  return { store, vault, configStore, terminalStore, file, directory, reopen: create,
    begin: () => store.begin({ evidence }),
    ready: () => { store.begin({ evidence }); enabled = false; },
    enabled: (value: unknown) => { enabled = value; }, profile: (value: unknown) => { profile = value; },
    active: (value: object | null) => { active = value; }, marker: (value: object | null) => { marker = value; },
    provisioned: (value: boolean) => { provisioned = value; }, available: (value: boolean) => { available = value; },
    backend: (value: string) => { backend = value; }, cloud: (value: typeof cloud) => { cloud = value; },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep + "pos-online-recovery-")) throw new Error("Unsafe fixture cleanup");
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

it("distinguishes absent hold from protected metadata without reading installed profiles", () => {
  const f = fixture();
  expect(f.store.read()).toBeNull(); expect(f.store.pending()).toBe(false);
  expect(f.store.status()).toEqual({ pending: false, replacementBound: false });
});

it("atomically seals old binding, saved SQL settings and opaque evidence before online continuation", () => {
  const f = fixture();
  expect(f.begin()).toEqual({ pending: true, replacementBound: false });
  const record = f.store.read();
  expect(record.previous.raw).toEqual(previous);
  expect(record.source).toEqual({ profile: { host: "fixture-sql", database: "retained", authMode: "windows" }, enabled: true,
    cloud: { url: replacement.supabaseUrl, key: replacement.supabaseKey }, backend: replacement.backendUrl });
  expect(record.online).toEqual({ cloud: record.source.cloud, backend: record.source.backend });
  expect(record.evidence).toEqual(evidence); expect(record.replacement).toBeNull();
  expect(record.attempts).toEqual([]);
  expect(f.vault.encryptString).toHaveBeenCalledOnce();
  expect(fs.readFileSync(f.file).toString()).not.toContain(evidence.plain);
  expect(fs.readdirSync(f.directory)).toEqual(["terminal-online-recovery.bin"]);
  expect(f.configStore.set).not.toHaveBeenCalled(); expect(f.terminalStore.write).not.toHaveBeenCalled();
  expect(f.terminalStore.lastBinding).toHaveBeenCalledWith({ strict: true });
});

it("preserves missing SQL as unknown rather than inventing an empty database", () => {
  const f = fixture(); f.profile(null); f.enabled(null); f.begin();
  expect(f.store.read().source).toMatchObject({ profile: null, enabled: null });
  expect(() => f.store.assertOnlineReady()).toThrow(expect.objectContaining({ code: "EONLINE_RECOVERY_NOT_READY" }));
  f.enabled(false); expect(() => f.store.assertOnlineReady()).not.toThrow();
});

it("keeps the original archive and is idempotent before and after disabling SQL", () => {
  const f = fixture(); f.begin(); const original = fs.readFileSync(f.file);
  f.enabled(false); f.store.begin({ evidence: { sealed: "new", plain: "new", key: "new" } });
  expect(fs.readFileSync(f.file)).toEqual(original); expect(f.store.read().evidence).toEqual(evidence);
});

it.each(["native", "marker", "fresh"])("refuses invalid initial %s context without making a hold", kind => {
  const f = fixture();
  if (kind === "native") f.active(previous);
  if (kind === "marker") f.marker(null);
  if (kind === "fresh") f.provisioned(false);
  expect(() => f.begin()).toThrow(); expect(f.store.pending()).toBe(false);
});

it.each(["sealed", "plain", "key"])("refuses oversized opaque %s evidence", key => {
  const f = fixture();
  expect(() => f.store.begin({ evidence: { ...evidence, [key]: "x".repeat(32 * 1024 + 1) } })).toThrow(expect.objectContaining({ code: "EONLINE_RECOVERY_STORE" }));
  expect(f.store.pending()).toBe(false);
});

it("rejects unrecognized evidence fields and bounds UTF-8 byte size", () => {
  const f = fixture();
  expect(() => f.store.begin({ evidence: { ...evidence, tokenId: replacement.tokenId } })).toThrow();
  expect(() => f.store.begin({ evidence: { ...evidence, sealed: "界".repeat(12 * 1024) } })).toThrow();
  expect(f.store.pending()).toBe(false);
});

it("holds malformed and unsupported-version records rather than treating them as absent", () => {
  const f = fixture(); fs.writeFileSync(f.file, "invalid-ciphertext");
  expect(f.store.pending()).toBe(true);
  expect(() => f.store.read()).toThrow(expect.objectContaining({ code: "EONLINE_RECOVERY_STORE" }));
  expect(() => f.store.status()).toThrow(expect.objectContaining({ code: "EONLINE_RECOVERY_STORE" }));
  expect(() => f.begin()).toThrow();
  fs.unlinkSync(f.file); f.begin(); const record = f.store.read(); record.version = 2;
  fs.writeFileSync(f.file, f.vault.encryptString(JSON.stringify(record)));
  expect(f.store.pending()).toBe(true); expect(() => f.store.read()).toThrow();
});

it("keeps unreadable records pending and never exposes raw filesystem details", () => {
  const f = fixture(); f.begin();
  vi.spyOn(fs, "statSync").mockImplementation(() => { throw Object.assign(new Error("private path"), { code: "EACCES" }); });
  vi.spyOn(fs, "readFileSync").mockImplementation(() => { throw Object.assign(new Error("private path"), { code: "EACCES" }); });
  expect(f.store.pending()).toBe(true);
  expect(() => f.store.read()).toThrow("The protected online recovery record");
});

it("refuses unavailable vault without a plaintext fallback", () => {
  const f = fixture(); f.available(false);
  expect(() => f.begin()).toThrow(expect.objectContaining({ code: "EONLINE_RECOVERY_STORE" }));
  expect(fs.readdirSync(f.directory)).toEqual([]);
  f.available(true); f.begin(); f.available(false);
  expect(f.store.pending()).toBe(true); expect(() => f.store.read()).toThrow();
});

it.each(["encrypt", "write", "rename"])("does not leave a partial first hold on %s failure", kind => {
  const f = fixture();
  if (kind === "encrypt") f.vault.encryptString.mockImplementation(() => { throw new Error("private encryption detail"); });
  if (kind === "write") vi.spyOn(fs, "writeFileSync").mockImplementation(() => { throw new Error("private disk detail"); });
  if (kind === "rename") vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("private rename detail"); });
  expect(() => f.begin()).toThrow(expect.objectContaining({ code: "EONLINE_RECOVERY_STORE" }));
  expect(f.store.pending()).toBe(false); expect(fs.readdirSync(f.directory)).toEqual([]);
});

it("requires SQL disabled before claim readiness or target pinning", () => {
  const f = fixture(); f.begin();
  expect(() => f.store.assertOnlineReady()).toThrow(expect.objectContaining({ code: "EONLINE_RECOVERY_NOT_READY" }));
  expect(() => f.store.bindReplacement(replacement)).toThrow(expect.objectContaining({ code: "EONLINE_RECOVERY_NOT_READY" }));
  expect(f.store.read().replacement).toBeNull();
});

it.each(["profile", "project", "backend", "marker"])("refuses changed saved %s context", kind => {
  const f = fixture(); f.ready();
  if (kind === "profile") f.profile({ host: "different", database: "empty", authMode: "windows" });
  if (kind === "project") f.cloud({ url: "https://different.invalid", key: replacement.supabaseKey });
  if (kind === "backend") f.backend("https://different.invalid");
  if (kind === "marker") f.marker({ ...previous, tokenId: replacement.tokenId });
  expect(() => f.store.assertOnlineReady()).toThrow(expect.objectContaining({ code: "EONLINE_RECOVERY_CONTEXT" }));
  expect(() => f.store.bindReplacement(replacement)).toThrow();
});

it("allows a rotated saved publishable key without changing project or archived evidence", () => {
  const f = fixture(); f.ready(); f.cloud({ url: replacement.supabaseUrl, key: "rotated-publishable" });
  expect(() => f.store.assertOnlineReady()).not.toThrow();
  f.store.bindReplacement({ ...replacement, supabaseKey: "rotated-publishable" });
  expect(f.store.read().source.cloud.key).toBe(replacement.supabaseKey);
  f.cloud({ url: replacement.supabaseUrl, key: "rotated-again-after-pin" });
  expect(() => f.store.assertOnlineReady()).not.toThrow();
  expect(() => f.store.assertReplacement({ ...replacement, supabaseKey: "rotated-again-after-pin" })).not.toThrow();
});

it.each(["project", "backend"])("requires explicit continuation before accepting a corrected online %s", kind => {
  const f = fixture(); f.ready(); const archived = f.store.read();
  const corrected = { ...replacement };
  if (kind === "project") {
    corrected.supabaseUrl = "https://corrected-project.invalid";
    f.cloud({ url: corrected.supabaseUrl, key: "corrected-publishable" });
  } else {
    corrected.backendUrl = "https://corrected-pos.invalid"; f.backend(corrected.backendUrl);
  }
  expect(() => f.store.status()).toThrow(expect.objectContaining({ code: "EONLINE_RECOVERY_CONTEXT" }));
  expect(() => f.store.assertOnlineReady()).toThrow(expect.objectContaining({ code: "EONLINE_RECOVERY_CONTEXT" }));
  expect(f.store.read()).toEqual(archived);
  f.store.begin({ evidence: { sealed: "later-seal", plain: "later-plain", key: "later-key" } });
  const refreshed = f.store.read();
  expect(refreshed.source).toEqual(archived.source); expect(refreshed.previous).toEqual(archived.previous);
  expect(refreshed.evidence).toEqual(archived.evidence); expect(refreshed.createdAt).toBe(archived.createdAt);
  expect(refreshed.online).toMatchObject({ cloud: { url: corrected.supabaseUrl }, backend: corrected.backendUrl });
  expect(() => f.store.assertOnlineReady()).not.toThrow();
  expect(() => f.store.bindReplacement(corrected)).not.toThrow();
  expect(() => f.store.assertReplacement(corrected)).not.toThrow();
});

it.each(["project", "backend"])("never automatically retargets a pinned replacement to a corrected %s", kind => {
  const f = fixture(); f.ready(); f.store.bindReplacement(replacement); const pinned = f.store.read();
  if (kind === "project") f.cloud({ url: "https://different-project.invalid", key: replacement.supabaseKey });
  else f.backend("https://different-pos.invalid");
  expect(() => f.store.assertOnlineReady()).toThrow(expect.objectContaining({ code: "EONLINE_RECOVERY_CONTEXT" }));
  expect(() => f.store.status()).toThrow(expect.objectContaining({ code: "EONLINE_RECOVERY_CONTEXT" }));
  expect(() => f.store.bindReplacement(replacement)).toThrow(expect.objectContaining({ code: "EONLINE_RECOVERY_CONTEXT" }));
  expect(f.store.read()).toEqual(pinned);
});

it.each(["enabled", "native", "profile"])("refuses explicit online refresh with changed or unsafe %s local context", kind => {
  const f = fixture(); f.ready(); const archived = f.store.read();
  f.backend("https://corrected-pos.invalid");
  if (kind === "enabled") f.enabled(true);
  if (kind === "native") f.active(previous);
  if (kind === "profile") f.profile({ host: "different", database: "empty", authMode: "windows" });
  expect(() => f.store.begin({ evidence })).toThrow(expect.objectContaining({ code: "EONLINE_RECOVERY_CONTEXT" }));
  expect(f.store.read()).toEqual(archived);
});

it("keeps old online context if an explicit correction cannot be persisted atomically", () => {
  const f = fixture(); f.ready(); const archived = f.store.read();
  f.backend("https://corrected-pos.invalid");
  vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("private rename detail"); });
  expect(() => f.store.begin({ evidence })).toThrow(expect.objectContaining({ code: "EONLINE_RECOVERY_STORE" }));
  expect(f.store.read()).toEqual(archived);
  expect(() => f.store.assertOnlineReady()).toThrow(expect.objectContaining({ code: "EONLINE_RECOVERY_CONTEXT" }));
  expect(f.store.pending()).toBe(true);
});

it("preserves every prior pin and the original archive across an explicit later recovery and restart", () => {
  const f = fixture(); f.ready(); f.store.bindReplacement(replacement);
  f.marker(replacement); f.active(replacement);
  const first = f.store.read();
  expect(() => f.store.begin({ evidence })).toThrow(expect.objectContaining({ code: "EONLINE_RECOVERY_CONTEXT" }));
  expect(f.store.read()).toEqual(first);
  // The existing native revocation/unpair path removes the full registration,
  // while its last binding remains available to protect older local work.
  f.active(null);
  f.backend("https://next-pos.invalid"); f.cloud({ url: "https://next-project.invalid", key: "next-publishable" });
  expect(f.store.begin({ evidence: { sealed: "later", plain: "later", key: "later" } })).toEqual({ pending: true, replacementBound: false });
  const next = f.store.read();
  expect(next.previous).toEqual(first.previous); expect(next.source).toEqual(first.source);
  expect(next.evidence).toEqual(first.evidence); expect(next.createdAt).toBe(first.createdAt);
  expect(next.attempts).toEqual([{ replacement: first.replacement, online: first.online }]);
  expect(next.online).toEqual({ cloud: { url: "https://next-project.invalid", key: "next-publishable" }, backend: "https://next-pos.invalid" });
  expect(next.replacement).toBeNull();
  const reopened = f.reopen();
  expect(() => reopened.assertOnlineReady()).not.toThrow();
  expect(() => reopened.assertReplacement(replacement)).toThrow(expect.objectContaining({ code: "EONLINE_RECOVERY_TARGET" }));
  const later = { ...replacement, tokenId: "30000000-0000-4000-8000-000000000003", supabaseUrl: "https://next-project.invalid", backendUrl: "https://next-pos.invalid" };
  reopened.bindReplacement(later);
  expect(() => f.reopen().assertReplacement(later)).not.toThrow();
  expect(f.store.read().attempts).toEqual(next.attempts);
});

it("does not advance a pinned attempt through status or readiness checks", () => {
  const f = fixture(); f.ready(); f.store.bindReplacement(replacement); const pinned = fs.readFileSync(f.file);
  for (let i = 0; i < 3; i++) {
    expect(f.store.status()).toEqual({ pending: true, replacementBound: true });
    f.store.assertOnlineReady(); f.store.assertReplacement(replacement);
  }
  expect(fs.readFileSync(f.file)).toEqual(pinned); expect(f.store.read().attempts).toEqual([]);
});

it.each(["marker", "native", "enabled", "profile"])("refuses advancing a pin with unsafe %s context", kind => {
  const f = fixture(); f.ready(); f.store.bindReplacement(replacement); const pinned = f.store.read();
  if (kind === "marker") f.marker({ ...replacement, tokenId: "foreign-fixture" });
  if (kind === "native") f.active(replacement);
  if (kind === "enabled") f.enabled(true);
  if (kind === "profile") f.profile({ host: "different", database: "empty", authMode: "windows" });
  expect(() => f.store.begin({ evidence })).toThrow(expect.objectContaining({ code: "EONLINE_RECOVERY_CONTEXT" }));
  expect(f.store.read()).toEqual(pinned);
});

it("preserves the old pin and full archive when advancing cannot be saved atomically", () => {
  const f = fixture(); f.ready(); f.store.bindReplacement(replacement); const pinned = fs.readFileSync(f.file);
  vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("private rename detail"); });
  expect(() => f.store.begin({ evidence })).toThrow(expect.objectContaining({ code: "EONLINE_RECOVERY_STORE" }));
  expect(fs.readFileSync(f.file)).toEqual(pinned); expect(f.store.read().attempts).toEqual([]);
  expect(() => f.store.assertReplacement(replacement)).not.toThrow(); expect(f.store.pending()).toBe(true);
});

it("bounds append-only history and preserves the current pin when the limit is reached", () => {
  const f = fixture(); f.ready();
  let current = replacement;
  for (let i = 0; i <= 16; i++) {
    current = { ...replacement, tokenId: `20000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}` };
    f.store.bindReplacement(current); f.marker(current);
    if (i < 16) f.store.begin({ evidence });
  }
  const pinned = fs.readFileSync(f.file);
  expect(f.store.read().attempts).toHaveLength(16);
  expect(() => f.store.begin({ evidence })).toThrow(expect.objectContaining({ code: "EONLINE_RECOVERY_LIMIT" }));
  expect(fs.readFileSync(f.file)).toEqual(pinned); expect(() => f.store.assertReplacement(current)).not.toThrow();
  expect(f.store.pending()).toBe(true);
});

it("rejects malformed attempt archives without interpreting the hold as absent", () => {
  const f = fixture(); f.ready(); const record = f.store.read();
  record.attempts = [{ replacement: { binding: activationBoundary.binding(replacement), proof: "not-a-proof" }, online: record.online }];
  fs.writeFileSync(f.file, f.vault.encryptString(JSON.stringify(record)));
  expect(f.store.pending()).toBe(true);
  expect(() => f.store.read()).toThrow(expect.objectContaining({ code: "EONLINE_RECOVERY_STORE" }));
});

it("persists one exact target and proof before native replacement and allows same-target retry", () => {
  const f = fixture(); f.ready();
  expect(() => f.store.assertReplacement(replacement)).toThrow(expect.objectContaining({ code: "EONLINE_RECOVERY_TARGET" }));
  expect(f.store.bindReplacement(replacement)).toEqual({ pending: true, replacementBound: true });
  const original = fs.readFileSync(f.file);
  expect(() => f.store.assertReplacement(replacement)).not.toThrow();
  f.store.bindReplacement(replacement); expect(fs.readFileSync(f.file)).toEqual(original);
  expect(f.terminalStore.write).not.toHaveBeenCalled();
  expect(f.store.status()).toEqual({ pending: true, replacementBound: true });
});

it.each(["id", "proof", "branch", "project", "backend"])("refuses a different replacement %s after pinning", kind => {
  const f = fixture(); f.ready(); f.store.bindReplacement(replacement);
  const changed = { ...replacement };
  if (kind === "id") changed.tokenId = "30000000-0000-4000-8000-000000000003";
  if (kind === "proof") changed.deviceBindingProof = "b".repeat(64);
  if (kind === "branch") changed.locationId = "branch-b";
  if (kind === "project") changed.supabaseUrl = "https://different.invalid";
  if (kind === "backend") changed.backendUrl = "https://different.invalid";
  expect(() => f.store.bindReplacement(changed)).toThrow(expect.objectContaining({ code: "EONLINE_RECOVERY_TARGET" }));
  expect(() => f.store.assertReplacement(changed)).toThrow();
  expect(f.store.read().replacement).toMatchObject({ binding: { id: replacement.tokenId }, proof: replacement.deviceBindingProof });
});

it("allows interrupted native writes only for the pinned target and proof", () => {
  const f = fixture(); f.ready(); f.store.bindReplacement(replacement); f.marker(replacement);
  expect(() => f.store.assertReplacement(replacement)).not.toThrow();
  f.active(replacement); expect(() => f.store.assertReplacement(replacement)).not.toThrow();
  f.active({ ...replacement, deviceBindingProof: "b".repeat(64) });
  expect(() => f.store.assertReplacement(replacement)).toThrow(expect.objectContaining({ code: "EONLINE_RECOVERY_CONTEXT" }));
});

it("preserves the original durable hold if target-pinning rename fails", () => {
  const f = fixture(); f.ready(); const original = fs.readFileSync(f.file);
  vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("private rename detail"); });
  expect(() => f.store.bindReplacement(replacement)).toThrow(expect.objectContaining({ code: "EONLINE_RECOVERY_STORE" }));
  expect(fs.readFileSync(f.file)).toEqual(original); expect(f.store.read().replacement).toBeNull();
  expect(fs.readdirSync(f.directory)).toEqual(["terminal-online-recovery.bin"]);
});

it("exposes no clearing, removal, settings editing or registration-writing API", () => {
  const f = fixture();
  expect(Object.keys(f.store).sort()).toEqual(["assertOnlineReady", "assertReplacement", "begin", "bindReplacement", "pending", "read", "status"].sort());
});
