const fs = require("node:fs");
const path = require("node:path");
const { createHmac, timingSafeEqual } = require("node:crypto");
function tokenAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", Buffer.from(secret, "base64")).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 100000000).padStart(8, "0");
}
function matchingStep(secret, code, now = Date.now()) {
  if (!/^\d{8}$/.test(code) || Buffer.from(secret, "base64").length < 20) return null;
  const step = Math.floor(now / 30000);
  for (const candidate of [step, step - 1, step + 1])
    if (
      candidate >= 0 &&
      timingSafeEqual(Buffer.from(tokenAt(secret, candidate)), Buffer.from(code))
    )
      return candidate;
  return null;
}
function createApprovalTokenVerifier({
  safeStorage,
  directory,
  terminal,
  branch,
  origin,
  fetchBundle,
}) {
  const file = () => path.join(directory(), "approval-tokens.enc");
  let inflight = null;
  let lastRefresh = 0;
  function read() {
    if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(file())) return null;
    try {
      return JSON.parse(safeStorage.decryptString(fs.readFileSync(file())));
    } catch {
      return null;
    }
  }
  async function refresh(force = false) {
    if (inflight) return inflight;
    if (!force && Date.now() - lastRefresh < 60000) return;
    lastRefresh = Date.now();
    inflight = (async () => {
      const binding = terminal();
      const activeBranch = branch();
      const project = origin();
      if (!binding?.tokenId || !activeBranch || !project || !safeStorage.isEncryptionAvailable())
        return;
      const result = await fetchBundle(binding.tokenId);
      if (
        !result?.ok ||
        result.terminalId !== binding.tokenId ||
        String(result.branchId).toLowerCase() !== activeBranch.toLowerCase()
      )
        return;
      if (
        terminal()?.tokenId !== binding.tokenId ||
        branch() !== activeBranch ||
        origin() !== project
      )
        return;
      const saved = {
        ...result,
        origin: project,
        refreshedAt: Date.now(),
        validUntil: Math.min(Number(result.validUntil), Date.now() + 86400000),
      };
      if (!Array.isArray(saved.entries) || !Number.isFinite(saved.validUntil)) return;
      const target = file();
      const temporary = `${target}.tmp`;
      fs.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(saved)));
      fs.renameSync(temporary, target);
    })()
      .catch(() => {
        /* SQL/PIN trading does not depend on enrollment service availability. */
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }
  function currentBundle(branchId) {
    const bundle = read();
    const now = Date.now();
    if (
      !bundle ||
      bundle.origin !== origin() ||
      bundle.terminalId !== terminal()?.tokenId ||
      String(bundle.branchId).toLowerCase() !== String(branchId).toLowerCase() ||
      !Array.isArray(bundle.entries) ||
      !Number.isFinite(bundle.validUntil) || !Number.isFinite(bundle.refreshedAt) ||
      bundle.validUntil <= now ||
      bundle.refreshedAt > now + 60000
    )
      return null;
    return bundle;
  }
  function identify(code, branchId) {
    const bundle = currentBundle(branchId);
    if (!bundle || !Array.isArray(bundle.entries) || bundle.entries.length > 1000) return null;
    const matches = bundle.entries.filter(entry => matchingStep(entry.secret, code) !== null);
    return matches.length === 1 ? String(matches[0].userId) : null;
  }
  async function verify(pool, userId, code, branchId) {
    const bundle = currentBundle(branchId);
    if (!bundle) return false;
    const now = Date.now();
    for (const entry of bundle.entries) {
      if (String(entry.userId).toLowerCase() !== String(userId).toLowerCase()) continue;
      const step = matchingStep(entry.secret, code, now);
      if (step === null || step <= Number(entry.lastUsedStep)) continue;
      // Durable, atomic high-water mark. A renderer restart cannot reuse a code.
      const result = await pool
        .request()
        .input("key", `approval-totp:${entry.id}`)
        .input("step", step).query(`
        WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544)
        MERGE dbo.pin_attempts WITH (HOLDLOCK) AS target
        USING (SELECT @key AS [key]) AS source ON target.[key]=source.[key]
        WHEN MATCHED AND target.attempts<@step THEN UPDATE SET attempts=@step,updated_at=SYSDATETIMEOFFSET()
        WHEN NOT MATCHED THEN INSERT([key],attempts,window_started_at,created_at,updated_at)
          VALUES(@key,@step,SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET())
        OUTPUT inserted.[key];`);
      if (result.recordset?.length) return true;
    }
    return false;
  }
  return { refresh, verify, identify };
}
module.exports = { tokenAt, matchingStep, createApprovalTokenVerifier };
