const { stableUuid } = require("../db/repositories/aggregates.cjs");
const IMMUTABLE = new Set(["sales", "sale_items", "payment_transactions", "refunds", "payment_reversals"]);
function policy(entity) {
  if (IMMUTABLE.has(entity)) return "immutable_reversal";
  if (entity === "item_activity_logs" || entity === "stock_adjustments") return "movement_delta";
  if (entity === "pos_settings") return "scoped_version";
  return "highest_version";
}
class ConflictRepository {
  constructor(connectionManager) { this.connectionManager = connectionManager; }
  async reconcileAcknowledged() {
    // Repair only the old pending-upload warnings. Genuine conflicts and any
    // entity with an outstanding local transaction must remain unresolved.
    await this.connectionManager.pool.request()
      .input("reason", "An unacknowledged local transaction has priority over this cloud change.")
      .query(`UPDATE conflict SET status='resolved',resolved_at=SYSDATETIMEOFFSET()
        FROM dbo.sync_conflicts conflict
        WHERE conflict.status='unresolved' AND conflict.reason=@reason
          AND NOT EXISTS (
            SELECT 1 FROM dbo.sync_change_journal journal
            WHERE journal.entity_type=conflict.entity_type
              AND journal.entity_id=conflict.entity_id
              AND journal.branch_id IN (conflict.branch_id,'global')
              AND journal.acknowledged_at IS NULL
          );`);
  }
  async record(transaction, conflict) {
    const id = stableUuid({ table: conflict.entityType, entity: conflict.entityId, remoteVersion: conflict.remoteVersion, reason: conflict.reason });
    const sql = this.connectionManager.sql();
    await new sql.Request(transaction).input("id", id).input("entity_type", conflict.entityType).input("entity_id", conflict.entityId)
      .input("branch", conflict.branchId).input("local_version", conflict.localVersion ?? null).input("remote_version", conflict.remoteVersion ?? null)
      .input("reason", String(conflict.reason).slice(0, 1000)).query(`IF NOT EXISTS(SELECT 1 FROM dbo.sync_conflicts WITH(UPDLOCK,HOLDLOCK) WHERE conflict_id=@id)
        INSERT dbo.sync_conflicts(conflict_id,entity_type,entity_id,branch_id,local_version,remote_version,reason) VALUES(@id,@entity_type,@entity_id,@branch,@local_version,@remote_version,@reason);`);
  }
  async unresolved(limit = 100) {
    await this.reconcileAcknowledged();
    const result = await this.connectionManager.pool.request().input("limit", Math.max(1, Math.min(200, limit))).query("SELECT TOP (@limit) * FROM dbo.sync_conflicts WHERE status='unresolved' ORDER BY created_at;");
    return result.recordset ?? [];
  }
  async count() {
    await this.reconcileAcknowledged();
    const result = await this.connectionManager.pool.request().query("SELECT COUNT_BIG(*) count FROM dbo.sync_conflicts WHERE status='unresolved';");
    return Number(result.recordset?.[0]?.count ?? 0);
  }
}
module.exports = { policy, IMMUTABLE, ConflictRepository };
