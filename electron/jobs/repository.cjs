function legacyIds(values){if(!Array.isArray(values)||values.length>50||new Set(values).size!==values.length||values.some(id=>typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)))throw Object.assign(new Error('The verified legacy history allowlist is invalid.'),{code:'EHISTORY_LEGACY_REVIEW',table:'change_history'});return JSON.stringify(values);}
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
  async recovery(type, branchId, terminalId) {
    const result=await this.pool().request().input("type",type).input("branch",branchId).input("terminal",terminalId)
      .query("SELECT TOP (1) * FROM dbo.pos_jobs WHERE job_type=@type AND branch_id=@branch AND terminal_id=@terminal ORDER BY started_at DESC,job_id DESC;");
    return result.recordset?.[0]??null;
  }
  async get(jobId, transaction=null) {
    const result=await this.request(transaction).input("job",jobId).query(`SELECT * FROM dbo.pos_jobs ${transaction?"WITH (UPDLOCK,HOLDLOCK)":""} WHERE job_id=@job;`);
    return result.recordset?.[0]??null;
  }
  async legacyHistory(branchId,terminalId,transaction=null){
    const result=await this.request(transaction).input('branch',branchId).input('terminal',terminalId).query(`
      SELECT TOP(51) job.*,(SELECT job.* FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER) __history_legacy_json
      FROM dbo.pos_jobs job ${transaction?'WITH(UPDLOCK,HOLDLOCK)':''}
      WHERE job_type='history_gap_recovery_v1' AND (status<>'completed' OR status IS NULL) AND branch_id=@branch AND terminal_id=@terminal ORDER BY job_id;`);
    return result.recordset??[];
  }
  async active() {
    const result = await this.pool().request().query("SELECT TOP (1) * FROM dbo.pos_jobs WHERE status IN ('queued','starting','running','paused','retrying','interrupted') ORDER BY updated_at DESC;");
    return result.recordset?.[0] ?? null;
  }
  async hasOtherActiveJobs(exceptJobId = null,{ignoreHistoryIndex=false,allowedLegacyIds=[]}={}) {
    const result = await this.pool().request().input("except", exceptJobId).input('ignore_history_index',ignoreHistoryIndex===true).input('legacy_ids',legacyIds(allowedLegacyIds))
      .query("SELECT TOP (1) job_id FROM dbo.pos_jobs WHERE status IN ('queued','starting','running','paused','retrying','interrupted') AND (@except IS NULL OR job_id<>@except) AND (@ignore_history_index=0 OR job_type<>'history_index_recovery_v1') AND NOT(job_type='history_gap_recovery_v1' AND job_id IN(SELECT CONVERT(uniqueidentifier,[value]) FROM OPENJSON(@legacy_ids)));");
    return Boolean(result.recordset?.length);
  }
  async startupSnapshot(type, branchId, exceptHistoryJobId = null,allowedLegacyIds=[]) {
    const result = await this.pool().request().input("type", type).input("branch", branchId).input("history",exceptHistoryJobId).input('legacy_ids',legacyIds(allowedLegacyIds))
      .query(`SELECT TOP (1) snapshot.* FROM dbo.pos_jobs snapshot
        WHERE snapshot.job_type=@type AND snapshot.status='completed' AND snapshot.branch_id=@branch
          AND NOT EXISTS (SELECT 1 FROM dbo.pos_jobs barrier
            WHERE barrier.job_id<>snapshot.job_id AND (barrier.branch_id=@branch OR barrier.branch_id IS NULL)
              AND COALESCE(barrier.finished_at,barrier.updated_at,barrier.started_at)>=COALESCE(snapshot.finished_at,snapshot.updated_at,snapshot.started_at)
              AND NOT(barrier.job_type='history_gap_recovery_v1' AND barrier.job_id IN(SELECT CONVERT(uniqueidentifier,[value]) FROM OPENJSON(@legacy_ids)))
              AND (barrier.job_type LIKE 'bootstrap[_]%' OR barrier.job_type NOT IN ('history_gap_recovery_v1','history_index_recovery_v1','retention')
                OR (barrier.job_type='retention' AND barrier.status<>'completed')
                OR (barrier.job_type IN ('history_gap_recovery_v1','history_index_recovery_v1') AND barrier.status<>'completed' AND (@history IS NULL OR barrier.job_id<>@history))))
        ORDER BY snapshot.finished_at DESC;`);
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
