const fs = require("node:fs");
const path = require("node:path");

const PROFILE_KEY = "localDatabaseProfile";
const ENABLED_KEY = "localDatabaseEnabled";

function createSecureConfig({ app, safeStorage, configStore, recoveryLocal = null }) {
  const secretPath = () => path.join(app.getPath("userData"), "local-db-config.bin");
  const canSeal = () => {
    try {
      return process.platform === "win32" && safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  };

  const profile = () => {
    if (recoveryLocal?.pending()) return recoveryLocal.profile();
    const value = configStore.get(PROFILE_KEY);
    return value && typeof value === "object" ? { ...value } : null;
  };
  const enabled = () => recoveryLocal?.pending() ? recoveryLocal.enabled() : configStore.get(ENABLED_KEY) === true;
  const setEnabled = (value) => recoveryLocal?.pending() ? recoveryLocal.setEnabled(value === true) : configStore.set(ENABLED_KEY, value === true);

  function readSecret() {
    try {
      if (!canSeal()) return null;
      return JSON.parse(safeStorage.decryptString(fs.readFileSync(secretPath())));
    } catch {
      return null;
    }
  }

  function save(value) {
    if (recoveryLocal?.pending()) return recoveryLocal.save(value);
    const next = value && typeof value === "object" ? value : {};
    const password = String(next.password ?? "");
    if (next.authMode === "sql" && !canSeal()) {
      const error = new Error("Windows secure storage is unavailable.");
      error.code = "EDPAPI";
      throw error;
    }
    if (next.authMode === "sql") {
      fs.writeFileSync(secretPath(), safeStorage.encryptString(JSON.stringify({ password })), {
        mode: 0o600,
      });
    } else {
      fs.rmSync(secretPath(), { force: true });
    }
    const redacted = {
      host: next.host,
      instanceName: next.instanceName ?? "",
      port: next.port,
      database: next.database,
      authMode: next.authMode,
      username: next.authMode === "sql" ? next.username : "",
      encrypt: next.encrypt,
      trustServerCertificate: next.trustServerCertificate,
      connectionTimeoutMs: next.connectionTimeoutMs,
      requestTimeoutMs: next.requestTimeoutMs,
      retentionDays: next.retentionDays ?? 90,
    };
    const result = configStore.set(PROFILE_KEY, redacted);
    if (result?.ok === false) throw new Error(result.error || "Could not save database profile.");
    setEnabled(true);
    return redacted;
  }

  function credentials() {
    if (recoveryLocal?.pending()) return recoveryLocal.credentials();
    const saved = profile();
    if (!saved) return null;
    const secret = saved.authMode === "sql" ? readSecret() : {};
    if (saved.authMode === "sql" && !secret) return null;
    return { ...saved, password: secret?.password ?? "" };
  }

  function remove() {
    if (recoveryLocal?.pending()) return recoveryLocal.remove();
    fs.rmSync(secretPath(), { force: true });
    configStore.set(PROFILE_KEY, null);
    configStore.set(ENABLED_KEY, false);
    return { ok: true };
  }

  return { canSeal, enabled, setEnabled, profile, credentials, save, remove, secretPath };
}

module.exports = { createSecureConfig, PROFILE_KEY, ENABLED_KEY };
