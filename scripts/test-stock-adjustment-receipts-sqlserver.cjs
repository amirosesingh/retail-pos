// Disposable Windows SqlLocalDB only. No saved terminal profiles or hosted writes.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createLocal, createAuthorKeys } = require('./lib/shift-protocol-integration-fixture.cjs');
const { AggregateRepository } = require('../electron/db/repositories/aggregates.cjs');
const { StockHistoryStore } = require('../electron/db/stock-history.cjs');
const { aggregatePolicy } = require('../electron/db/write-policy.cjs');
const { verifyStockSourceMembership } = require('../electron/shared/stock-source-cohort.mjs');

assert.deepEqual(process.argv.slice(2), ['--run']);

async function test() {
  const branch = 'adjustment-till', other = 'another-till';
  const product = randomUUID(), terminal = randomUUID(), actor = randomUUID(), draft = randomUUID();
  const local = await createLocal(branch, { extraTables: ['products', 'stock_adjustments', 'stock_count_drafts', 'stock_delta_applied'] });
  const authorKeys = createAuthorKeys();
  try {
    const request = () => local.manager.pool.request();
    const migration = readFileSync(resolve(__dirname, '../database/sqlserver/prepared/031_stock_history_effective_ledger.sql'), 'utf8');
    await request().batch(migration);
    await request().batch(`ALTER TABLE dbo.stock_delta_applied ALTER COLUMN applied_at datetimeoffset(7) NOT NULL;
      ALTER TABLE dbo.stock_delta_applied ADD CONSTRAINT DF_adjustment_fixture_applied_at DEFAULT (SYSDATETIMEOFFSET()) FOR applied_at;`);
    await local.insert('stores', { id: other, name: 'Synthetic second branch' });
    await local.insert('products', { id: product, name: 'Count fixture', owner_store_id: branch,
      stock_by_store: { [branch]: 10, [other]: 4 }, stock_quantity: 14, row_version: 1 });
    await local.insert('stock_count_drafts', { id: draft, store_id: branch, terminal_id: terminal, status: 'draft' });

    const binding = { projectOrigin: 'https://beta-adjustment.fixture', terminalId: terminal, authorId: actor };
    const keys = authorKeys.keys;
    const { keyId, publicKey } = keys.prepare(binding);
    keys.markEnrolled(binding, { keyId, publicKey });
    const subject = 'stock-fixture', action = 'ADJUST';
    const context = { key: 'stock-fixture', actorId: actor, branchId: branch, terminalId: terminal, requireSourceManifests: true,
      author: { action,
        signMovement: (row, sourceManifestJson) => keys.signStockEvent(binding, {
          expectedKeyId: keyId, subject, branchId: branch, action, operationId: row.operation_id,
          movementId: row.id, payloadHash: row.payload_hash, sourceManifestJson,
        }),
        signSourceCohort: input => keys.signStockSourceCohort(binding, { ...input, expectedKeyId: keyId, subject, branchId: branch, action }),
      } };
    const history = new StockHistoryStore(local.manager, { readContext: () => context });
    const writer = new AggregateRepository(local.manager, local.repository, { stockHistory: history });
    const identity = { source: 'pos', level: 'staff', subject, authorId: actor, permissions: { can_adjust_stock: true } };
    const commit = async (input, branchId = branch, terminalId = terminal) => writer.commit('stock', {
      ...input, branchId, terminalId, permissions: identity.permissions, ...aggregatePolicy('stock', input.operations, identity),
    });
    const newCount = (previous, updated, { id = randomUUID(), storeId = branch, foreignStock = 4, postDraft = false } = {}) => ({
      operationId: randomUUID(), id,
      operations: [
        { kind: 'upsert', table: 'products', rows: [{ id: product, owner_store_id: branch, stock_by_store: { [branch]: updated, [other]: foreignStock },
          stock_quantity: updated + foreignStock }] },
        { kind: 'upsert', table: 'stock_adjustments', rows: [{ id, product_id: product, store_id: storeId, previous_stock: previous,
          updated_stock: updated, delta: updated - previous, reason: 'count', terminal_id: terminal,
          created_at: '2026-11-20T12:00:00Z', ...(postDraft ? { draft_id: draft } : {}) }] },
        ...(postDraft ? [{ kind: 'update', table: 'stock_count_drafts', match: { id: draft }, values: { status: 'posted' }, requireMatch: true }] : []),
      ],
    });
    const productState = async () => {
      const [row] = (await request().input('product', product).query(`SELECT stock_quantity,stock_by_store,row_version
        FROM dbo.products WHERE id=@product;`)).recordset;
      return { ...row, stock_by_store: JSON.parse(row.stock_by_store) };
    };
    const changedRows = async ({ operationId, id }) => (await request().input('op', operationId).input('id', id).query(`SELECT
      (SELECT COUNT(*) FROM dbo.stock_adjustments WHERE id=@id) audit,
      (SELECT COUNT(*) FROM dbo.stock_delta_applied WHERE movement_id=@id) delta,
      (SELECT COUNT(*) FROM dbo.local_operation_receipts WHERE operation_id=@op) receipt,
      (SELECT COUNT(*) FROM dbo.stock_history_movements WHERE operation_id=@op) movements,
      (SELECT COUNT(*) FROM dbo.stock_history_source_cohorts WHERE operation_id=@op) cohorts,
      (SELECT COUNT(*) FROM dbo.sync_change_journal WHERE aggregate_id=@op) journal;`)).recordset[0];
    const empty = { audit: 0, delta: 0, receipt: 0, movements: 0, cohorts: 0, journal: 0 };

    const first = newCount(10, 7, { postDraft: true });
    assert.deepEqual(await commit(first), { ok: true, operationId: first.operationId, replayed: false, affected: 4 });
    const saved = await productState();
    assert.deepEqual(saved, { stock_quantity: 11, stock_by_store: { [branch]: 7, [other]: 4 }, row_version: 2 });
    assert.deepEqual(await changedRows(first), { audit: 1, delta: 1, receipt: 1, movements: 1, cohorts: 1, journal: 4 });
    const { recordsets } = await request().input('op', first.operationId).input('id', first.id).input('draft', draft).query(`
      SELECT LOWER(CONVERT(varchar(36),movement_id)) movement_id,LOWER(CONVERT(varchar(36),product_id)) product_id,
        store_id,delta,CAST(CASE WHEN applied_at IS NULL THEN 0 ELSE 1 END AS bit) timestamp_recorded
      FROM dbo.stock_delta_applied WHERE movement_id=@id;
      SELECT entity_id,operation,branch_id,entity_version,acknowledged_at FROM dbo.sync_change_journal
        WHERE aggregate_id=@op AND entity_type=N'stock_delta_applied';
      SELECT staff_id,terminal_id FROM dbo.stock_adjustments WHERE id=@id;
      SELECT status FROM dbo.stock_count_drafts WHERE id=@draft;
      SELECT payload_json,author_proof_json FROM dbo.stock_history_movements WHERE operation_id=@op;
      SELECT proof_json,members_json FROM dbo.stock_history_source_cohorts WHERE operation_id=@op;`);
    assert.deepEqual(recordsets[0], [{ movement_id: first.id, product_id: product, store_id: branch, delta: -3, timestamp_recorded: true }]);
    const [{ entity_id, ...entry }] = recordsets[1];
    assert.deepEqual(JSON.parse(entity_id), { movement_id: first.id });
    assert.deepEqual({ ...entry, entity_version: Number(entry.entity_version) },
      { operation: 'insert', branch_id: branch, entity_version: 1, acknowledged_at: null });
    assert.equal(recordsets[2][0].staff_id.toLowerCase(), actor);
    assert.equal(recordsets[2][0].terminal_id.toLowerCase(), terminal);
    assert.deepEqual(recordsets[3], [{ status: 'posted' }]);
    const expectedRefs = [['stock_adjustments', first.id, '-3'], ['stock_delta_applied', first.id, '-3']];
    const payload = JSON.parse(recordsets[4][0].payload_json);
    assert.equal(payload[8], '-3');
    assert.deepEqual(payload[16], expectedRefs);
    const manifest = JSON.parse(JSON.parse(recordsets[4][0].author_proof_json).sourceManifestJson);
    assert.deepEqual(manifest.document, { type: 'stock_adjustments', id: first.id });
    assert.deepEqual(manifest.sourceRefs, expectedRefs);
    assert.equal(manifest.authorId, actor);
    const [sourceCohort] = recordsets[5], proof = JSON.parse(sourceCohort.proof_json);
    assert.deepEqual(await verifyStockSourceMembership(JSON.parse(sourceCohort.members_json)[0],
      { root: proof.sourceRoot, count: proof.sourceCount }), manifest);
    console.log('PASS committed stock, audit, posted draft, canonical receipt, journal and signed movement share one native transaction');

    await local.restart();
    assert.deepEqual(await commit(first), { ok: true, operationId: first.operationId, replayed: true, affected: 0 });
    await assert.rejects(commit(first, other), { code: 'SYNC_BRANCH_FORBIDDEN' });
    await assert.rejects(commit(first, branch, randomUUID()), { code: 'SYNC_BRANCH_FORBIDDEN' });
    assert.deepEqual(await productState(), saved);
    assert.deepEqual(await changedRows(first), { audit: 1, delta: 1, receipt: 1, movements: 1, cohorts: 1, journal: 4 });
    console.log('PASS replay after SQL restart returns the original operation without another effect; foreign branch and terminal are refused');

    const duplicate = newCount(7, 6, { id: first.id });
    await assert.rejects(commit(duplicate), { code: 'ESTOCK_ADJUSTMENT_UNVERIFIED' });
    assert.deepEqual(await changedRows(duplicate), { ...empty, audit: 1, delta: 1 });
    for (const [input, code] of [
      [newCount(7, 6, { storeId: other }), 'SYNC_BRANCH_FORBIDDEN'],
      [newCount(6, 5), 'ESTOCK_ADJUSTMENT_UNVERIFIED'],
      [newCount(7, 6, { foreignStock: 5 }), 'ESTOCK_ADJUSTMENT_UNVERIFIED'],
    ]) {
      await assert.rejects(commit(input), { code });
      assert.deepEqual(await changedRows(input), empty);
    }
    const spoofed = newCount(7, 6);
    spoofed.operations.push({ kind: 'insert', table: 'stock_delta_applied', rows: [{ movement_id: spoofed.id, product_id: product, store_id: branch, delta: -1 }] });
    await assert.rejects(commit(spoofed), { code: 'PERMISSION_DENIED' });
    assert.deepEqual(await changedRows(spoofed), empty);
    assert.deepEqual(await productState(), saved);
    console.log('PASS duplicate, stale, foreign and caller-supplied receipt attempts leave saved stock and evidence unchanged');

    const failed = newCount(7, 6);
    await request().query(`ALTER TABLE dbo.sync_change_journal WITH NOCHECK ADD CONSTRAINT CK_fixture_reject_receipt CHECK(entity_type<>N'stock_delta_applied');`);
    await assert.rejects(commit(failed), { code: 'ESQLSERVER_WRITE', stage: 'stock adjustment receipt', table: 'stock_delta_applied' });
    assert.deepEqual(await productState(), saved);
    assert.deepEqual(await changedRows(failed), empty);
    await request().query('ALTER TABLE dbo.sync_change_journal DROP CONSTRAINT CK_fixture_reject_receipt;');
    const zero = newCount(7, 7);
    assert.equal((await commit(zero)).ok, true);
    assert.deepEqual(await changedRows(zero), { ...empty, audit: 1, receipt: 1, journal: 2 });
    console.log('PASS late journal failure rolls back every write, and zero adjustment keeps its audit without a stock effect');
  } finally {
    await local.close();
    authorKeys.close();
  }
}

test().catch(error => { console.error(error); process.exitCode = 1; });
