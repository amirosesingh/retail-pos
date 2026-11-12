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

const STATES = new Set([
  "disabled", "enabled_unconfigured", "enabled_connecting", "enabled_validating",
  "enabled_bootstrapping", "enabled_ready", "enabled_degraded", "enabled_error",
]);

class DatabaseService {
  constructor({ secureConfig, manager, publish = () => {}, log = () => {}, validator = validateDatabase, migrate = null, prepareRecoveryMetadata = null, startupIdentity = () => null, startupPaused = () => false, publishStartupActivity = () => {}, localRecoveryPending = () => false }) {
    this.secureConfig = secureConfig; this.manager = manager; this.publish = publish;
    this.startupPaused = startupPaused;
    this.localRecoveryPending = localRecoveryPending;
    this.log = log;
    this.validator = validator; this.migrate = migrate;
    this.prepareRecoveryMetadata = prepareRecoveryMetadata; this.recoveryMetadata = null;
    this.validatedProfileKey = null;
    this.connectedSchemaKey = null;
    this.state = secureConfig.enabled() ? (secureConfig.profile() ? "enabled_connecting" : "enabled_unconfigured") : "disabled";
    this.detail = null; this.lastCheckedAt = null; this.validated = false;
    this.startupActivity = new StartupActivity({
      identity:()=>[this.manager.pool,JSON.stringify(this.secureConfig.profile()),JSON.stringify(startupIdentity())],
      publish:()=>publishStartupActivity(this.startupActivity.snapshot()),
    });
  }
  snapshot() {
    const held = this.localRecoveryPending();
    const locallyConnected = this.manager.isConnected?.() ?? Boolean(this.manager.pool);
    return { state: held ? "disabled" : this.state, enabled: !held && this.secureConfig.enabled(), configured: Boolean(this.secureConfig.profile()),
      connected: !held && locallyConnected, tradingReady: !held && locallyConnected && this.validated, profile: this.secureConfig.profile(), detail: this.detail,
      ...(held ? { localRecoveryPending: true } : {}),
      lastCheckedAt: this.lastCheckedAt, startupActivity:this.startupActivity.snapshot(), startupPaused:this.startupPaused(), recoveryMetadata:this.recoveryMetadata };
  }
  heldFailure() {
    return { ok: false, code: "ELOCAL_RECOVERY_PENDING", error: "Use the online database while the previous local setup is awaiting verified recovery. Saved local work has been kept." };
  }
  holdLocalRecovery() {
    this.validated = false; this.connectedSchemaKey = null; this.validatedProfileKey = null;
    return this.transition("disabled", this.heldFailure());
  }
  async prepareOptionalRecovery(profile) {
    if (this.localRecoveryPending()) return false;
    if (!this.prepareRecoveryMetadata) return true;
    const pool = this.manager.pool, key = profileValidationKey(profile);
    const current = () => !this.localRecoveryPending() && pool === this.manager.pool && this.secureConfig.enabled() && profileValidationKey(this.secureConfig.credentials()) === key;
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
    if (this.localRecoveryPending()) return this.holdLocalRecovery();
    this.secureConfig.setEnabled(value === true);
    if (!value) { this.connectedSchemaKey = null; await this.manager.close(); this.validated = false; return this.transition("disabled"); }
    if (!this.secureConfig.profile()) return this.transition("enabled_unconfigured");
    return this.restore();
  }
  async testServer(profile) { return this.localRecoveryPending() ? this.heldFailure() : this.manager.testServer(profile); }
  async databases(profile) { return this.localRecoveryPending() ? this.heldFailure() : listDatabases(this.manager, profile); }
  async health() {
    if (!(this.manager.isConnected?.() ?? this.manager.pool)) return { ok: false, connected: false, state: this.snapshot() };
    try { const started=Date.now(); const result=await this.manager.pool.request().query("SELECT DB_NAME() database_name, CHANGE_TRACKING_CURRENT_VERSION() change_tracking_version;"); return { ok:true,connected:true,latencyMs:Date.now()-started,...result.recordset?.[0],state:this.snapshot() }; }
    catch(error){const safe=safeError(error);this.manager.markFaulted?.();this.validated=false;this.transition("enabled_degraded",safe);return {...safe,connected:false,state:this.snapshot()};}
  }
  async schemaStatus() { if(this.localRecoveryPending())return this.heldFailure();const profile=this.secureConfig.credentials(); return profile ? validateDatabase(this.manager,profile) : {ok:false,code:"EDATABASE",error:"No database is configured."}; }
  async validate(profile) {
    if (this.localRecoveryPending()) return this.heldFailure();
    const validation = await this.validator(this.manager, profile);
    this.validatedProfileKey = validation.ok && validation.ready
      ? profileValidationKey(profile)
      : null;
    return validation;
  }
  async revalidateConnected() {
    if (this.localRecoveryPending()) return this.holdLocalRecovery();
    this.connectedSchemaKey = null;
    const profile = this.secureConfig.credentials();
    if (!profile) return this.transition("enabled_unconfigured");
    const validation = await this.validator(this.manager, profile);
    if (!validation.ok || !validation.ready) {
      this.validated = false;
      return this.transition("enabled_error", validation);
    }
    if (!(this.manager.isConnected?.() ?? this.manager.pool)) await this.manager.open(profile);
    this.validated = false;
    if (!await this.prepareOptionalRecovery(profile)) return this.snapshot();
    this.validated = true;
    this.connectedSchemaKey = profileValidationKey(profile);
    this.lastCheckedAt = new Date().toISOString();
    return this.transition("enabled_bootstrapping");
  }
  beginMigration() {
    if (this.localRecoveryPending()) return this.holdLocalRecovery();
    this.connectedSchemaKey = null;
    this.validated = false;
    return this.transition("enabled_validating", { status: "applying_migration" });
  }
  migrationFailed(detail) {
    this.connectedSchemaKey = null;
    this.validated = false;
    return this.transition("enabled_error", { ...detail, status: "migration_required" });
  }
  async saveAndConnect(profile) {
    if (this.localRecoveryPending()) return this.heldFailure();
    if (this.validatedProfileKey !== profileValidationKey(profile)) {
      return {
        ok: false,
        code: "EVALIDATION_REQUIRED",
        error: "Validate this exact database connection before saving it.",
        hint: "Return to Validate, complete validation, then connect without changing the connection details.",
      };
    }
    try {
      this.validated = false;
      this.transition("enabled_connecting");
      await this.manager.open(profile);
      const saved = this.secureConfig.save(profile);
      if (!await this.prepareOptionalRecovery(profile)) return {ok:false,code:"ERECOVERY_METADATA_CONTEXT",state:this.snapshot()};
      this.validated = true;
      this.connectedSchemaKey = profileValidationKey(profile);
      this.validatedProfileKey = null;
      this.lastCheckedAt = new Date().toISOString();
      this.transition("enabled_bootstrapping");
      return { ok: true, profile: saved, state: this.snapshot() };
    } catch (error) {
      this.validated = false;
      const safe = safeError(error);
      this.transition("enabled_error", safe);
      return safe;
    }
  }
  async disconnect() { this.connectedSchemaKey = null; await this.manager.close(); this.validated = false; return this.transition(this.secureConfig.enabled() ? "enabled_degraded" : "disabled"); }
  async remove() { this.connectedSchemaKey = null; await this.manager.close(); this.validated = false; this.secureConfig.remove(); return this.transition("disabled"); }
  async restore({ reuseValidation = false } = {}) {
    if (this.localRecoveryPending()) return this.holdLocalRecovery();
    if (!this.secureConfig.enabled()) return this.transition("disabled");
    const profile = this.secureConfig.credentials();
    if (!profile) return this.transition("enabled_unconfigured");
    try {
      // Only automatic reconnects may reuse this process's successful schema
      // check. Explicit setup/repair and every app restart still validate.
      if (reuseValidation && this.connectedSchemaKey === profileValidationKey(profile)) {
        if (this.snapshot().tradingReady) return this.snapshot();
        this.validated = false;
        this.transition("enabled_connecting", { phase: "reconnecting" });
        await this.manager.open(profile);
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
        const migrated = await this.migrate(profile);
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
      if (!await this.prepareOptionalRecovery(profile)) return this.snapshot();
      this.validated = true;
      this.connectedSchemaKey = profileValidationKey(profile);
      this.lastCheckedAt = new Date().toISOString();
      return this.transition("enabled_bootstrapping");
    } catch (error) {
      await this.manager.close().catch(() => undefined);
      this.validated = false;
      return this.transition("enabled_error", safeError(error));
    }
  }
  markReady(detail = null) { return this.localRecoveryPending() ? this.holdLocalRecovery() : this.transition("enabled_ready", detail); }
  markDegraded(detail) { return this.transition("enabled_degraded", detail); }
}

module.exports = { DatabaseService, STATES };
