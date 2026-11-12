"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const FILE = "terminal-online-recovery.bin";
const MAX_EVIDENCE_BYTES = 32 * 1024;
const MAX_RECORD_BYTES = 160 * 1024;
const MAX_FILE_BYTES = 192 * 1024;
const MAX_ARCHIVED_ATTEMPTS = 16;
const messages = Object.freeze({
  EONLINE_RECOVERY_STORE: "The protected online recovery record could not be read or saved. Your previous setup has been kept.",
  EONLINE_RECOVERY_CONTEXT: "The terminal or saved connection changed during online recovery. Review the current setup and retry.",
  EONLINE_RECOVERY_TARGET: "Online recovery is already bound to a different replacement registration. Retry the same activation on this device.",
  EONLINE_RECOVERY_NOT_READY: "The previous local database must remain disabled and held for recovery before continuing online.",
  EONLINE_RECOVERY_LIMIT: "The saved online recovery history needs review before another registration. Your previous setup has been kept.",
});
const fail = code => { throw Object.assign(new Error(messages[code]), { code }); };
const plain = value => Boolean(value && typeof value === "object" && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value)));
const exact = (value, fields) => plain(value) && Object.keys(value).length === fields.length &&
  fields.every(field => Object.hasOwn(value, field));
const bytes = value => Buffer.byteLength(value, "utf8");
const json = value => JSON.stringify(value, (_key, item) => {
  if (item === undefined || typeof item === "function" || typeof item === "symbol" || typeof item === "bigint")
    throw new Error("Unsupported recovery value");
  return item;
});
const copy = value => JSON.parse(json(value));
const stable = value => JSON.stringify(value, (_key, item) => plain(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const address = value => {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash
      ? url.href.replace(/\/+$/, "") : null;
  } catch { return null; }
};
const proof = config => typeof config?.deviceBindingProof === "string" && /^[a-f0-9]{64}$/i.test(config.deviceBindingProof)
  ? config.deviceBindingProof.toLowerCase() : null;

// Main-only durable quarantine. This file is never a POS-authority grant and
// intentionally has no clearing or generic configuration-write API.
function createTerminalOnlineRecovery({ app, safeStorage, configStore, terminalStore, activationBoundary, cloudCredentials }) {
  const file = () => path.join(app.getPath("userData"), FILE);
  const sealed = () => {
    if (!safeStorage.isEncryptionAvailable()) fail("EONLINE_RECOVERY_STORE");
  };
  const binding = value => {
    const result = activationBoundary.binding(value);
    if (!result || result.platform !== "pc" || !["operations", "management"].includes(result.mode) ||
        typeof result.id !== "string" || !result.id ||
        (result.mode === "operations" ? typeof result.branchId !== "string" || !result.branchId : result.branchId !== null))
      fail("EONLINE_RECOVERY_STORE");
    return result;
  };
  const evidenceOf = value => {
    if (!exact(value, ["sealed", "plain", "key"])) fail("EONLINE_RECOVERY_STORE");
    for (const item of Object.values(value))
      if (item !== null && (typeof item !== "string" || bytes(item) > MAX_EVIDENCE_BYTES)) fail("EONLINE_RECOVERY_STORE");
    return copy(value);
  };
  const sourceOf = () => {
    const cloud = cloudCredentials.read({ strict: true });
    const backend = configStore.getStrict("backendUrl");
    const enabled = configStore.getStrict("localDatabaseEnabled");
    const profile = configStore.getStrict("localDatabaseProfile");
    if (!cloud || !address(cloud.url) || typeof cloud.key !== "string" || !cloud.key || bytes(cloud.key) > 16 * 1024 ||
        !address(backend) || ![true, false, null].includes(enabled) || bytes(json(profile)) > 16 * 1024)
      fail("EONLINE_RECOVERY_STORE");
    return copy({ profile, enabled, cloud: { url: cloud.url, key: cloud.key }, backend });
  };
  const onlineOf = source => copy({ cloud: source.cloud, backend: source.backend });
  const validOnline = value => exact(value, ["cloud", "backend"]) && exact(value.cloud, ["url", "key"]) &&
    address(value.cloud.url) && typeof value.cloud.key === "string" && value.cloud.key &&
    bytes(value.cloud.key) <= 16 * 1024 && address(value.backend);
  const sameOnline = (source, online) => address(source.cloud.url) === address(online.cloud.url) &&
    address(source.backend) === address(online.backend);
  const validReplacement = value => exact(value, ["binding", "proof"]) &&
    exact(value.binding, ["id", "platform", "mode", "branchId"]) && value.binding.platform === "pc" &&
    ["operations", "management"].includes(value.binding.mode) && typeof value.binding.id === "string" && value.binding.id &&
    (value.binding.mode === "operations" ? typeof value.binding.branchId === "string" && value.binding.branchId : value.binding.branchId === null) &&
    typeof value.proof === "string" && /^[a-f0-9]{64}$/.test(value.proof);
  const validate = value => {
    if (!exact(value, ["version", "createdAt", "previous", "source", "online", "evidence", "replacement", "attempts"]) || value.version !== 1 ||
        typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) ||
        !exact(value.previous, ["raw", "binding"]) || !plain(value.previous.raw) ||
        stable(binding(value.previous.raw)) !== stable(value.previous.binding) ||
        !exact(value.source, ["profile", "enabled", "cloud", "backend"]) ||
        ![true, false, null].includes(value.source.enabled) || !exact(value.source.cloud, ["url", "key"]) ||
        !address(value.source.cloud.url) || typeof value.source.cloud.key !== "string" || !value.source.cloud.key ||
        bytes(value.source.cloud.key) > 16 * 1024 || !address(value.source.backend) || bytes(json(value.source.profile)) > 16 * 1024 ||
        !validOnline(value.online))
      fail("EONLINE_RECOVERY_STORE");
    evidenceOf(value.evidence);
    if ((value.replacement !== null && !validReplacement(value.replacement)) || !Array.isArray(value.attempts) ||
        value.attempts.length > MAX_ARCHIVED_ATTEMPTS || value.attempts.some(attempt =>
          !exact(attempt, ["replacement", "online"]) || !validReplacement(attempt.replacement) || !validOnline(attempt.online)))
      fail("EONLINE_RECOVERY_STORE");
    if (bytes(json(value)) > MAX_RECORD_BYTES) fail("EONLINE_RECOVERY_STORE");
    return value;
  };
  function read() {
    let encrypted;
    try { encrypted = fs.readFileSync(file()); }
    catch (error) { if (error?.code === "ENOENT") return null; fail("EONLINE_RECOVERY_STORE"); }
    try {
      if (!encrypted.length || encrypted.length > MAX_FILE_BYTES) fail("EONLINE_RECOVERY_STORE");
      sealed();
      const raw = safeStorage.decryptString(encrypted);
      if (typeof raw !== "string" || bytes(raw) > MAX_RECORD_BYTES) fail("EONLINE_RECOVERY_STORE");
      return validate(JSON.parse(raw));
    } catch { fail("EONLINE_RECOVERY_STORE"); }
  }
  function pending() {
    try { fs.statSync(file()); return true; }
    catch (error) { return error?.code !== "ENOENT"; }
  }
  const metadata = record => ({ pending: Boolean(record), replacementBound: Boolean(record?.replacement) });
  function write(record) {
    const temporary = `${file()}.tmp-${randomUUID()}`;
    let fd;
    try {
      validate(record); sealed();
      const encrypted = safeStorage.encryptString(json(record));
      if (!Buffer.isBuffer(encrypted) || encrypted.length > MAX_FILE_BYTES) fail("EONLINE_RECOVERY_STORE");
      fd = fs.openSync(temporary, "wx", 0o600);
      fs.writeFileSync(fd, encrypted); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(temporary, file());
      if (stable(read()) !== stable(record)) fail("EONLINE_RECOVERY_STORE");
    } catch { fail("EONLINE_RECOVERY_STORE"); }
    finally {
      if (fd !== undefined) try { fs.closeSync(fd); } catch { /* Preserve the primary failure. */ }
      try { fs.unlinkSync(temporary); } catch { /* Never remove the durable hold. */ }
    }
  }
  function localCurrent(record, requireDisabled = true) {
    let source, previous, active;
    try {
      source = sourceOf();
      previous = binding(terminalStore.lastBinding({ strict: true }));
      active = terminalStore.read({ strict: true });
    } catch { fail("EONLINE_RECOVERY_STORE"); }
    const retained = [record.previous.binding, record.replacement?.binding, ...record.attempts.map(attempt => attempt.replacement.binding)];
    if (!terminalStore.wasProvisioned() || stable(source.profile) !== stable(record.source.profile) ||
        (source.enabled !== false && source.enabled !== record.source.enabled) ||
        !retained.some(known => activationBoundary.sameBinding(previous, known))) fail("EONLINE_RECOVERY_CONTEXT");
    if (active) {
      const actual = binding(active);
      const original = activationBoundary.sameBinding(actual, record.previous.binding);
      const pins = [record.replacement, ...record.attempts.map(attempt => attempt.replacement)].filter(Boolean);
      const replacement = pins.some(pin => activationBoundary.sameBinding(actual, pin.binding) && proof(active) === pin.proof);
      if (!original && !replacement) fail("EONLINE_RECOVERY_CONTEXT");
    }
    if (requireDisabled && source.enabled !== false) fail("EONLINE_RECOVERY_NOT_READY");
    return { source, active };
  }
  function current(record, requireDisabled = true) {
    const state = localCurrent(record, requireDisabled);
    if (!sameOnline(state.source, record.online)) fail("EONLINE_RECOVERY_CONTEXT");
    return state;
  }
  const mustRead = () => { const record = read(); if (!record) fail("EONLINE_RECOVERY_NOT_READY"); return record; };
  function candidate(record, config) {
    let next;
    try { next = binding(config); } catch { fail("EONLINE_RECOVERY_TARGET"); }
    const hash = proof(config);
    if (!hash || address(config.supabaseUrl) !== address(record.online.cloud.url) ||
        address(config.backendUrl) !== address(record.online.backend)) fail("EONLINE_RECOVERY_TARGET");
    return { binding: next, proof: hash };
  }
  return {
    read, pending,
    status: () => { const record = read(); if (record) current(record, false); return metadata(record); },
    begin: ({ evidence } = {}) => {
      try {
        evidenceOf(evidence);
        const existing = read();
        if (existing) {
          const state = localCurrent(existing, false);
          if (existing.replacement) {
            // A later explicit, authorized online recovery may follow native
            // revocation/unpairing. Append the prior pin; never erase it or
            // reinterpret retained local work as accepted or synchronized.
            if (state.active || state.source.enabled !== false) fail("EONLINE_RECOVERY_CONTEXT");
            if (existing.attempts.length >= MAX_ARCHIVED_ATTEMPTS) fail("EONLINE_RECOVERY_LIMIT");
            existing.attempts.push(copy({ replacement: existing.replacement, online: existing.online }));
            existing.replacement = null;
            existing.online = onlineOf(state.source);
            write(existing);
          } else if (!sameOnline(state.source, existing.online)) {
            // Only another explicit, authorized Continue online action can
            // accept corrected settings before a target has been pinned. The
            // original source and evidence remain immutable for later review.
            if (state.active || state.source.enabled !== false) fail("EONLINE_RECOVERY_CONTEXT");
            existing.online = onlineOf(state.source);
            write(existing);
          }
          return metadata(existing);
        }
        if (terminalStore.read({ strict: true }) || !terminalStore.wasProvisioned()) fail("EONLINE_RECOVERY_CONTEXT");
        const raw = copy(terminalStore.lastBinding({ strict: true }));
        const source = sourceOf();
        const record = { version: 1, createdAt: new Date().toISOString(), previous: { raw, binding: binding(raw) },
          source, online: onlineOf(source), evidence: evidenceOf(evidence), replacement: null, attempts: [] };
        write(record);
        return metadata(record);
      } catch (error) { if (Object.hasOwn(messages, error?.code)) throw error; fail("EONLINE_RECOVERY_STORE"); }
    },
    assertOnlineReady: () => { current(mustRead()); },
    bindReplacement: config => {
      const record = mustRead(); current(record);
      const next = candidate(record, config);
      if (record.replacement && stable(record.replacement) !== stable(next)) fail("EONLINE_RECOVERY_TARGET");
      if (!record.replacement) { record.replacement = next; write(record); }
      return metadata(record);
    },
    assertReplacement: config => {
      const record = mustRead(); current(record);
      if (!record.replacement || stable(record.replacement) !== stable(candidate(record, config))) fail("EONLINE_RECOVERY_TARGET");
    },
  };
}

module.exports = { createTerminalOnlineRecovery };
