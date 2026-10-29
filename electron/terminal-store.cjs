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

function read() {
  // Preferred, and the only trusted source: the OS vault copy (DPAPI on
  // Windows, Keychain on macOS).
  if (canSeal()) {
    try {
      const buf = fs.readFileSync(sealed());
      const parsed = JSON.parse(safeStorage.decryptString(buf));
      if (parsed && parsed.tokenId) return parsed;
    } catch {
      /* unreadable or tampered: fall through to the one-time migration */
    }
  }

  // Legacy unencrypted activation from an older build. It is only ever used to
  // seal itself; if it cannot be sealed it is discarded and the till goes
  // through normal reactivation rather than trusting an editable file.
  let legacy = null;
  try {
    legacy = JSON.parse(fs.readFileSync(file(), "utf8"));
  } catch {
    return null;
  }
  if (!legacy || !legacy.tokenId) {
    fs.rmSync(file(), { force: true });
    return null;
  }
  const migrated = write(legacy);
  if (!migrated.ok) {
    // No vault: the plain copy must not survive as a usable activation.
    fs.rmSync(file(), { force: true });
    return null;
  }
  return legacy;
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
    if (!config) {
      rememberBinding(read());
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
