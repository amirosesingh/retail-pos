const { canonicalEntityKey } = require("./entity-key.cjs");
const { readPage } = require("./page-policy.cjs");
const { refreshTable } = require("../jobs/bootstrap.cjs");

class PullWorker {
  constructor({ connectionManager, cloud, checkpoints, registry, reader, conflicts, publish = () => {} }) {
    this.connectionManager = connectionManager; this.cloud = cloud; this.checkpoints = checkpoints;
    this.registry = registry; this.reader = reader; this.conflicts = conflicts; this.publish = publish;
  }
  async applyTable(transaction, table, changes, branchId) {
    if (!changes.length) return { applied: 0, conflicts: 0 };
    const entityIds = changes.map((change) => String(change.entity_id));
    const pending = new Set([...(await this.reader.unacknowledged(table, entityIds, transaction))].map(canonicalEntityKey));
    const safe = [];
    let conflictCount = 0;
    for (const change of changes) {
      if (!pending.has(canonicalEntityKey(change.entity_id))) { safe.push(change); continue; }
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
  async ensureStoreGroups(batch, branchId) {
    const groupIds = [...new Set(batch.rows
      .filter((row) => row.table_name === "stores")
      .map((row) => String(row.row_data?.group_id ?? "").trim())
      .filter(Boolean))];
    if (!groupIds.length) return;
    const included = new Set(batch.rows
      .filter((row) => row.table_name === "store_groups")
      .map((row) => String(row.row_data?.id ?? "")));
    const needed = groupIds.filter((id) => !included.has(id));
    if (!needed.length) return;
    const sql = this.connectionManager.sql();
    const request = new sql.Request(this.connectionManager.pool);
    needed.forEach((id, index) => request.input(`group${index}`, id));
    const present = await request.query(`SELECT [id] FROM dbo.[store_groups] WHERE [id] IN (${needed.map((_, index) => `@group${index}`).join(",")});`);
    const existing = new Set((present.recordset ?? []).map((row) => String(row.id)));
    const missing = new Set(needed.filter((id) => !existing.has(id)));
    if (!missing.size) return;
    await refreshTable({
      registry: this.registry, cloud: this.cloud, connectionManager: this.connectionManager,
      branchId, tableName: "store_groups",
      rowFilter: (row) => {
        if (!missing.has(String(row.id))) return false;
        missing.delete(String(row.id));
        return true;
      },
    });
    if (missing.size) throw Object.assign(
      new Error(`The cloud store group ${[...missing].join(", ")} is missing. Check the store group on the server before retrying synchronization.`),
      { code: "ESTORE_GROUP_MISSING" },
    );
  }
  async run({ branchId, batchSize = 500, onProgress = () => {} }) {
    if (!branchId) throw new Error("A branch is required for synchronization.");
    // A single legacy settings/audit row can approach 2 MiB. Keep downloads at
    // the database's byte-safe minimum even when a caller asks for a larger
    // upload batch through the coordinator's shared options object.
    batchSize = 100;
    let merged = 0; let conflictCount = 0; let membershipMirrored = 0; let membershipDeferred = false;
    let checkpoint = await this.checkpoints.get(branchId, "__feed__", "pull");
    while (true) {
      const page = await readPage(limit => this.cloud.pullBatch({ branchId, cursor: checkpoint?.committed_cursor ?? null, limit }),batchSize);
      const batch = page.batch;
      batchSize=page.nextLimit;
      if (!batch.count) break;
      if (!Number.isFinite(Number(batch.cursor)) || Number(batch.cursor) <= Number(checkpoint?.committed_cursor ?? 0))
        throw Object.assign(new Error("The cloud change cursor did not advance. Download stopped to avoid replaying the same page."), { code: "ESYNC_CURSOR" });
      const beforePage = merged;
      // Feed pages are ordered by change cursor, not by foreign-key dependency.
      // A store update can arrive before the page containing its new group.
      await this.ensureStoreGroups(batch, branchId);
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
      this.publish({ kind: "general", branchId, source: "cloud", tables: [...new Set([...batch.rows, ...batch.tombstones].map(row => row.table_name))],
        changes: [...batch.rows, ...batch.tombstones].map(row => ({ table: row.table_name, entityId: row.row_data?.product_id && row.table_name === "product_barcodes" ? row.row_data.product_id : row.row_data?.id ?? (() => { try { return JSON.parse(row.entity_id).id ?? null; } catch { return null; } })() })) });
      checkpoint = { ...(checkpoint ?? {}), committed_cursor: batch.cursor };
      onProgress({ direction: "pull", table: [...new Set([...batch.rows, ...batch.tombstones].map(row => row.table_name))].join(", "), completed: merged - beforePage });
      batch.rows.length = 0; batch.tombstones.length = 0;
      if (batch.count < page.limit) break;
    }
    let membershipCheckpoint = await this.checkpoints.get(branchId, "__membership_directory__", "pull");
    try {
      while (true) {
        const directory = (await readPage(limit => this.cloud.membershipDirectory({
          afterRevision: membershipCheckpoint?.committed_cursor ?? 0, limit,
        }),batchSize)).batch;
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
    return { merged, conflicts: conflictCount, membershipMirrored, membershipDeferred };
  }
}
module.exports = { PullWorker };
