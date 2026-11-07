const { canonicalEntityKey } = require("./entity-key.cjs");
const { readPage, MAX_PAGE_BYTES } = require("./page-policy.cjs");
const { refreshTable } = require("../jobs/bootstrap.cjs");
const {prepareShiftGraphs,applyShiftGraphs} = require("./shift-graph.cjs");
const { posFeedFailed, posFeedCompleted } = require("./status-evidence.cjs");
const {prepareHistoryFeed}=require('./history-feed.cjs');
const grouped = require("./grouped-store-settings.cjs");
const SHIFT_GRAPH_TABLES = new Set(["shifts", "shift_cash_counts", "shift_reconciliations",
  "shift_close_events", "shift_notifications", "shift_variance_alerts"]);

class PullWorker {
  constructor({ connectionManager, cloud, checkpoints, registry, reader, conflicts, publish = () => {} }) {
    this.connectionManager = connectionManager; this.cloud = cloud; this.checkpoints = checkpoints;
    this.registry = registry; this.reader = reader; this.conflicts = conflicts; this.publish = publish;
  }
  async applyTable(transaction, table, changes, branchId, checkedPending) {
    if (!changes.length) return { applied: 0, conflicts: 0 };
    const entityIds = changes.map((change) => String(change.entity_id));
    const pending = new Set([...(checkedPending ?? await this.reader.unacknowledged(table, entityIds, transaction, { branchId, changes }))].map(canonicalEntityKey));
    const safe = [];
    for (const change of changes) {
      if (!pending.has(canonicalEntityKey(change.entity_id))) { safe.push(change); continue; }
      if (table.cloudTable === "held_orders" && change.tombstone) {
        // Keep the page cursor until the pending write is acknowledged. Otherwise
        // an idempotent upload retry could swallow the only cleanup tombstone.
        throw Object.assign(new Error("Held bill cleanup is waiting for its pending upload."), {code:"EHELD_CLEANUP_PENDING"});
      }
      // A pending upload is a temporary ordering barrier, not a data conflict.
      // Retain the page cursor so this cloud revision is read again after the
      // local transaction is acknowledged; never overwrite or discard either.
      throw Object.assign(new Error("Cloud download is waiting for a pending local upload."), {
        code: "ELOCAL_UPLOAD_PENDING", table: table.cloudTable,
      });
    }
    const result = safe.length ? await this.cloud.applyLocalBatch(transaction, table, {
      rows: safe.filter((change) => !change.tombstone),
      tombstones: safe.filter((change) => change.tombstone),
      ...(SHIFT_GRAPH_TABLES.has(table.cloudTable) ? { branchId } : {}),
    }) : null;
    if (SHIFT_GRAPH_TABLES.has(table.cloudTable) && (!result || result.deferred || result.conflicts ||
        result.applied + result.alreadyMatching !== safe.length)) {
      const blocked = result?.outcomes?.filter(item => ["deferred", "conflict"].includes(item.status)) ?? [];
      throw Object.assign(new Error(blocked[0]?.reason ?? "The cloud closing download was not confirmed locally. Its page remains pending."), {
        code: result?.conflicts ? "ESYNC_APPLY_CONFLICT" : "ESYNC_APPLY_DEFERRED", table: table.cloudTable, outcomes: blocked,
      });
    }
    return { applied: result?.applied ?? safe.length, alreadyMatching: result?.alreadyMatching ?? 0, conflicts: 0 };
  }
  groupedSettingsContext() {
    const source = this.cloud.requestContext(false);
    const branch = grouped.operationsScope(source);
    const table = this.registry.tables.find(table => table.cloudTable === grouped.TABLE && table.sqlServerTable === grouped.TABLE && table.scope === "branch");
    if (!table || source.pool !== this.connectionManager.pool)
      throw grouped.fail("The grouped settings projection is unavailable on this database.");
    return { source, branch, table };
  }
  async commitGroupedSettings({ source, branch, table }, position, next, change, snapshot = null) {
    this.cloud.assertRequestContext(source, false);
    const sql = this.connectionManager.sql();
    const transaction = new sql.Transaction(source.pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    let changed = false;
    try {
      const local = await grouped.readLocalRow(transaction, branch, table, change);
      const current = await grouped.readPosition(transaction.request(), branch, source.fingerprint, true);
      if (!snapshot && (!current || current.epoch !== position.epoch || current.seq !== position.seq || current.upper !== position.upper))
        throw grouped.fail("Another grouped settings apply advanced the saved position.", "ESYNC_GROUPED_POSITION_CHANGED");
      if (snapshot && current?.epoch === next.epoch &&
          (BigInt(next.seq) < BigInt(current.seq) || (current.upper !== null && BigInt(next.seq) < BigInt(current.upper))))
        throw grouped.fail("The grouped settings snapshot would regress the saved sequence.");

      await grouped.assertLocalTracking(transaction, branch);
      const entityId = JSON.stringify({ store_id: branch });
      const pending = await this.reader.unacknowledged(table, [entityId], transaction, { branchId: branch });
      if (pending.size) throw grouped.fail("A local settings edit is still pending upload.", "ELOCAL_UPLOAD_PENDING");
      if (snapshot && local && local.matching !== 1)
        throw grouped.fail("The retained local settings differ from the snapshot. Review is required before advancing.", "ESYNC_GROUPED_REVIEW_REQUIRED");
      if (change && local?.matching !== 1) {
        await this.applyTable(transaction, table, [change], branch, pending);
        const saved = await grouped.readLocalRow(transaction, branch, table, change);
        if (saved?.matching !== 1)
          throw grouped.fail("The native merge did not confirm the grouped settings row.", "ESYNC_GROUPED_REVIEW_REQUIRED");
        changed = true;
      }
      this.cloud.assertRequestContext(source, false);
      if (snapshot && snapshot.expires <= Date.now()) throw grouped.fail("The grouped settings snapshot pin expired.");
      await this.checkpoints.save(branch, grouped.CHECKPOINT, "pull",
        { committed_cursor: JSON.stringify({ source: source.fingerprint, ...next }) }, transaction);
      this.cloud.assertRequestContext(source, false);
      await transaction.commit();
    } catch (error) {
      await Promise.resolve(transaction.rollback()).catch(() => undefined);
      throw error;
    }
    if (changed) this.publish({ kind: "general", branchId: branch, source: "cloud",
      tables: [grouped.TABLE], changes: [{ table: grouped.TABLE, entityId: branch }] });
    return changed;
  }
  // Opt-in pilot entry points. The installed coordinator still calls run().
  async installGroupedSettingsSnapshot() {
    const context = this.groupedSettingsContext();
    const { source, branch, table } = context;
    const snapshot = grouped.snapshotFor(await this.cloud.groupedSettingsSnapshot(source), branch, table);
    const { epoch, seq, change } = snapshot;
    const changed = await this.commitGroupedSettings(context, null, { epoch, seq, upper: null }, change, snapshot);
    return { epoch, seq, changed };
  }
  async pullGroupedSettingsPage({ limit = 100 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw grouped.fail("The grouped settings page limit must be between 1 and 100.");
    const context = this.groupedSettingsContext();
    const { source, branch, table } = context;
    let position = await grouped.readPosition(source.pool.request(), branch, source.fingerprint);
    if (!position) return { status: "SNAPSHOT_REQUIRED", reason: "UNINITIALIZED" };
    const page = await this.cloud.pullGroupedSettings(source, position, limit);
    if (grouped.snapshotRequired(page)) return page;
    const groups = grouped.groupsFor(page, branch, table, position, limit);
    let merged = 0;
    for (const group of groups) {
      const next = { epoch: position.epoch, seq: group.seq, upper: group.seq === page.upper_seq ? null : page.upper_seq };
      try {
        if (await this.commitGroupedSettings(context, position, next, group.change)) merged++;
      } catch (error) {
        if (error?.code === "ELOCAL_UPLOAD_PENDING")
          return { status: "DEFERRED", reason: error.code, merged, seq: position.seq, hasMore: true };
        throw error;
      }
      position = next;
    }
    return { status: "OK", merged, seq: position.seq, hasMore: page.has_more };
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
  async ensureTicketDependencies(batch, branchId) {
    const completed = batch.rows.filter(row => row.table_name === "held_orders" && row.row_data?.status === "completed").map(row => row.row_data);
    const closing = batch.rows.filter(row => row.table_name === "shifts" && (row.row_data?.state !== "ACTIVE" || row.row_data?.closed_at)).map(row => String(row.row_data.id));
    const localTickets = [];
    for (const id of closing) {
      const result = await this.connectionManager.pool.request().input("shift", id).input("branch", branchId).query("SELECT id,bill_no,shift_id FROM dbo.held_orders WHERE store_id=@branch AND (shift_id=@shift OR shift_id IS NULL) AND status NOT IN ('completed','cancelled');");
      localTickets.push(...(result.recordset ?? []));
    }
    const bills = new Set([...completed.filter(row => !String(row.note ?? "").startsWith("booking:")), ...localTickets].map(row => row.bill_no).filter(Boolean));
    const bookings = new Set(completed.filter(row => String(row.note ?? "").startsWith("booking:")).map(row => row.note.slice(8)));
    const missingBills = new Set();
    for (const bill of bills) {
      const result = await this.connectionManager.pool.request().input("bill", bill).input("branch", branchId).query("SELECT id FROM dbo.sales WHERE store_id=@branch AND bill_number=@bill;");
      if (!result.recordset?.length) missingBills.add(bill);
    }
    const refresh = (tableName, rowFilter) => refreshTable({registry:this.registry,cloud:this.cloud,connectionManager:this.connectionManager,reader:this.reader,branchId,historyDays:7300,tableName,rowFilter});
    if (missingBills.size) await refresh("sales", row => missingBills.has(row.bill_number));
    for (const id of [...bookings]) {
      const result = await this.connectionManager.pool.request().input("id", id).input("branch", branchId).query("SELECT id FROM dbo.bookings WHERE store_id=@branch AND CONVERT(nvarchar(36),id)=@id;");
      if (result.recordset?.length) bookings.delete(id);
    }
    if (bookings.size || localTickets.length) await refresh("bookings", row => bookings.has(String(row.id)) || closing.includes(String(row.shift_id)));
    if (localTickets.length) {
      const ids = new Set(localTickets.map(row => String(row.id)));
      await refresh("held_orders", row => ids.has(String(row.id)));
    }
  }
  async run({ branchId, batchSize = 500, skipMembership = false, onProgress = () => {} }) {
    if (!branchId) throw new Error("A branch is required for synchronization.");
    // A single legacy settings/audit row can approach 2 MiB. Keep downloads at
    // the database's byte-safe minimum even when a caller asks for a larger
    // upload batch through the coordinator's shared options object.
    batchSize = 100;
    let merged = 0; let conflictCount = 0; let membershipMirrored = 0; let membershipDeferred = false; let deferredHeldDeletion = false; let deferredLocalChanges = false;
    try {
    await this.conflicts?.reconcileAcknowledged?.();
    let checkpoint = await this.checkpoints.get(branchId, "__feed__", "pull");
    while (true) {
      let prepared,history;
      const page = await readPage(async limit => {
        prepared=null;history=null;
        const downloaded=await this.cloud.pullBatch({ branchId, cursor: checkpoint?.committed_cursor ?? null, limit });
        if (typeof downloaded.continuation === "boolean" && (downloaded.count || downloaded.continuation)) {
          let previous = Number(checkpoint?.committed_cursor ?? 0);
          // An attested page must make strict progress before any local writes.
          const cursors = [...downloaded.rows, ...downloaded.tombstones]
            .map(change => Number(change.cursor)).sort((a,b) => a-b);
          if (!cursors.length || !Number.isSafeInteger(previous) || cursors.some(cursor => {
            const invalid = !Number.isSafeInteger(cursor) || cursor <= previous;
            previous = cursor;
            return invalid;
          }) || previous !== Number(downloaded.cursor))
            throw Object.assign(new Error("The protected cloud feed cursor did not advance safely. Its page remains pending."), {code:"ESYNC_CURSOR"});
        }
        if(Buffer.byteLength(JSON.stringify(downloaded),"utf8")>MAX_PAGE_BYTES)
          throw Object.assign(new Error("Download exceeds the safe page size."),{code:"EOVERSIZED"});
        prepared=await prepareShiftGraphs({cloud:this.cloud,connectionManager:this.connectionManager,branchId,changes:[...downloaded.rows,...downloaded.tombstones]});
        history=await prepareHistoryFeed({cloud:this.cloud,connectionManager:this.connectionManager,branchId,changes:[...downloaded.rows,...downloaded.tombstones]});
        return downloaded;
      },batchSize);
      const batch = page.batch;
      batchSize=Math.min(100,page.nextLimit);
      if (!batch.count) break;
      if (!Number.isFinite(Number(batch.cursor)) || Number(batch.cursor) <= Number(checkpoint?.committed_cursor ?? 0))
        throw Object.assign(new Error("The cloud change cursor did not advance. Download stopped to avoid replaying the same page."), { code: "ESYNC_CURSOR" });
      const beforePage = merged;
      const conflictsBeforePage = conflictCount;
      // Feed pages are ordered by change cursor, not by foreign-key dependency.
      // A store update can arrive before the page containing its new group.
      await this.ensureStoreGroups(batch, branchId);
      const graphParents=[...prepared.graphs.values()].map(graph=>({table_name:"shifts",row_data:graph.tables.find(entry=>entry.table==="shifts").rows[0]}));
      await this.ensureTicketDependencies({...batch,rows:[...batch.rows,...graphParents]}, branchId);
      const sql = this.connectionManager.sql();
      const transaction = new sql.Transaction(this.connectionManager.pool);
      await transaction.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);
      try {
        const ordered = [...this.registry.tables].sort((a, b) => a.dependencyOrder - b.dependencyOrder || a.cloudTable.localeCompare(b.cloudTable));
        merged+=await applyShiftGraphs({transaction,connectionManager:this.connectionManager,registry:this.registry,reader:this.reader,branchId,prepared});
        const graphPending = new Map();
        // Check the graph before any page writes. Parent discovery uses a short
        // pool read and must never wait on this transaction's own later X locks.
        for (const table of ordered) if (SHIFT_GRAPH_TABLES.has(table.cloudTable)) {
          const changes = [...batch.rows, ...batch.tombstones].filter(row => row.table_name === table.cloudTable && !prepared.covers(row));
          if (changes.length) graphPending.set(table.cloudTable, await this.reader.unacknowledged(table,
            changes.map(change => String(change.entity_id)), transaction, { branchId, changes }));
        }
        for (const table of ordered) {
          const result = await this.applyTable(transaction, table, batch.rows.filter((row) => row.table_name === table.cloudTable && !prepared.covers(row) && !history.covers(row)), branchId, graphPending.get(table.cloudTable));
          merged += result.applied; conflictCount += result.conflicts;
        }
        for (const table of [...ordered].reverse()) {
          const result = await this.applyTable(transaction, table, batch.tombstones.filter((row) => row.table_name === table.cloudTable && !prepared.covers(row) && !history.covers(row)), branchId, graphPending.get(table.cloudTable));
          merged += result.applied; conflictCount += result.conflicts;
        }
        // Business/closing writers acquire their rows before history/journal.
        // Do not introduce a history→business lock order in mixed feed pages.
        merged+=await history.apply(transaction);
        await history.assert(transaction);
        await this.checkpoints.save(branchId, "__feed__", "pull", { committed_cursor: batch.cursor }, transaction);
        await transaction.commit();
      } catch (error) {
        await Promise.resolve(transaction.rollback()).catch(() => undefined);
        if (error?.code === "ESYNC_APPLY_CONFLICT" && this.conflicts?.record) {
          // The page is rolled back, but keep its actionable conflict outside
          // that transaction. Repeated retries reuse the repository's stable ID.
          const conflictTransaction = new sql.Transaction(this.connectionManager.pool);
          await conflictTransaction.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);
          try {
            for (const item of error.outcomes ?? []) if (item.status === "conflict")
              await this.conflicts.record(conflictTransaction, { entityType: error.table, entityId: item.entityId,
                branchId, localVersion: item.localVersion, remoteVersion: item.remoteVersion, reason: item.reason });
            await conflictTransaction.commit();
          } catch (recordError) { await Promise.resolve(conflictTransaction.rollback()).catch(() => undefined); throw recordError; }
        }
        if (["EHELD_CLEANUP_PENDING", "ELOCAL_UPLOAD_PENDING"].includes(error?.code)) {
          merged = beforePage; conflictCount = conflictsBeforePage;
          deferredHeldDeletion = error.code === "EHELD_CLEANUP_PENDING";
          deferredLocalChanges = true;
          break;
        }
        throw error;
      }
      this.publish({ kind: "general", branchId, source: "cloud", tables: [...new Set([...batch.rows, ...batch.tombstones].map(row => row.table_name))],
        changes: [...batch.rows, ...batch.tombstones].map(row => ({ table: row.table_name, entityId: row.row_data?.product_id && row.table_name === "product_barcodes" ? row.row_data.product_id : row.row_data?.id ?? (() => { try { return JSON.parse(row.entity_id).id ?? null; } catch { return null; } })() })) });
      checkpoint = { ...(checkpoint ?? {}), committed_cursor: batch.cursor };
      onProgress({ direction: "pull", table: [...new Set([...batch.rows, ...batch.tombstones].map(row => row.table_name))].join(", "), completed: merged - beforePage });
      batch.rows.length = 0; batch.tombstones.length = 0;
      if (batch.count < page.limit && batch.continuation !== true) break;
    }
    } catch (error) {
      // This boundary establishes only which status failed. The original error,
      // requests and all data/checkpoint outcomes remain unchanged.
      throw posFeedFailed(error, branchId);
    }
    const finish = result => deferredLocalChanges || deferredHeldDeletion
      ? result : posFeedCompleted(result, branchId);
    // Management replication is POS-only and has no signed-in membership authority.
    if (skipMembership)
      return finish({ merged, conflicts: conflictCount, membershipMirrored, membershipDeferred, deferredHeldDeletion, deferredLocalChanges });
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
    return finish({ merged, conflicts: conflictCount, membershipMirrored, membershipDeferred, deferredHeldDeletion, deferredLocalChanges });
  }
}
module.exports = { PullWorker };
