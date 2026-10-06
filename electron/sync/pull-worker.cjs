class PullWorker {
  constructor({ connectionManager, cloud, checkpoints, registry, reader, conflicts }) {
    this.connectionManager = connectionManager; this.cloud = cloud; this.checkpoints = checkpoints;
    this.registry = registry; this.reader = reader; this.conflicts = conflicts;
  }
  async applyTable(transaction, table, changes, branchId) {
    if (!changes.length) return { applied: 0, conflicts: 0 };
    const entityIds = changes.map((change) => String(change.entity_id));
    const pending = await this.reader.unacknowledged(table, entityIds, transaction);
    const safe = [];
    let conflictCount = 0;
    for (const change of changes) {
      if (!pending.has(String(change.entity_id))) { safe.push(change); continue; }
      conflictCount += 1;
      await this.conflicts.record(transaction, {
        entityType: table.sqlServerTable, entityId: String(change.entity_id), branchId,
        remoteVersion: Number(change.row_version ?? 0), reason: "An unacknowledged local transaction has priority over this cloud change.",
      });
    }
    if (safe.length) await this.cloud.applyLocalBatch(transaction, table, {
      rows: safe.filter((change) => !change.tombstone),
      tombstones: safe.filter((change) => change.tombstone),
    });
    return { applied: safe.length, conflicts: conflictCount };
  }
  async run({ branchId, batchSize = 500 }) {
    if (!branchId) throw new Error("A branch is required for synchronization.");
    // A single legacy settings/audit row can approach 2 MiB. Keep downloads at
    // the database's byte-safe minimum even when a caller asks for a larger
    // upload batch through the coordinator's shared options object.
    batchSize = 10;
    let merged = 0; let conflictCount = 0; let membershipMirrored = 0; let membershipDeferred = false;
    let membershipCheckpoint = await this.checkpoints.get(branchId, "__membership_directory__", "pull");
    try {
      while (true) {
        const directory = await this.cloud.membershipDirectory({
          afterRevision: membershipCheckpoint?.committed_cursor ?? 0,
          limit: batchSize,
        });
        if (!directory?.ok) {
          membershipDeferred = true;
          break;
        }
        membershipMirrored += Number(directory.mirrored ?? 0);
        const priorRevision = Number(membershipCheckpoint?.committed_cursor ?? 0);
        const nextRevision = Number(directory.nextRevision ?? priorRevision);
        // Never persist an invalid or regressing service cursor. An unchanged
        // final page is complete, while an unchanged page claiming more data
        // must defer instead of looping indefinitely.
        if (!Number.isFinite(nextRevision) || nextRevision < priorRevision) {
          membershipDeferred = true;
          break;
        }
        if (nextRevision === priorRevision) {
          membershipDeferred = Boolean(directory.hasMore);
          break;
        }
        await this.checkpoints.save(branchId, "__membership_directory__", "pull", { committed_cursor: nextRevision });
        membershipCheckpoint = { ...(membershipCheckpoint ?? {}), committed_cursor: nextRevision };
        if (!directory.hasMore) break;
      }
    } catch {
      // Membership is a separate service. Its outage must never block sales,
      // approvals, staff changes, or the main POS synchronization feed.
      membershipDeferred = true;
    }
    let checkpoint = await this.checkpoints.get(branchId, "__feed__", "pull");
    while (true) {
      const batch = await this.cloud.pullBatch({ branchId, cursor: checkpoint?.committed_cursor ?? null, limit: batchSize });
      if (!batch.count) break;
      const sql = this.connectionManager.sql();
      const transaction = new sql.Transaction(this.connectionManager.pool);
      await transaction.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);
      try {
        const ordered = [...this.registry.tables].sort((a, b) => a.dependencyOrder - b.dependencyOrder || a.cloudTable.localeCompare(b.cloudTable));
        for (const table of ordered) {
          const result = await this.applyTable(transaction, table, batch.rows.filter((row) => row.table_name === table.cloudTable), branchId);
          merged += result.applied; conflictCount += result.conflicts;
        }
        for (const table of [...ordered].reverse()) {
          const result = await this.applyTable(transaction, table, batch.tombstones.filter((row) => row.table_name === table.cloudTable), branchId);
          merged += result.applied; conflictCount += result.conflicts;
        }
        await this.checkpoints.save(branchId, "__feed__", "pull", { committed_cursor: batch.cursor }, transaction);
        await transaction.commit();
      } catch (error) {
        await Promise.resolve(transaction.rollback()).catch(() => undefined);
        throw error;
      }
      checkpoint = { ...(checkpoint ?? {}), committed_cursor: batch.cursor };
      batch.rows.length = 0; batch.tombstones.length = 0;
      if (batch.count < batchSize) break;
    }
    return { merged, conflicts: conflictCount, membershipMirrored, membershipDeferred };
  }
}
module.exports = { PullWorker };
