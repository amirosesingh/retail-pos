const { randomUUID } = require("node:crypto");

function nextBatchSize(current, outcome) {
  const size = Math.max(100, Math.min(2000, Number(current) || 500));
  if (outcome === "timeout" || outcome === "oversized") return Math.max(100, Math.floor(size / 2));
  if (outcome === "success") return Math.min(2000, size + 100);
  return size;
}

class JobManager {
  constructor(repository, { publish = () => {}, maxBytes = 6 * 1024 * 1024 } = {}) {
    this.repository = repository; this.publish = publish; this.maxBytes = maxBytes; this.running = null; this.paused = false; this.lastPublishedAt = 0;
  }
  async resumeInterrupted(handler) {
    const job = await this.repository.active();
    if (!job || this.running) return job;
    return this.run(job.job_type, handler, job);
  }
  emit(job, force = false) {
    const now = Date.now();
    if (force || now - this.lastPublishedAt >= 250) { this.lastPublishedAt = now; this.publish({ ...job }); }
  }
  async waitWhilePaused(job, checkpoint) {
    if (!this.paused) return;
    await checkpoint({ status: "paused" });
    while (this.paused) await new Promise((resolve) => setTimeout(resolve, 100));
    await checkpoint({ status: "running" });
  }
  async run(type, handler, existing = null, metadata = {}, options = {}) {
    if (this.running) return this.running;
    const job = existing ?? { job_id: randomUUID(), job_type: type, status: "queued", organization_id: metadata.organizationId ?? null, organization_name: metadata.organizationName ?? null, branch_id: metadata.branchId ?? null, branch_name: metadata.branchName ?? null, branch_code: metadata.branchCode ?? null, terminal_id: metadata.terminalId ?? null, terminal_name: metadata.terminalName ?? null, phase: "starting", current_table: null, dependency_index: 0, last_committed_cursor: null, completed_rows: 0, estimated_total_rows: metadata.estimatedTotalRows ?? null, completed_bytes: 0, batch_number: 0, batch_size: 500, retry_count: 0, next_retry_at: null };
    if (!existing) await this.repository.create(job);
    this.running = job; if (options.pendingStep !== true) this.paused = false;
    try {
      const starting = options.pendingStep === true ? { status: "running", finished_at: null }
        : { status: "running", finished_at: null, error_code: null, error_message: null };
      await this.repository.checkpoint(job.job_id, starting);
      if (options.pendingStep === true) Object.assign(job, starting);
      const outcome = await handler({
        job,
        checkpoint: async (patch, transaction = null) => { Object.assign(job, patch); await this.repository.checkpoint(job.job_id, patch, transaction); this.emit(job); },
        shouldPause: () => this.paused,
        waitWhilePaused: async () => this.waitWhilePaused(job, async (patch) => { Object.assign(job, patch); await this.repository.checkpoint(job.job_id, patch); this.emit(job, true); }),
        maxBytes: this.maxBytes,
      });
      if (options.pendingStep === true) {
        if (outcome?.pending === true) {
          const status = outcome.status ?? "queued";
          if (!["queued", "retrying", "paused", "interrupted"].includes(status))
            throw Object.assign(new Error("The background recovery step returned an invalid pending state."), { code: "EJOB_STEP_INVALID" });
          await this.repository.checkpoint(job.job_id, { status, finished_at: null });
          this.emit({ ...job, status, finished_at: null }, true);
          return { ...job, status, pending: true };
        }
        if (outcome?.completed !== true)
          throw Object.assign(new Error("The background recovery step did not confirm completion."), { code: "EJOB_STEP_INVALID" });
      }
      const resolved = options.pendingStep === true ? { error_code: null, error_message: null, next_retry_at: null } : {};
      await this.repository.checkpoint(job.job_id, { status: "completed", finished_at: new Date(), ...resolved });
      this.emit({ ...job, status: "completed", finished_at: new Date(), ...resolved }, true);
      return { ...job, status: "completed", ...resolved };
    } catch (error) {
      await this.repository.checkpoint(job.job_id, { status: "failed", finished_at: new Date(), error_code: error?.code ?? "EJOB", error_message: String(error?.message ?? error).slice(0, 1000) });
      throw error;
    } finally { this.running = null; }
  }
  // Opt-in bounded quanta only. Ordinary run/runPaged callers keep their
  // existing completion contract, and an unrelated active job is never adopted.
  async runStep(type, handler, existing = null, metadata = {}) {
    if (this.running) return { pending: true, busy: true, code: "EJOB_BUSY" };
    if (this.paused) return { pending: true, paused: true, code: "EJOB_PAUSED" };
    return this.run(type, handler, existing, metadata, { pendingStep: true });
  }
  async runPaged(type, { fetchPage, processPage, metadata = {}, existing = null }) {
    return this.run(type, async (context) => {
      let cursor = context.job.last_committed_cursor ?? null;
      let size = Number(context.job.batch_size) || 500;
      while (true) {
        await context.waitWhilePaused();
        let page;
        try { page = await fetchPage({ cursor, limit: size, maxBytes: context.maxBytes }); }
        catch (error) {
          size = nextBatchSize(size, error?.code === "EOVERSIZED" ? "oversized" : "timeout");
          await context.checkpoint({ status: "retrying", batch_size: size, retry_count: Number(context.job.retry_count ?? 0) + 1 });
          if (size === 100 && Number(context.job.retry_count ?? 0) >= 5) throw error;
          continue;
        }
        const rows = page?.rows ?? [];
        if (!rows.length) break;
        const bytes = Buffer.byteLength(JSON.stringify(rows), "utf8");
        if (bytes > context.maxBytes) { size = nextBatchSize(size, "oversized"); continue; }
        const transaction = await processPage({ rows, cursor, nextCursor: page.cursor, context });
        cursor = page.cursor;
        size = nextBatchSize(size, "success");
        const patch = { status: "running", last_committed_cursor: cursor, completed_rows: Number(context.job.completed_rows ?? 0) + rows.length, completed_bytes: Number(context.job.completed_bytes ?? 0) + bytes, batch_number: Number(context.job.batch_number ?? 0) + 1, batch_size: size, retry_count: 0 };
        try {
          await context.checkpoint(patch, transaction ?? null);
          if (transaction) await transaction.commit();
        } catch (error) {
          if (transaction) await Promise.resolve(transaction.rollback()).catch(() => undefined);
          throw error;
        }
        if (page.done || rows.length < size - 100) break;
      }
    }, existing, metadata);
  }
  pause() { this.paused = true; return { ok: true }; }
  resume() { this.paused = false; return { ok: true }; }
}
module.exports = { JobManager, nextBatchSize };
