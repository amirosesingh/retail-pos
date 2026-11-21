// This opt-in test uses only a randomly owned LocalDB and a simulated hosted authority.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createLocal } = require('./lib/shift-protocol-integration-fixture.cjs');
const { ProductMergeRepository } = require('../electron/db/repositories/product-merge.cjs');
const { CloudClient } = require('../electron/sync/cloud-client.cjs');
const { request } = require('../electron/sync/product-merge-command.cjs');
const { createProductMergeRuntime, registerProductMerge } = require('../electron/product-merge-ipc.cjs');

assert.deepEqual(process.argv.slice(2), ['--run']);
const prepared = file => readFileSync(resolve(__dirname, '../database/sqlserver/prepared', file), 'utf8');
const branch = 'native-merge-fixture';
const projectOrigin = 'https://beta.fixture';
const guard = () => {};
const noReceipt = async () => ({ ok: true, receipt: null });
const known = receipt => async () => ({ ok: true, receipt });
const unexpectedSend = async () => assert.fail('verified receipt handling must not send another merge');

async function test() {
  const local = await createLocal(branch, { extraTables: ['products', 'product_barcodes', 'purchase_order_items', 'stock_transfer_items',
    'stock_adjustments', 'stock_delta_applied', 'item_activity_logs'] });
  const sql = () => local.manager.pool.request();
  const inTransaction = async work => {
    const tx = new (local.manager.sql().Transaction)(local.manager.pool);
    await tx.begin();
    try { await work(tx.request()); await tx.commit(); }
    catch (error) { await tx.rollback().catch(() => undefined); throw error; }
  };
  const seed = (sku, qty, stock = { [branch]: qty }) => ({ id: randomUUID(), owner_store_id: branch,
    name: `Fixture ${sku}`, sku, barcode: `${sku}-BAR`, barcode_aliases: [`${sku}-ALIAS`],
    row_version: 1, stock_quantity: qty, stock_by_store: stock, is_archived: false });
  const inputFor = ([master, ...losers]) => request({ version: 1, branchId: branch, operationId: randomUUID(),
    masterId: master.id, roster: [master, ...losers].map(row => ({ id: row.id, sku: row.sku, rowVersion: '1' })) }, branch);
  const readStock = () => sql().query(`SELECT LOWER(CONVERT(varchar(36),id)) id,sku,stock_quantity,stock_by_store,barcode_aliases,row_version
    FROM dbo.products ORDER BY sku;`).then(result => result.recordset);
  const head = () => sql().input('branch', branch).query(`SELECT coverage_state,coverage_generation FROM dbo.stock_history_heads WHERE store_id=@branch;`)
    .then(result => result.recordset[0]);
  const acceptFixtureChanges = () => sql().query(`
    UPDATE dbo.sync_checkpoints SET change_tracking_version=CHANGE_TRACKING_CURRENT_VERSION();
    SELECT CONVERT(varchar(30),CHANGE_TRACKING_CURRENT_VERSION()) version;`).then(result => result.recordset[0].version);
  const gone = row => ({ id: row.id, sku: row.sku, name: row.name, quantity: String(row.stock_quantity),
    barcode: row.barcode, aliases: row.barcode_aliases });
  const receiptFor = (input, master, goneRows, heldRows, qty) => ({ ok: true, operationId: input.operationId, branchId: branch,
    removed: goneRows.map(gone), held: heldRows.map(row => ({ id: row.id, name: row.name, code: 'PRODUCT_HAS_SALES_HISTORY' })),
    master: { id: master.id, sku: master.sku, rowVersion: goneRows.length ? '2' : '1', quantity: String(qty), stockTotal: String(qty),
      aliases: [...master.barcode_aliases, ...goneRows.flatMap(row => [row.sku, row.barcode, ...row.barcode_aliases])].sort() } });

  try {
    await sql().batch(prepared('031_stock_history_effective_ledger.sql'));
    await sql().batch(prepared('stock-history-stocktake-fence.sql'));
    const databaseGuid = (await sql().query(`SELECT LOWER(CONVERT(varchar(36),database_guid)) id
      FROM sys.database_recovery_status WHERE database_id=DB_ID();`)).recordset[0].id;
    const repo = new ProductMergeRepository(local.manager, databaseGuid);
    await sql().query('ALTER TABLE dbo.local_operation_receipts ALTER COLUMN note nvarchar(400) NULL;');
    const installMergeIntents = prepared('stock-history-product-merge-intents.sql');
    const install = guid => sql().input('guid', guid).query(`
      DECLARE @target uniqueidentifier=CONVERT(uniqueidentifier,@guid);
      EXEC sys.sp_set_session_context @key=N'pos_stock_history_merge_database_guid', @value=@target;
      ${installMergeIntents}`);
    await assert.rejects(install(randomUUID()), /PRODUCT_MERGE_DATABASE_UNVERIFIED/);
    assert.equal(await repo.intentStorageReady(local.manager.pool), false);
    await install(databaseGuid);
    assert.equal(await repo.intentStorageReady(local.manager.pool), true);
    const scope = { authorId: randomUUID(), terminalId: randomUUID(), projectOrigin, databaseGuid };
    const winner = seed('WINNER', 4), removed = seed('REMOVED', 2), held = seed('HELD', 9);
    for (const row of [winner, removed, held]) await local.insert('products', row);
    await sql().input('branch', branch).input('baseline', randomUUID()).query(`
      INSERT dbo.stock_history_heads(store_id,coverage_generation,coverage_state,baseline_id,coverage_from_ticks,coverage_through_ticks)
        VALUES(@branch,7,N'complete',@baseline,1,2);`);
    let version = await acceptFixtureChanges();
    const input = inputFor([winner, removed, held]);
    const outcome = receiptFor(input, winner, [removed], [held], 6);
    const before = await readStock();

    const legacyOperation = randomUUID();
    const legacy = await sql().input('operation', legacyOperation).input('product', winner.id)
      .input('note', JSON.stringify({ request: { branchId: branch } })).query(`
      INSERT dbo.local_operation_receipts(operation_id,operation_type,entity_id,note)
       VALUES(@operation,N'product_merge_authoritative',@product,@note);
      SELECT COL_LENGTH(N'dbo.local_operation_receipts',N'note') [width];`);
    assert.equal(legacy.recordset[0].width, 800);
    await assert.rejects(repo.prepare(input, scope, guard), { code: 'ESYNC_PRODUCT_MERGE_PREVIOUS_PENDING' });
    await sql().input('operation', legacyOperation).query('DELETE dbo.local_operation_receipts WHERE operation_id=@operation;');

    const stocktake = randomUUID();
    await inTransaction(tx => tx.input('stocktake', stocktake).input('branch', branch).input('project', projectOrigin)
      .input('terminal', scope.terminalId).input('database', databaseGuid).query(`
      DECLARE @expires datetime2(7)=DATEADD(second,30,SYSUTCDATETIME());
      EXEC dbo.pos_stock_history_arm_stocktake @stocktake,@project,@branch,@terminal,@database,@expires;`));
    await assert.rejects(repo.prepare(input, scope, guard), error => {
      assert.equal(error.code, 'ESYNC_PRODUCT_MERGE_PENDING_WORK', error.message);
      return true;
    });
    await inTransaction(tx => tx.input('stocktake', stocktake).input('database', databaseGuid).query(`
      DECLARE @generation uniqueidentifier=(SELECT generation FROM dbo.stock_history_stocktake_fences WHERE stocktake_id=@stocktake);
      EXEC dbo.pos_stock_history_release_stocktake @stocktake,@generation,@database;`));
    assert.deepEqual(await repo.prepare(input, scope, guard), { request: input, outcome: null });
    await assert.rejects(repo.finish(input, scope, guard, async () => { throw new Error('fixture reply lost'); }, noReceipt), /fixture reply lost/);
    await assert.rejects(repo.finish(input, scope, guard, unexpectedSend, known({ ...outcome, master: { ...outcome.master, quantity: '60' } })),
      { code: 'ESYNC_PRODUCT_MERGE_LOCAL_CONFLICT' });
    await sql().query(`ALTER TABLE dbo.products ADD CONSTRAINT CK_fixture_merge_commit CHECK(stock_quantity<>6);`);
    await assert.rejects(repo.finish(input, scope, guard, unexpectedSend, known(outcome)), /CK_fixture_merge_commit/);
    await sql().query(`ALTER TABLE dbo.products DROP CONSTRAINT CK_fixture_merge_commit;`);
    assert.deepEqual(await readStock(), before);
    assert.equal((await head()).coverage_state, 'complete');
    assert.equal(Number((await head()).coverage_generation), 7);

    await local.restart();
    await assert.rejects(repo.prepare(inputFor([winner, held]), scope, guard), { code: 'ESYNC_PRODUCT_MERGE_PREVIOUS_PENDING' });
    await assert.rejects(repo.prepare(inputFor([winner, removed, held]), { ...scope, authorId: randomUUID() }, guard),
      { code: 'ESYNC_PRODUCT_MERGE_PREVIOUS_PENDING' });
    assert.deepEqual(await repo.prepare(inputFor([winner, removed, held]), scope, guard), { request: input, outcome: null });
    assert.deepEqual(await repo.finish(input, scope, guard, unexpectedSend, known(outcome)), outcome);
    assert.deepEqual(await repo.prepare(input, scope, guard), { request: input, outcome });
    assert.deepEqual(await repo.finish(input, scope, guard, unexpectedSend, async () => { assert.fail('committed receipt must replay locally'); }), outcome);
    const after = await readStock();
    assert.equal(after.length, 2);
    assert.deepEqual(after.find(row => row.id === held.id), before.find(row => row.id === held.id));
    const master = after.find(row => row.id === winner.id);
    assert.deepEqual(JSON.parse(master.stock_by_store), { [branch]: 6 });
    assert.equal(master.stock_quantity, 6);
    assert.deepEqual(JSON.parse(master.barcode_aliases), outcome.master.aliases);
    assert.equal(master.row_version, 2);
    assert.equal((await head()).coverage_state, 'incomplete');
    assert.equal(Number((await head()).coverage_generation), 8);
    const tracked = await sql().input('version', version).query(`DECLARE @base bigint=CONVERT(bigint,@version);
      SELECT LOWER(CONVERT(varchar(36),id)) id,CONVERT(varchar(20),SYS_CHANGE_CONTEXT) origin
       FROM CHANGETABLE(CHANGES dbo.products,@base) ct; SELECT COUNT(*) total FROM dbo.sync_change_journal;`);
    assert.deepEqual(tracked.recordsets[0].map(row => row.id).sort(), [winner.id, removed.id].sort());
    assert(tracked.recordsets[0].every(row => row.origin === 'CLOUD'));
    assert.equal(tracked.recordsets[1][0].total, 0);
    console.log('PASS exact held/removed and stock conservation, constraint rollback, lost reply and restart recovery, coverage withdrawal, no generic echo');

    const netMaster = seed('NET', 0, { other: 0 }), positive = seed('POS', 2), negative = seed('NEG', -2);
    for (const row of [netMaster, positive, negative]) await local.insert('products', row);
    version = await acceptFixtureChanges();
    const net = inputFor([netMaster, positive, negative]);
    await repo.prepare(net, scope, guard);
    await repo.finish(net, scope, guard, async () => receiptFor(net, netMaster, [positive, negative], [], 0), noReceipt);
    const updated = (await readStock()).find(row => row.id === netMaster.id);
    assert.deepEqual(JSON.parse(updated.stock_by_store), { other: 0 });
    console.log('PASS accepted nonzero legs that net to zero retain the original stock-map keys');

    const target = seed('TARGET', 1), different = seed('OTHER-OWNER', 3);
    await local.insert('products', target);
    await local.insert('products', { ...different, owner_store_id: 'unrelated-fixture-branch' });
    await assert.rejects(repo.prepare(inputFor([target, held]), scope, guard), { code: 'ESYNC_PRODUCT_MERGE_PENDING_WORK' });
    await acceptFixtureChanges();
    await assert.rejects(repo.prepare(inputFor([target, different]), scope, guard), { code: 'ESYNC_PRODUCT_MERGE_LOCAL_CONFLICT' });
    await local.insert('held_orders', { id: randomUUID(), store_id: branch, status: 'held', lines: [{ productId: held.id }] });
    await acceptFixtureChanges();
    await assert.rejects(repo.prepare(inputFor([target, held]), scope, guard), { code: 'ESYNC_PRODUCT_MERGE_LOCAL_REFERENCES' });
    assert.equal((await readStock()).find(row => row.id === held.id).stock_quantity, 9);
    console.log('PASS active stocktake, pending Change Tracking, other branch, and unsent held-ticket deny the writer');

    const acceptedByPullMaster = seed('PULL-MASTER', 4), acceptedByPullLoser = seed('PULL-LOSER', 2), retained = seed('PULL-HELD', 3);
    for (const row of [acceptedByPullMaster, acceptedByPullLoser, retained]) await local.insert('products', row);
    await acceptFixtureChanges();
    const pulled = inputFor([acceptedByPullMaster, acceptedByPullLoser, retained]);
    const acceptedByPull = receiptFor(pulled, acceptedByPullMaster, [acceptedByPullLoser], [retained], 6);
    let cloudEnabled = false, cloudRequests = 0, mutationRequests = 0, exclusive = false, permission = true, savedReceipt = null;
    const published = [];
    const backendOrigin = 'https://pos.beta.fixture';
    const makeRuntime = () => createProductMergeRuntime({ enrollment: { branchId: branch, terminalId: scope.terminalId, databaseGuid, projectOrigin, backendOrigin },
      manager: local.manager, ready: () => true,
      session: { hasPosAuthority: () => permission, hasLevel: role => role === 'admin', identity: () => ({ authorId: scope.authorId }), epoch: () => 1 },
      cloud: { requestContext: () => ({ terminal: { tokenId: scope.terminalId, locationId: branch, deviceUse: 'operations', deviceType: 'pc',
        deviceBindingProof: 'a'.repeat(64) }, profile: {}, personProof: { accessToken: 'fixture' },
        project: { branchId: branch, projectOrigin }, base: backendOrigin, pool: local.manager.pool }),
        assertRequestContext: () => {}, productMerge: async (action, command) => {
          cloudRequests++;
          if (action === 'capability') return { ok: true, enabled: cloudEnabled };
          assert.equal(command.operationId, pulled.operationId, 'a fresh renderer proposal must reuse the saved operation ID');
          if (action === 'receipt') return { ok: true, receipt: savedReceipt };
          assert.equal(action, 'merge');
          mutationRequests++;
          throw new Error('fixture lost authoritative reply');
        } }, coordinator: { ownsExclusive: () => exclusive, withExclusive: async work => {
        exclusive = true;
        try { return await work(); } finally { exclusive = false; }
      } } });
    const ipc = new Map();
    const register = () => registerProductMerge({ ipcMain: { handle: (name, handle) => ipc.set(name, handle) }, runtime: makeRuntime(),
      isPosSender: event => event === 'POS', runWrite: work => work(), publish: event => published.push(event) });
    register();
    const capability = ipc.get('business:product-merge-capability');
    const merge = input => ipc.get('business:merge-products')('POS', input);
    assert.equal((await capability('other-frame', { branchId: branch })).code, 'PERMISSION_DENIED');
    assert.equal(cloudRequests, 0);
    permission = false;
    assert.equal((await capability('POS', { branchId: branch })).code, 'PERMISSION_DENIED');
    assert.equal(cloudRequests, 0);
    permission = true;
    assert.equal((await capability('POS', { branchId: branch })).code, 'ESYNC_PRODUCT_MERGE_UNVERIFIED');
    assert.equal(cloudRequests, 1);
    cloudEnabled = true;
    assert.deepEqual(await capability('POS', { branchId: branch }), { ok: true, enabled: true });
    assert.equal((await merge(pulled)).code, 'ESYNC_PRODUCT_MERGE_UNVERIFIED');
    assert.equal(cloudRequests, 5);
    assert.equal(mutationRequests, 1);

    const cloud = new CloudClient({ connectionManager: local.manager });
    const table = local.registry.tables.find(entry => entry.cloudTable === 'products');
    const applyPull = async (updates, retirements = []) => {
      const tx = new (local.manager.sql().Transaction)(local.manager.pool);
      await tx.begin(local.manager.sql().ISOLATION_LEVEL.SERIALIZABLE);
      try {
        await cloud.applyLocalBatch(tx, table, { branchId: branch, rows: updates.map(row_data => ({ row_data })),
          tombstones: retirements.map(id => ({ entity_id: JSON.stringify({ id }), tombstone: true })) });
        await tx.commit();
      } catch (error) { await tx.rollback().catch(() => undefined); throw error; }
    };
    const projected = { ...acceptedByPullMaster, stock_by_store: { other: 1, [branch]: 5 }, stock_quantity: 6,
      barcode_aliases: acceptedByPull.master.aliases, row_version: 2 };
    await applyPull([projected], [acceptedByPullLoser.id]);
    await local.restart();
    register();
    const recovered = inputFor([acceptedByPullMaster, acceptedByPullLoser, retained]);
    const pulledStock = await readStock(), pulledHead = await head();
    assert.equal((await merge(recovered)).code, 'ESYNC_PRODUCT_MERGE_LOCAL_CONFLICT');
    savedReceipt = { ...acceptedByPull, operationId: randomUUID() };
    assert.equal((await merge(recovered)).code, 'ESYNC_PRODUCT_MERGE_UNVERIFIED');
    savedReceipt = acceptedByPull;
    assert.equal((await merge(recovered)).code, 'ESYNC_PRODUCT_MERGE_LOCAL_CONFLICT');
    assert.deepEqual(await readStock(), pulledStock);
    assert.deepEqual(await head(), pulledHead);
    assert.deepEqual(published, []);

    const exact = { ...projected, stock_by_store: { [branch]: 6 } };
    await applyPull([exact, { ...retained, name: 'divergent held product' }]);
    assert.equal((await merge(recovered)).code, 'ESYNC_PRODUCT_MERGE_LOCAL_CONFLICT');
    await applyPull([retained]);
    const syncedRows = await readStock();
    const syncedVersion = (await sql().query('SELECT CONVERT(varchar(30),CHANGE_TRACKING_CURRENT_VERSION()) version;')).recordset[0].version;
    assert.deepEqual(await merge(recovered), acceptedByPull);
    assert.equal(mutationRequests, 1);
    assert.deepEqual(await readStock(), syncedRows);
    assert.equal(published.length, 1);
    assert.equal(Number((await head()).coverage_generation), Number(pulledHead.coverage_generation) + 1);
    const effects = await sql().input('version', syncedVersion).query(`
      DECLARE @base bigint=CONVERT(bigint,@version);
      SELECT COUNT(*) total FROM CHANGETABLE(CHANGES dbo.products,@base) ct;
      SELECT COUNT(*) total FROM dbo.sync_change_journal;`);
    assert.deepEqual(effects.recordsets.map(rows => rows[0].total), [0, 0]);
    console.log('PASS restarted IPC reconciles the exact pulled postimage without a second mutation or local product write');
  } finally {
    await local.close();
  }
}

test().catch(error => { console.error(error); process.exitCode = 1; });
