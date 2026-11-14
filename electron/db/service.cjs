const { safeError } = require("./errors.cjs");
const { listDatabases } = require("./catalog.cjs");
const { validateDatabase } = require("./health.cjs");
const { StartupActivity } = require("./startup-activity.cjs");

const profileValidationKey = (profile) => JSON.stringify([
  profile?.host ?? "", profile?.instanceName ?? "", Number(profile?.port) || 0,
  profile?.database ?? "", profile?.authMode ?? "", profile?.username ?? "",
  profile?.password ?? "", Boolean(profile?.encrypt), Boolean(profile?.trustServerCertificate),
  Number(profile?.connectionTimeoutMs) || 0, Number(profile?.requestTimeoutMs) || 0,
]);
const publicProfileKey = profile => profileValidationKey({ ...profile, password: "" });

const STATES = new Set([
  "disabled", "enabled_unconfigured", "enabled_connecting", "enabled_validating",
  "enabled_bootstrapping", "enabled_ready", "enabled_degraded", "enabled_error",
]);

class DatabaseService {
  constructor({ secureConfig, manager, publish = () => {}, log = () => {}, validator = validateDatabase, migrate = null, prepareRecoveryMetadata = null, startupIdentity = () => null, startupPaused = () => false, publishStartupActivity = () => {}, localRecoveryPending = () => false, recoveryLocal = null }) {
    this.secureConfig = secureConfig; this.manager = manager; this.publish = publish;
    this.startupPaused = startupPaused;
    this.localRecoveryPending = localRecoveryPending;
    this.recoveryLocal = recoveryLocal; this.verifiedRecoveryTarget = null;
    this.recoveryConnecting = false;
    this.log = log;
    this.validator = validator; this.migrate = migrate;
    this.prepareRecoveryMetadata = prepareRecoveryMetadata; this.recoveryMetadata = null;
    this.validatedProfileKey = null;
    this.validatedRecoveryDatabase = null; this.validationRevision = 0;
    this.connectedSchemaKey = null;
    this.state = this.enabled() ? (this.profile() ? "enabled_connecting" : "enabled_unconfigured") : "disabled";
    this.detail = null; this.lastCheckedAt = null; this.validated = false;
    this.startupActivity = new StartupActivity({
      identity:()=>[this.manager.pool,JSON.stringify(this.profile()),JSON.stringify(startupIdentity())],
      publish:()=>publishStartupActivity(this.startupActivity.snapshot()),
    });
  }
  recoveryPending() { try { return this.localRecoveryPending() === true; } catch { return true; } }
  profile() { try { return this.secureConfig.profile(); } catch { return null; } }
  enabled() { try { return this.secureConfig.enabled() === true; } catch { return false; } }
  canConfigureRecovery() { try { return this.recoveryPending() && this.recoveryLocal?.canConfigure() === true; } catch { return false; } }
  canRestoreAdmitted() {
    return Boolean(this.canConfigureRecovery() && this.recoveryLocal?.hasAdmission() && this.enabled() &&
      !this.recoveryConnecting && this.detail?.code !== "ECURRENT_LOCAL_TARGET");
  }
  verifiedRecoveryPool() {
    if (!this.recoveryPending()) return true;
    try {
      const verified = this.verifiedRecoveryTarget;
      return Boolean(verified && this.canConfigureRecovery() && this.enabled() &&
        verified.pool === this.manager.pool && (this.manager.isConnected?.() ?? Boolean(this.manager.pool)) &&
        verified.key === profileValidationKey(this.secureConfig.credentials()) &&
        verified.publicKey === publicProfileKey(this.manager.profile));
    } catch { return false; }
  }
  disabledAdmittedRecovery() {
    try {
      return Boolean(this.recoveryPending() && this.recoveryLocal?.hasAdmission() && this.canConfigureRecovery() &&
        this.secureConfig.enabled() === false && !(this.manager.isConnected?.() ?? Boolean(this.manager.pool)));
    } catch { return false; }
  }
  presentingAdmittedRecovery() {
    try { return Boolean(this.recoveryLocal?.hasAdmission() && this.canConfigureRecovery() && this.secureConfig.enabled() === true); }
    catch { return false; }
  }
  recoveryHeld() { return this.recoveryPending() && !this.disabledAdmittedRecovery() && (!this.validated || !this.verifiedRecoveryPool()); }
  recoveryError(error) {
    return /^ECURRENT_LOCAL_[A-Z_]{1,40}$/.test(String(error?.code ?? ""))
      ? { ok: false, code: error.code, error: String(error.message).slice(0, 500) }
      : safeError(error);
  }
  validationManagerFor(pool, profile, assertCurrent) {
    const key = profileValidationKey(profile), bound = Object.create(this.manager);
    bound.pool = pool; bound.profile = { ...profile, password: undefined };
    bound.temporary = async (requested, database, work) => {
      assertCurrent();
      if (database !== profile.database || profileValidationKey(requested) !== key)
        throw Object.assign(new Error("The schema validation target changed."), { code: "ECURRENT_LOCAL_CONTEXT" });
      const result = await work(pool); assertCurrent(); return result;
    };
    return bound;
  }
  async verifyRecoveryPool(profile) {
    if (!this.recoveryPending()) return;
    const pool = this.manager.pool, key = profileValidationKey(profile);
    const assertCurrent = () => {
      if (!pool || this.manager.pool !== pool || !this.canConfigureRecovery() ||
          publicProfileKey(profile) !== publicProfileKey(this.manager.profile) ||
          key !== profileValidationKey(this.secureConfig.credentials()))
        throw Object.assign(new Error("The current local connection changed during verification."), { code: "ECURRENT_LOCAL_CONTEXT" });
    };
    assertCurrent(); await this.recoveryLocal.assertPool(pool, profile, { assertCurrent }); assertCurrent();
    this.verifiedRecoveryTarget = { pool, key, publicKey: publicProfileKey(profile) };
  }
  snapshot() {
    const held = this.recoveryHeld();
    const restoringAdmitted = held && this.presentingAdmittedRecovery();
    const locallyConnected = this.manager.isConnected?.() ?? Boolean(this.manager.pool);
    return { state: held && !restoringAdmitted ? "disabled" : this.state, enabled: (!held || restoringAdmitted) && this.enabled(), configured: Boolean(this.profile()),
      connected: !held && locallyConnected, tradingReady: !held && locallyConnected && this.validated, profile: this.profile(), detail: this.detail,
      ...(held ? { localRecoveryPending: true } : {}),
      ...(this.recoveryPending() ? { retainedLocalRecoveryPending: true } : {}),
      lastCheckedAt: this.lastCheckedAt, startupActivity:this.startupActivity.snapshot(), startupPaused:this.startupPaused(), recoveryMetadata:this.recoveryMetadata };
  }
  heldFailure() {
    return { ok: false, code: "ELOCAL_RECOVERY_PENDING", error: "Use the online database while the previous local setup is awaiting verified recovery. Saved local work has been kept." };
  }
  holdLocalRecovery() {
    this.verifiedRecoveryTarget = null;
    this.validated = false; this.connectedSchemaKey = null; this.validatedProfileKey = null;
    this.validatedRecoveryDatabase = null; this.validationRevision++;
    return this.transition("disabled", this.heldFailure());
  }
  async prepareOptionalRecovery(profile) {
    if (this.recoveryPending() && !this.verifiedRecoveryPool()) return false;
    if (!this.prepareRecoveryMetadata) return true;
    const pool = this.manager.pool, key = profileValidationKey(profile);
    const current = () => (!this.recoveryPending() || this.verifiedRecoveryPool()) && pool === this.manager.pool && this.enabled() && profileValidationKey(this.secureConfig.credentials()) === key;
    const assertCurrent = () => { if (!current()) throw Object.assign(new Error("The database preparation target changed."), { code:"ERECOVERY_METADATA_CONTEXT" }); };
    let result;
    try { assertCurrent(); result = await this.prepareRecoveryMetadata({profile,pool,assertCurrent}); }
    catch(error) { result = {available:false,state:"held",code:/^ERECOVERY_METADATA_[A-Z_]{1,40}$/.test(String(error?.code??""))?error.code:"ERECOVERY_METADATA_PREPARATION",reason:"Recovery support requires attention. Existing local work is preserved."}; }
    // A stale optional operation must not publish readiness or close a newly
    // selected pool. The normal new-source startup owns its own state.
    if (!current()) return false;
    this.recoveryMetadata = result;
    return true;
  }
  beginStartupActivity(){return this.startupActivity.begin();}
  transition(state, detail = null) {
    if (!STATES.has(state)) throw new Error(`Unknown database state: ${state}`);
    this.state = state; this.detail = detail;
    const snapshot = this.snapshot();
    this.log("database.state", { state, connected: snapshot.connected, code: detail?.code, stage: detail?.stage, message: detail?.error });
    this.publish(snapshot); return snapshot;
  }
  async setEnabled(value) {
    if (this.recoveryHeld() && !this.canConfigureRecovery()) return this.holdLocalRecovery();
    if (this.recoveryPending() && !this.recoveryLocal?.hasAdmission()) return this.holdLocalRecovery();
    if (this.recoveryPending()) { this.validatedProfileKey = null; this.validatedRecoveryDatabase = null; this.validationRevision++; }
    this.secureConfig.setEnabled(value === true);
    if (!value) { this.verifiedRecoveryTarget = null; this.connectedSchemaKey = null; await this.manager.close(); this.validated = false; return this.transition("disabled"); }
    if (!this.secureConfig.profile()) return this.transition("enabled_unconfigured");
    return this.restore();
  }
  // Both probes use their supplied profile only through temporary master pools;
  // the retained profile, active business pool and recovery hold stay unchanged.
  async testServer(profile) { return this.manager.testServer(profile); }
  async databases(profile) { return listDatabases(this.manager, profile); }
  async health() {
    if (this.recoveryPending() && !this.verifiedRecoveryPool()) return { ...this.heldFailure(), connected: false, state: this.snapshot() };
    if (!(this.manager.isConnected?.() ?? this.manager.pool)) return { ok: false, connected: false, state: this.snapshot() };
    try { const started=Date.now(); const result=await this.manager.pool.request().query("SELECT DB_NAME() database_name, CHANGE_TRACKING_CURRENT_VERSION() change_tracking_version;"); return { ok:true,connected:true,latencyMs:Date.now()-started,...result.recordset?.[0],state:this.snapshot() }; }
    catch(error){const safe=safeError(error);this.manager.markFaulted?.();this.validated=false;this.transition("enabled_degraded",safe);return {...safe,connected:false,state:this.snapshot()};}
  }
  async schemaStatus() { if(this.recoveryHeld())return this.heldFailure();const profile=this.secureConfig.credentials(); return profile ? validateDatabase(this.manager,profile) : {ok:false,code:"EDATABASE",error:"No database is configured."}; }
  async validate(profile) {
    if (this.recoveryHeld() && !this.canConfigureRecovery()) return this.heldFailure();
    const recovering = this.recoveryPending(), revision = ++this.validationRevision, key = profileValidationKey(profile);
    this.validatedRecoveryDatabase = null; this.validatedProfileKey = null;
    let validation;
    if (recovering) {
      try {
        const assertCurrent = () => {
          if (revision !== this.validationRevision || key !== profileValidationKey(profile) || !this.canConfigureRecovery())
            throw Object.assign(new Error("The active local recovery context changed."), { code: "ECURRENT_LOCAL_CONTEXT" });
        };
        await this.manager.temporary(profile, profile.database, async pool => {
          assertCurrent();
          validation = await this.validator(this.validationManagerFor(pool, profile, assertCurrent), profile);
          assertCurrent();
          if (validation.ok && validation.ready) {
            const inspected = await this.recoveryLocal.inspect(pool, profile, { schemaReady: true, assertCurrent });
            assertCurrent();
            if (!inspected?.database) throw Object.assign(new Error("The validated local identity was not returned."), { code: "ECURRENT_LOCAL_VERIFY" });
            this.validatedRecoveryDatabase = { ...inspected.database };
          }
        });
        assertCurrent();
      } catch (error) {
        if (revision === this.validationRevision) { this.validatedProfileKey = null; this.validatedRecoveryDatabase = null; }
        return this.recoveryError(error);
      }
    } else validation = await this.validator(this.manager, profile);
    this.validatedProfileKey = validation.ok && validation.ready
      ? profileValidationKey(profile)
      : null;
    return validation;
  }
  async revalidateConnected() {
    if (this.recoveryPending() && !this.verifiedRecoveryPool()) return this.holdLocalRecovery();
    this.connectedSchemaKey = null;
    const profile = this.secureConfig.credentials();
    if (!profile) return this.transition("enabled_unconfigured");
    const pool = this.manager.pool;
    const assertCurrent = () => {
      if (pool !== this.manager.pool || !this.verifiedRecoveryPool())
        throw Object.assign(new Error("The current local pool changed during schema validation."), { code: "ECURRENT_LOCAL_CONTEXT" });
    };
    if (this.recoveryPending()) await this.verifyRecoveryPool(profile);
    const validation = await this.validator(this.recoveryPending() ? this.validationManagerFor(pool, profile, assertCurrent) : this.manager, profile);
    if (!validation.ok || !validation.ready) {
      this.validated = false;
      return this.transition("enabled_error", validation);
    }
    if (!(this.manager.isConnected?.() ?? this.manager.pool)) await this.manager.open(profile);
    await this.verifyRecoveryPool(profile);
    this.validated = false;
    if (!await this.prepareOptionalRecovery(profile)) return this.snapshot();
    this.validated = true;
    this.connectedSchemaKey = profileValidationKey(profile);
    this.lastCheckedAt = new Date().toISOString();
    return this.transition("enabled_bootstrapping");
  }
  beginMigration() {
    if (this.recoveryHeld()) return this.holdLocalRecovery();
    this.connectedSchemaKey = null;
    this.validatedProfileKey = null; this.validatedRecoveryDatabase = null; this.validationRevision++;
    this.validated = false;
    return this.transition("enabled_validating", { status: "applying_migration" });
  }
  migrationFailed(detail) {
    this.connectedSchemaKey = null;
    this.validated = false;
    return this.transition("enabled_error", { ...detail, status: "migration_required" });
  }
  async saveAndConnect(profile) {
    if (this.recoveryHeld() && !this.canConfigureRecovery()) return this.heldFailure();
    if (this.recoveryPending() && this.recoveryConnecting) return { ok: false, code: "ECURRENT_LOCAL_BUSY", error: "Another local connection check is running. Retry when it finishes." };
    if (this.validatedProfileKey !== profileValidationKey(profile)) {
      return {
        ok: false,
        code: "EVALIDATION_REQUIRED",
        error: "Validate this exact database connection before saving it.",
        hint: "Return to Validate, complete validation, then connect without changing the connection details.",
      };
    }
    const recovering = this.recoveryPending();
    const expectedDatabase = this.validatedRecoveryDatabase;
    if (recovering && !expectedDatabase) return { ok: false, code: "EVALIDATION_REQUIRED", error: "Validate this exact local database again before saving it." };
    if (recovering) this.recoveryConnecting = true;
    let openedPool;
    try {
      this.verifiedRecoveryTarget = null;
      if (recovering) { this.validatedProfileKey = null; this.validatedRecoveryDatabase = null; this.validationRevision++; }
      this.validated = false;
      this.transition("enabled_connecting");
      await this.manager.open(profile);
      openedPool = this.manager.pool;
      if (recovering) {
        const assertCurrent = () => { if (openedPool !== this.manager.pool || !this.canConfigureRecovery()) throw Object.assign(new Error("The local setup changed during admission."), { code: "ECURRENT_LOCAL_CONTEXT" }); };
        const validation = await this.validator(this.validationManagerFor(openedPool, profile, assertCurrent), profile);
        assertCurrent();
        if (!validation.ok) throw Object.assign(new Error(validation.error ?? "The opened local database schema could not be checked."), { code: validation.code ?? "ECONNECTION" });
        if (!validation.ready) throw Object.assign(new Error("The opened local database no longer has the validated schema."), { code: "ECURRENT_LOCAL_SCHEMA" });
        await this.recoveryLocal.admit(openedPool, profile, { schemaReady: true, assertCurrent, expectedDatabase });
      }
      const saved = this.secureConfig.save(profile);
      await this.verifyRecoveryPool(profile);
      if (!await this.prepareOptionalRecovery(profile)) return {ok:false,code:"ERECOVERY_METADATA_CONTEXT",state:this.snapshot()};
      this.validated = true;
      this.connectedSchemaKey = profileValidationKey(profile);
      this.validatedProfileKey = null;
      this.lastCheckedAt = new Date().toISOString();
      this.transition("enabled_bootstrapping");
      return { ok: true, profile: saved, state: this.snapshot() };
    } catch (error) {
      this.verifiedRecoveryTarget = null;
      this.validated = false;
      if (recovering && openedPool && openedPool === this.manager.pool) await this.manager.close().catch(() => undefined);
      const safe = this.recoveryError(error);
      this.transition("enabled_error", safe);
      return safe;
    } finally { if (recovering) this.recoveryConnecting = false; }
  }
  async disconnect() { this.verifiedRecoveryTarget = null; this.connectedSchemaKey = null; this.validatedProfileKey = null; this.validatedRecoveryDatabase = null; this.validationRevision++; await this.manager.close(); this.validated = false; return this.transition(this.enabled() ? "enabled_degraded" : "disabled"); }
  async remove() { if (this.recoveryPending()) return { ok: false, code: "ECURRENT_LOCAL_RETAINED", error: "Keep the current local connection and its saved work. Disable local SQL instead of removing it." };this.connectedSchemaKey = null; await this.manager.close(); this.validated = false; this.secureConfig.remove(); return this.transition("disabled"); }
  async restore({ reuseValidation = false } = {}) {
    if (this.recoveryPending() && (!this.canConfigureRecovery() || !this.recoveryLocal?.hasAdmission())) return this.holdLocalRecovery();
    try {
      if (!this.enabled()) return this.transition("disabled");
      const profile = this.secureConfig.credentials();
      if (!profile) return this.transition("enabled_unconfigured");
      // Verify the physical admitted database before any automatic migration,
      // optional metadata preparation or bootstrap can write into it.
      if (this.recoveryPending()) {
        this.validatedProfileKey = null; this.validatedRecoveryDatabase = null; this.validationRevision++;
        this.validated = false; this.verifiedRecoveryTarget = null;
        this.transition("enabled_connecting", { phase: "verifying_current_target" });
        await this.manager.open(profile); await this.verifyRecoveryPool(profile);
      }
      // Only automatic reconnects may reuse this process's successful schema
      // check. Explicit setup/repair and every app restart still validate.
      if (reuseValidation && this.connectedSchemaKey === profileValidationKey(profile)) {
        if (this.snapshot().tradingReady) return this.snapshot();
        this.validated = false;
        this.transition("enabled_connecting", { phase: "reconnecting" });
        await this.manager.open(profile);
        await this.verifyRecoveryPool(profile);
        if (!await this.prepareOptionalRecovery(profile)) return this.snapshot();
        this.validated = true;
        this.lastCheckedAt = new Date().toISOString();
        return this.transition("enabled_ready", { phase: "reconnected" });
      }
      this.connectedSchemaKey = null;
      this.validated = false;
      this.transition("enabled_validating");
      let validation = await this.validator(this.manager, profile);
      if (validation.ok && !validation.ready && validation.status === "migration_required" &&
          validation.migrationHistoryPresent && this.migrate) {
        this.transition("enabled_validating", { status: "applying_migration" });
        // The recovery profile is admitted to the verified live pool. Passing
        // it to the migration callback would open a different temporary pool.
        const recovering = this.recoveryPending(), migrationPool = this.manager.pool;
        if (recovering) {
          await this.verifyRecoveryPool(profile);
          if (migrationPool !== this.manager.pool) throw Object.assign(new Error("The migration target changed."), { code: "ECURRENT_LOCAL_CONTEXT" });
        }
        const migrated = await this.migrate(recovering ? null : profile);
        if (!migrated.ok) return this.transition("enabled_error", { ...migrated, status: "migration_required" });
        validation = await this.validator(this.manager, profile);
      }
      if (!validation.ok || !validation.ready) {
        if(validation.ok&&validation.status==="migration_required"&&!(this.manager.isConnected?.()??this.manager.pool)){
          await this.manager.open(profile);
        }else if(validation.status!=="migration_required"){
          await this.manager.close().catch(() => undefined);
        }
        this.validated=false;
        return this.transition("enabled_error", validation);
      }
      this.transition("enabled_connecting");
      await this.manager.open(profile);
      await this.verifyRecoveryPool(profile);
      if (!await this.prepareOptionalRecovery(profile)) return this.snapshot();
      this.validated = true;
      this.connectedSchemaKey = profileValidationKey(profile);
      this.lastCheckedAt = new Date().toISOString();
      return this.transition("enabled_bootstrapping");
    } catch (error) {
      await this.manager.close().catch(() => undefined);
      this.verifiedRecoveryTarget = null;
      this.validated = false;
      return this.transition("enabled_error", this.recoveryError(error));
    }
  }
  markReady(detail = null) { return this.recoveryHeld() ? this.holdLocalRecovery() : this.transition("enabled_ready", detail); }
  markDegraded(detail) { return this.transition("enabled_degraded", detail); }
}

module.exports = { DatabaseService, STATES };
