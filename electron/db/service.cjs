const { safeError } = require("./errors.cjs");
const { listDatabases } = require("./catalog.cjs");
const { validateDatabase } = require("./health.cjs");

const STATES = new Set([
  "disabled", "enabled_unconfigured", "enabled_connecting", "enabled_validating",
  "enabled_bootstrapping", "enabled_ready", "enabled_degraded", "enabled_error",
]);

class DatabaseService {
  constructor({ secureConfig, manager, publish = () => {}, log = () => {}, validator = validateDatabase }) {
    this.secureConfig = secureConfig; this.manager = manager; this.publish = publish;
    this.log = log;
    this.validator = validator;
    this.state = secureConfig.enabled() ? (secureConfig.profile() ? "enabled_connecting" : "enabled_unconfigured") : "disabled";
    this.detail = null; this.lastCheckedAt = null; this.validated = false;
  }
  snapshot() {
    const locallyConnected = this.manager.isConnected?.() ?? Boolean(this.manager.pool);
    return { state: this.state, enabled: this.secureConfig.enabled(), configured: Boolean(this.secureConfig.profile()),
      connected: locallyConnected, tradingReady: locallyConnected && this.validated, profile: this.secureConfig.profile(), detail: this.detail,
      lastCheckedAt: this.lastCheckedAt };
  }
  transition(state, detail = null) {
    if (!STATES.has(state)) throw new Error(`Unknown database state: ${state}`);
    this.state = state; this.detail = detail;
    const snapshot = this.snapshot();
    this.log("database.state", { state, connected: snapshot.connected, code: detail?.code, stage: detail?.stage, message: detail?.error });
    this.publish(snapshot); return snapshot;
  }
  async setEnabled(value) {
    this.secureConfig.setEnabled(value === true);
    if (!value) { await this.manager.close(); this.validated = false; return this.transition("disabled"); }
    if (!this.secureConfig.profile()) return this.transition("enabled_unconfigured");
    return this.restore();
  }
  async testServer(profile) { return this.manager.testServer(profile); }
  async databases(profile) { return listDatabases(this.manager, profile); }
  async health() {
    if (!(this.manager.isConnected?.() ?? this.manager.pool)) return { ok: false, connected: false, state: this.snapshot() };
    try { const started=Date.now(); const result=await this.manager.pool.request().query("SELECT DB_NAME() database_name, CHANGE_TRACKING_CURRENT_VERSION() change_tracking_version;"); return { ok:true,connected:true,latencyMs:Date.now()-started,...result.recordset?.[0],state:this.snapshot() }; }
    catch(error){const safe=safeError(error);this.manager.markFaulted?.();this.validated=false;this.transition("enabled_degraded",safe);return {...safe,connected:false,state:this.snapshot()};}
  }
  async schemaStatus() { const profile=this.secureConfig.credentials(); return profile ? validateDatabase(this.manager,profile) : {ok:false,code:"EDATABASE",error:"No database is configured."}; }
  async validate(profile) {
    return validateDatabase(this.manager, profile);
  }
  async revalidateConnected() {
    const profile = this.secureConfig.credentials();
    if (!profile) return this.transition("enabled_unconfigured");
    const validation = await this.validator(this.manager, profile);
    if (!validation.ok || !validation.ready) {
      this.validated = false;
      return this.transition("enabled_error", validation);
    }
    if (!(this.manager.isConnected?.() ?? this.manager.pool)) await this.manager.open(profile);
    this.validated = true;
    this.lastCheckedAt = new Date().toISOString();
    return this.transition("enabled_bootstrapping");
  }
  beginMigration() {
    this.validated = false;
    return this.transition("enabled_validating", { status: "applying_migration" });
  }
  migrationFailed(detail) {
    this.validated = false;
    return this.transition("enabled_error", { ...detail, status: "migration_required" });
  }
  async saveAndConnect(profile) {
    try {
      await this.manager.close();
      this.validated = false;
      this.transition("enabled_validating");
      const validation = await this.validator(this.manager, profile);
      if (!validation.ok || !validation.ready) {
        this.transition("enabled_error", validation);
        return validation;
      }
      this.transition("enabled_connecting");
      await this.manager.open(profile);
      this.validated = true;
      const saved = this.secureConfig.save(profile);
      this.lastCheckedAt = new Date().toISOString();
      this.transition("enabled_bootstrapping");
      return { ok: true, profile: saved, state: this.snapshot() };
    } catch (error) {
      await this.manager.close().catch(() => undefined);
      this.validated = false;
      const safe = safeError(error);
      this.transition("enabled_error", safe);
      return safe;
    }
  }
  async disconnect() { await this.manager.close(); this.validated = false; return this.transition(this.secureConfig.enabled() ? "enabled_degraded" : "disabled"); }
  async remove() { await this.manager.close(); this.validated = false; this.secureConfig.remove(); return this.transition("disabled"); }
  async restore() {
    if (!this.secureConfig.enabled()) return this.transition("disabled");
    const profile = this.secureConfig.credentials();
    if (!profile) return this.transition("enabled_unconfigured");
    try {
      this.validated = false;
      this.transition("enabled_validating");
      const validation = await this.validator(this.manager, profile);
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
      this.validated = true;
      this.lastCheckedAt = new Date().toISOString();
      return this.transition("enabled_bootstrapping");
    } catch (error) {
      await this.manager.close().catch(() => undefined);
      this.validated = false;
      return this.transition("enabled_error", safeError(error));
    }
  }
  markReady(detail = null) { return this.transition("enabled_ready", detail); }
  markDegraded(detail) { return this.transition("enabled_degraded", detail); }
}

module.exports = { DatabaseService, STATES };
