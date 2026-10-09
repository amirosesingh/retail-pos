class CheckpointRepository {
  constructor(connectionManager) { this.connectionManager=connectionManager; }
  request(transaction) { return transaction ? transaction.request() : this.connectionManager.pool.request(); }
  async list(branchId, direction) {
    const result = await this.connectionManager.pool.request().input("branch", branchId).input("direction", direction)
      .query("SELECT * FROM dbo.sync_checkpoints WHERE branch_id=@branch AND direction=@direction;");
    return result.recordset ?? [];
  }
  async get(branchId, entity, direction) {
    const result=await this.connectionManager.pool.request().input("branch",branchId).input("entity",entity).input("direction",direction).query("SELECT TOP (1) * FROM dbo.sync_checkpoints WHERE branch_id=@branch AND entity_type=@entity AND direction=@direction;");
    return result.recordset?.[0]??null;
  }
  async save(branchId, entity, direction, patch, transaction=null) {
    const request=this.request(transaction).input("organization","default").input("branch",branchId).input("entity",entity).input("direction",direction).input("cursor",patch.committed_cursor??null).input("version",patch.change_tracking_version??null);
    await request.query(`MERGE dbo.sync_checkpoints WITH (HOLDLOCK) AS target
      USING (SELECT @organization organization_id,@branch branch_id,@entity entity_type,@direction direction) source
      ON target.organization_id=source.organization_id AND target.branch_id=source.branch_id AND target.entity_type=source.entity_type AND target.direction=source.direction
      WHEN MATCHED THEN UPDATE SET committed_cursor=COALESCE(@cursor,target.committed_cursor),change_tracking_version=COALESCE(@version,target.change_tracking_version),updated_at=SYSDATETIMEOFFSET()
      WHEN NOT MATCHED THEN INSERT(organization_id,branch_id,entity_type,direction,committed_cursor,change_tracking_version) VALUES(@organization,@branch,@entity,@direction,@cursor,@version);`);
  }
}
module.exports={CheckpointRepository};
