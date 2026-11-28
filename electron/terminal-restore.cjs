const guard = require("./ipc-guard.cjs");
const activation = require("./verified-activation.cjs");

// Several startup readers may ask for the same repair. They share one proof
// check rather than competing to create the absent native mirror.
const restoring = new WeakMap();

function httpsAddress(value) {
  if (typeof value !== "string" || value.length > 2048) return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return "";
    return url.href.replace(/\/+$/, "");
  } catch { return ""; }
}

function restoreTerminalConfig(raw, dependencies) {
  const { terminalStore, log = () => {} } = dependencies;
  const record = (outcome, stage, code, reason) => {
    try { log(`activation.restore.${outcome}`, { category: "activation", stage, ...(code ? { code } : {}), ...(reason ? { reason } : {}) }); }
    catch { /* Diagnostic storage must not change the registration result. */ }
  };
  const fail = (code, stage, error, reason) => {
    record("refused", stage, code, reason);
    return { ok: false, code, error, ...(reason ? { reason } : {}) };
  };
  let candidate;
  try {
    candidate = guard.terminalConfig(raw);
    if (!candidate) throw new Error("Missing retained registration");
  } catch {
    return Promise.resolve(fail("EBADARG", "validate", "The retained terminal registration is incomplete. Your saved settings have not been changed."));
  }
  const requestKey = JSON.stringify(candidate);
  const pending = restoring.get(terminalStore);
  if (pending) {
    if (pending.key === requestKey) return pending.promise;
    return Promise.resolve(fail("EACTIVATION_CONTEXT_CHANGED", "validate", "A terminal restoration is already running. Retry with this device's current saved registration."));
  }
  const promise = run().finally(() => {
    if (restoring.get(terminalStore)?.promise === promise) restoring.delete(terminalStore);
  });
  restoring.set(terminalStore, { key: requestKey, promise });
  return promise;

  async function run() {
    const { cloudCredentials, configStore, fetchImpl = fetch } = dependencies;
    let stage = "read";
    try {
      const existing = terminalStore.read({ strict: true });
      stage = "validate";
      const requested = activation.binding(candidate);
      if (existing) {
        if (!activation.sameBinding(activation.binding(existing), requested))
          return fail("EACTIVATION_CONTEXT_CHANGED", stage, "A different native terminal registration is already saved. Its credentials have not been changed.");
        record("retained", stage);
        return { ok: true, config: existing };
      }
      const previous = terminalStore.lastBinding({ strict: true });
      const priorBinding = activation.binding(previous);
      const provisioned = terminalStore.wasProvisioned();
      if (!provisioned || !priorBinding || !activation.sameBinding(priorBinding, requested)) {
        // The verifier decides refusal. Diagnostic classification must never
        // turn a rejected binding into an accepted one when fields evolve.
        const reason = !provisioned ? "not_provisioned" : !priorBinding ? "missing_binding" :
          [["id", "token"], ["platform", "platform"], ["mode", "mode"], ["branchId", "branch"]]
            .find(([field]) => String(priorBinding[field] ?? "").trim() !== String(requested[field] ?? "").trim())?.[1] ?? "binding";
        return fail("EACTIVATION_RECOVERY_BINDING", "validate", "The retained registration does not match this device's previous binding. Your saved settings have not been changed.", reason);
      }
      if (!/^[a-f0-9]{64}$/i.test(candidate.deviceBindingProof ?? ""))
        return fail("EACTIVATION_RECOVERY_PROOF", "validate", "The original terminal proof could not be read. Your saved settings have not been changed.");
      const cloud = cloudCredentials.read({ strict: true });
      const backend = httpsAddress(configStore.getStrict("backendUrl"));
      const project = httpsAddress(cloud?.url);
      if (!backend || !project)
        return fail("EACTIVATION_CONTEXT_CHANGED", "validate", "The saved database connection or POS website is unavailable. Your saved settings have not been changed.");
      if (httpsAddress(candidate.supabaseUrl) !== project)
        return fail("EACTIVATION_RECOVERY_PROJECT", "validate", "The retained registration belongs to a different saved database connection. Your saved settings have not been changed.");
      const snapshot = JSON.stringify([activation.binding(previous), cloud, backend]);
      stage = "verify";
      const response = await fetchImpl(`${backend}/api/public/terminal-pairing`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ tokenId: candidate.tokenId, proofHash: candidate.deviceBindingProof }),
        signal: AbortSignal.timeout(8000),
      });
      const result = response.ok ? await response.json() : null;
      // The endpoint can return approved:true for a revoked token. A canonical
      // descriptor is emitted only for claimed rows, including legacy active
      // rows whose is_claimed/claimed_at predates the current status convention.
      if (!result?.approved || !["used", "active"].includes(result.status) ||
          httpsAddress(result.supabaseUrl) !== project)
        return fail("EACTIVATION_RECOVERY_VERIFY", stage, "The POS website could not verify the saved terminal registration. Your saved settings have not been changed. Reconnect and retry.");
      const canonical = activation.canonicalConfig(candidate, result.terminal);
      stage = "recheck";
      const current = terminalStore.read({ strict: true });
      const currentPrevious = terminalStore.lastBinding({ strict: true });
      const currentCloud = cloudCredentials.read({ strict: true });
      const currentBackend = httpsAddress(configStore.getStrict("backendUrl"));
      if (current || !currentPrevious || !terminalStore.wasProvisioned() ||
          JSON.stringify([activation.binding(currentPrevious), currentCloud, currentBackend]) !== snapshot)
        return fail("EACTIVATION_CONTEXT_CHANGED", stage, "The saved registration or connection changed during restoration. Retry with this device's current settings.");
      stage = "write";
      // Preserve the native operator connection. This repair restores only the
      // same proof-bound identity; it never saves a new backend or cloud pair.
      const config = { ...canonical, supabaseUrl: cloud.url, supabaseKey: cloud.key, backendUrl: backend };
      const saved = terminalStore.write(config);
      if (!saved?.ok) throw new Error("Native registration write failed");
      const verified = terminalStore.read({ strict: true });
      if (!activation.sameBinding(activation.binding(verified), requested) ||
          verified.deviceBindingProof !== candidate.deviceBindingProof ||
          httpsAddress(verified.supabaseUrl) !== project || verified.supabaseKey !== cloud.key ||
          httpsAddress(verified.backendUrl) !== backend)
        throw new Error("Native registration read-back failed");
      record("succeeded", stage);
      return { ok: true, config: verified };
    } catch {
      const verification = stage === "verify";
      const code = verification ? "EACTIVATION_RECOVERY_VERIFY" : "EACTIVATION_STORE";
      record("failed", stage, code);
      return { ok: false, code, error: verification
        ? "The POS website could not verify the saved terminal registration. Your saved settings have not been changed. Reconnect and retry."
        : "The saved Windows settings could not be read or restored. They have not been removed. Retry restoring this device's settings." };
    }
  }
}

module.exports = { restoreTerminalConfig };
