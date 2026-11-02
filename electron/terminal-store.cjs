/**
 * Persistent copy of the terminal activation, kept in the app's user-data
 * folder so an in-place update (or a cleared renderer storage) never forces the
 * branch to register the till again.
 *
 * One state only: sealed in the operating system's vault, or not stored at all.
 * An older build could leave an unencrypted `terminal-config.json` behind; that
 * copy is migrated into the vault once and deleted. It is never trusted on its
 * own, because a plain file on disk can be edited by anything on the machine.
 */
const fs = require("node:fs");
const path = require("node:path");
const { app, safeStorage } = require("electron");

const file = () => path.join(app.getPath("userData"), "terminal-config.json");
const sealed = () => path.join(app.getPath("userData"), "terminal-config.bin");

const marker = () => path.join(app.getPath("userData"), "terminal-provisioned");
const markProvisioned = () => fs.writeFileSync(marker(), "1", { flag: "w" });
function wasProvisioned() {
  // Existing activation also counts when upgrading an older installation.
  return fs.existsSync(marker()) || fs.existsSync(sealed()) || fs.existsSync(file());
}

const canSeal = () => {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
};

function readSealed() {
  if (!canSeal()) throw new Error("The Windows credential vault is not ready. Retry restoring the saved terminal registration.");
  try {
    const parsed = JSON.parse(safeStorage.decryptString(fs.readFileSync(sealed())));
    if (typeof parsed?.tokenId !== "string" || !parsed.tokenId.trim()) throw new Error("Invalid activation");
    return parsed;
  } catch {
    throw new Error("The saved terminal registration could not be read. Your registration has not been removed.");
  }
}

function readLegacy() {
  if (!fs.existsSync(file())) return null;
  let legacy = null;
  try {
    legacy = JSON.parse(fs.readFileSync(file(), "utf8"));
  } catch {
    throw new Error("The saved terminal registration could not be read. Your registration has not been removed.");
  }
  if (typeof legacy?.tokenId !== "string" || !legacy.tokenId.trim()) {
    throw new Error("The saved terminal registration could not be read. Your registration has not been removed.");
  }
  return legacy;
}

function readStrict() {
  // An existing vault copy is authoritative even when it cannot currently be
  // opened. Never replace it with an editable legacy file after a read error.
  if (fs.existsSync(sealed())) return readSealed();

  // Legacy unencrypted activation from an older build. It is only ever used to
  // seal itself. If the vault is unavailable, leave it inert for a retry;
  // never expose the editable activation as a usable registration.
  const legacy = readLegacy();
  if (!legacy) return null;
  const migrated = write(legacy);
  if (!migrated.ok) {
    throw new Error("Could not restore the saved terminal registration into the Windows vault. Retry opening the app.");
  }
  return readSealed();
}

// Background readers can pause without throwing from ordinary Main startup.
// Startup's IPC reader must distinguish an unreadable activation from absence.
function read(options = {}) {
  try { return readStrict(); }
  catch (error) { if (options.strict) throw error; return null; }
}

// Non-secret previous binding survives revocation solely to protect queued origin.
const previousFile = () => path.join(app.getPath("userData"), "terminal-last-binding.bin");
function lastBinding(){
  try{return JSON.parse(safeStorage.decryptString(fs.readFileSync(previousFile())));}catch{return null;}
}
function rememberBinding(config){
  if(!config?.tokenId||!canSeal())return;
  const previous={tokenId:config.tokenId,deviceUse:config.deviceUse,deviceType:config.deviceType,locationId:config.locationId,storeId:config.storeId,branchId:config.branchId};
  fs.writeFileSync(previousFile(),safeStorage.encryptString(JSON.stringify(previous)));
}
function write(config) {
  try {
    // Check before changing the seal, its previous binding or provision marker.
    // A failed read is never permission to replace or erase a registration.
    const existing = fs.existsSync(sealed()) ? readSealed() : readLegacy();
    if (!config) {
      if (existing && !canSeal()) throw new Error("The Windows credential vault is not ready. Retry restoring the saved terminal registration.");
      rememberBinding(existing);
      if (wasProvisioned()) markProvisioned();
      fs.rmSync(file(), { force: true });
      fs.rmSync(sealed(), { force: true });
      return { ok: true };
    }
    if (!canSeal()) {
      // Silently falling back to a plain-text activation on a machine whose
      // vault is unavailable would leave the terminal's identity readable by
      // anything on the disk.
      return {
        ok: false,
        error:
          "This computer's secure store is unavailable, so the activation cannot be saved. Sign in to Windows with a normal user profile (not a temporary one) and try again.",
      };
    }
    rememberBinding(config);
    fs.writeFileSync(sealed(), safeStorage.encryptString(JSON.stringify(config)));
    markProvisioned();
    // The plain copy must not linger once the vault holds the activation.
    fs.rmSync(file(), { force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}


/** Whether the activation is protected by the operating system's vault. */
function isSecure() {
  return canSeal();
}

module.exports = { read, write, isSecure, wasProvisioned, lastBinding };
