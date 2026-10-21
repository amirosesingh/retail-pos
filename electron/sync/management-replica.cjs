// Branch checkpoints and snapshot jobs stay separate; a failed branch resumes on the next pass.
class ManagementReplica {
  constructor({ cloud, databaseService, connectionManager, lifecycle, jobs, coordinator }) {
    Object.assign(this, { cloud, databaseService, connectionManager, lifecycle, jobs, coordinator });
    this.active = null;
    this.failures = 0;
    this.retryAt = 0;
  }
  resetRetry() { this.failures = 0; this.retryAt = 0; }
  run() {
    if (this.active) return this.active;
    if (Date.now() < this.retryAt) return Promise.resolve({ ok: false, deferred: true });
    this.active = this.coordinator.withExclusive(() => this.download()).then(result => {
      if (result.ok) this.resetRetry();
      return result;
    }).catch(error => {
      const status = Number(error?.status);
      // Revoked or invalid identities need registration/configuration repair.
      const permanent = [400, 401, 403, 404, 422].includes(status);
      const cap = Math.min(900_000, 60_000 * 2 ** Math.min(this.failures++, 4));
      this.retryAt = permanent ? Infinity : Date.now() + cap / 2 + Math.random() * cap / 2;
      throw error;
    }).finally(() => { this.active = null; });
    return this.active;
  }
  async download() {
    if (this.coordinator.paused) return { ok: false, paused: true, code: "ESYNC_PAUSED" };
    const state = this.databaseService.snapshot();
    if (!state.enabled || !state.configured) return { ok: true, skipped: true };
    if (!this.connectionManager.isConnected()) {
      const restored = await this.databaseService.restore({ reuseValidation: true });
      if (!restored.connected || !restored.tradingReady) return { ok: false, error: "Local SQL Server is not ready for management downloads." };
    }
    const scope = await this.cloud.managementBranches();
    if (!scope.ok || !Array.isArray(scope.branches)) throw new Error("Invalid management synchronization scope");
    const branches = [...new Set(scope.branches.map(row => row.id).filter(id => typeof id === "string" && id.trim()))];
    for (const branchId of branches) {
      if (this.coordinator.paused) return { ok: false, paused: true, code: "ESYNC_PAUSED" };
      const historyDays = 7300;
      const active = await this.jobs.active();
      if (active && active.branch_id === branchId && active.job_type === this.lifecycle.bootstrapType(historyDays))
        await this.lifecycle.bootstrap(branchId, historyDays, active);
      const completed = await this.jobs.completed(this.lifecycle.bootstrapType(historyDays), branchId);
      if (!completed) await this.lifecycle.bootstrap(branchId, historyDays);
      const result = await this.coordinator.runNow({ branchId, pullOnly: true, skipMembership: true, batchSize: 100 });
      if (!result.ok) throw Object.assign(new Error(result.error || "Management download failed"), {
        code: result.code, status: result.credentialsInvalid ? 403 : undefined,
      });
    }
    return { ok: true, branches: branches.length };
  }
}
module.exports = { ManagementReplica };
