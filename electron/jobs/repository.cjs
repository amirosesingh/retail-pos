class JobRepository {
  constructor(connectionManager) { this.connectionManager = connectionManager; }
  pool() { if (!this.connectionManager.pool) throw new Error("SQL Server is not connected."); return this.connectionManager.pool; }
  async create(job) {
    const request = this.pool().request();
    for (const [name, value] of Object.entries(job)) request.input(name, value ?? null);
    await request.query(`INSERT INTO dbo.pos_jobs
      (job_id,job_type,status,organization_id,organization_name,branch_id,branch_name,branch_code,terminal_id,terminal_name,phase,current_table,dependency_index,last_committed_cursor,completed_rows,estimated_total_rows,completed_bytes,batch_number,batch_size,retry_count,next_retry_at,started_at,updated_at)
      VALUES (@job_id,@job_type,@status,@organization_id,@organization_name,@branch_id,@branch_name,@branch_code,@terminal_id,@terminal_name,@phase,@current_table,@dependency_index,@last_committed_cursor,@completed_rows,@estimated_total_rows,@completed_bytes,@batch_number,@batch_size,@retry_count,@next_retry_at,SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());`);
    return job;
  }
  request(transaction = null) { return transaction ? new (this.connectionManager.sql().Request)(transaction) : this.pool().request(); }
  async checkpoint(jobId, patch, transaction = null) {
    const allowed = ["status","phase","current_table","dependency_index","last_committed_cursor","completed_rows","estimated_total_rows","completed_bytes","batch_number","batch_size","retry_count","next_retry_at","finished_at","error_code","error_message"];
    const entries = Object.entries(patch).filter(([key]) => allowed.includes(key));
    if (!entries.length) return;
    const request = this.request(transaction).input("job_id", jobId);
    for (const [key, value] of entries) request.input(key, value ?? null);
    await request.query(`UPDATE dbo.pos_jobs SET ${entries.map(([key]) => `[${key}]=@${key}`).join(",")}, updated_at=SYSDATETIMEOFFSET() WHERE job_id=@job_id;`);
  }
  async active() {
    const result = await this.pool().request().query("SELECT TOP (1) * FROM dbo.pos_jobs WHERE status IN ('queued','starting','running','paused','retrying','interrupted') ORDER BY updated_at DESC;");
    return result.recordset?.[0] ?? null;
  }
  async history(limit = 50) {
    const result = await this.pool().request().input("limit", Math.max(1, Math.min(200, limit))).query("SELECT TOP (@limit) * FROM dbo.pos_jobs ORDER BY updated_at DESC;");
    return result.recordset ?? [];
  }
  async interruptRunning() {
    await this.pool().request().query("UPDATE dbo.pos_jobs SET status='interrupted',updated_at=SYSDATETIMEOFFSET() WHERE status IN ('starting','running','retrying');");
  }
  async completed(type, branchId) {
    const result = await this.pool().request().input("type", type).input("branch", branchId ?? null)
      .query("SELECT TOP (1) * FROM dbo.pos_jobs WHERE job_type=@type AND status='completed' AND (branch_id=@branch OR (branch_id IS NULL AND @branch IS NULL)) ORDER BY finished_at DESC;");
    return result.recordset?.[0] ?? null;
  }
  async failures(limit = 100) {
    const result = await this.pool().request().input("limit", Math.max(1, Math.min(200, limit)))
      .query(`SELECT TOP (@limit) failed.* FROM dbo.pos_jobs failed
        WHERE failed.status='failed' AND NOT EXISTS (
          SELECT 1 FROM dbo.pos_jobs recovered
          WHERE recovered.job_type=failed.job_type
            AND (recovered.branch_id=failed.branch_id OR (recovered.branch_id IS NULL AND failed.branch_id IS NULL))
            AND (recovered.organization_id=failed.organization_id OR (recovered.organization_id IS NULL AND failed.organization_id IS NULL))
            AND (recovered.terminal_id=failed.terminal_id OR (recovered.terminal_id IS NULL AND failed.terminal_id IS NULL))
            AND recovered.status='completed'
            AND recovered.updated_at>failed.updated_at
        )
        ORDER BY failed.updated_at DESC;`);
    return result.recordset ?? [];
  }
}
module.exports = { JobRepository };
