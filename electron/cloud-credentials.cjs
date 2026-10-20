/**
 * Central cloud credentials (Supabase URL + publishable key) for a till,
 * sealed with the operating system's own vault (Windows DPAPI via Electron
 * safeStorage). Nothing tenant-specific is baked into the bundle anymore:
 * the URL and key are entered once in Settings and live only here.
 *
 * The plain-JSON fallback exists only for hosts where the OS vault is
 * unavailable (headless Linux CI); on Windows the file is always encrypted.
 */
const fs = require("node:fs");
const path = require("node:path");
const { app, safeStorage } = require("electron");

const sealedPath = () => path.join(app.getPath("userData"), "cloud-credentials.bin");
const legacyPath = () => path.join(app.getPath("userData"), "cloud-credentials.json");

const canSeal = () => {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
};

/** Keep only a well-formed pair; anything else counts as "not configured". */
function clean(value) {
  if (!value || typeof value !== "object") return null;
  const url = String(value.url ?? "").trim().replace(/\/+$/, "");
  const key = String(value.key ?? "").trim();
  if (!/^https:\/\/.+/i.test(url)) return null;
  if (key.length < 10) return null;
  return { url, key };
}

function readStrict() {
  if (fs.existsSync(sealedPath())) {
    if (!canSeal()) throw new Error("The Windows credential vault is not ready. Retry restoring the connection.");
    const parsed = clean(JSON.parse(safeStorage.decryptString(fs.readFileSync(sealedPath()))));
    if (!parsed) throw new Error("The saved database connection could not be read.");
    return parsed;
  }
  if (!fs.existsSync(legacyPath())) return null;
  const parsed = clean(JSON.parse(fs.readFileSync(legacyPath(), "utf8")));
  if (!parsed) throw new Error("The saved database connection could not be read.");
  if (canSeal()) {
    const saved = write(parsed);
    if (!saved.ok) throw new Error("Could not restore the connection into the Windows vault.");
  }
  return parsed;
}

// Background probes may pause while the vault is unavailable; startup uses the
// strict read so it never mistakes a failed restore for a fresh device.
function read(options = {}) {
  try { return readStrict(); }
  catch (error) { if (options.strict) throw error; return null; }
}

function write(value) {
  const next = clean(value);
  try {
    if (!next) {
      fs.rmSync(sealedPath(), { force: true });
      fs.rmSync(legacyPath(), { force: true });
      return { ok: true };
    }
    if (canSeal()) {
      fs.writeFileSync(sealedPath(), safeStorage.encryptString(JSON.stringify(next)));
      fs.rmSync(legacyPath(), { force: true });
      return { ok: true, encrypted: true };
    }
    if (process.platform === "win32")
      return { ok: false, error: "The Windows credential vault is not ready. Credentials were not changed." };
    fs.writeFileSync(legacyPath(), JSON.stringify(next), { mode: 0o600 });
    return { ok: true, encrypted: false };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function remove() {
  try {
    fs.rmSync(sealedPath(), { force: true });
    fs.rmSync(legacyPath(), { force: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Status for the settings UI — the key itself never leaves this process. */
function status() {
  const saved = read({ strict: true });
  return {
    configured: Boolean(saved),
    url: saved ? saved.url : "",
    keyHint: saved ? `${saved.key.slice(0, 6)}…${saved.key.slice(-4)}` : "",
    encrypted: canSeal(),
  };
}

module.exports = { read, write, remove, status };
