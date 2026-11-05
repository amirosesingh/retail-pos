// Opt-in, random owned LocalDB. No operator connection/profile is read.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { resolve } = require('node:path');
const { createLocal } = require('./lib/shift-protocol-integration-fixture.cjs');
const { AggregateRepository } = require('../electron/db/repositories/aggregates.cjs');
const { aggregatePolicy } = require('../electron/db/write-policy.cjs');
const { readShiftRules } = require('../electron/db/shift-sharing.cjs');
assert.deepEqual(process.argv.slice(2), ['--run']);
(async () => {
 const branch = 'SYNTHETIC-A', terminal = randomUUID(), otherTerminal = randomUUID(), shift = randomUUID(), otherShift = randomUUID();
 const local = await createLocal(branch); let groups = 0;
 const pass = name => { groups++; console.log('PASS ' + name); };
 const sql = local.manager.sql();
 const transaction = async work => {
  const tx = new sql.Transaction(local.manager.pool); await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try { const result = await work(tx); await tx.commit(); return result; }
  catch (error) { await Promise.resolve(tx.rollback()).catch(() => {}); throw error; }
 };
 try {
  await local.insert('pos_store_settings', { store_id: '', allow_branch_shift_sharing: false, max_drawer_cash_limit: 77 });
  await local.insert('pos_store_settings', { store_id: branch, allow_branch_shift_sharing: null });
  assert.equal((await transaction(tx => readShiftRules(local.manager, tx, branch))).sharing, false); pass('native NULL branch value inherits global OFF');
  for (const [id, terminalId] of [[shift, terminal], [otherShift, otherTerminal]]) await local.insert('shifts', { id, store_id: branch, terminal_id: terminalId, status: 'OPEN', state: 'ACTIVE', opening_float: 20, opened_at: new Date(), row_version: 1 });
  const writer = new AggregateRepository(local.manager, local.repository);
  const saleOp = selected => ({ table: 'sales', kind: 'insert', rows: [{ id: randomUUID(), bill_number: 'SYNTHETIC-' + randomUUID(), store_id: branch, shift_id: selected, total_amount: 10, payment_type: 'cash', payments: [], is_refunded: false, created_at: new Date().toISOString() }] });
  const commit = (op, terminalId = terminal, extra = {}) => writer.commit('sale', { operationId: randomUUID(), branchId: branch, terminalId, permissions: { can_process_sale: true }, ...aggregatePolicy('sale', [op], { source: 'pos', subject: 'fixture', level: 'cashier', permissions: { can_process_sale: true } }), ...extra, operations: [op] });
  const wrong = saleOp(otherShift);
  await assert.rejects(() => commit(wrong), error => error.code === 'ESHIFT_TERMINAL');
  assert.equal((await local.manager.pool.request().query('SELECT count(*) n FROM dbo.sales;')).recordset[0].n, 0);
  assert.equal((await local.manager.pool.request().query('SELECT count(*) n FROM dbo.local_operation_receipts;')).recordset[0].n, 0); pass('foreign-till checkout rolls back sale and upload receipt atomically');
  const own = saleOp(shift); await commit(own);
  assert.equal((await local.manager.pool.request().query('SELECT count(*) n FROM dbo.sales;')).recordset[0].n, 1); pass('actual native aggregate accepts own checkout');
  await commit(saleOp(shift), terminal); pass('another cashier on same till uses the same shift');
  const openingScope = { branchId: branch, terminalId: randomUUID(), enforcePermissions: true, permissions: { can_open_shift: true } };
  await transaction(tx => local.repository.assertShiftOpening(tx, { table: 'shifts', kind: 'insert', rows: [{ id: randomUUID(), terminal_id: openingScope.terminalId, opening_float: 20, status: 'OPEN' }] }, openingScope));
  await assert.rejects(() => transaction(tx => local.repository.assertShiftOpening(tx, { table: 'shifts', kind: 'insert', rows: [{ terminal_id: terminal, opening_float: 20, status: 'OPEN' }] }, { ...openingScope, terminalId: terminal })), error => error.code === 'ESHIFT_OPEN'); pass('OFF opening checks the own till without blocking other tills');
  await commit(saleOp(otherShift), terminal, { managementDevice: true }); pass('Main-proven management classification preserves authorized checkout');
  await local.manager.pool.request().query("UPDATE dbo.pos_store_settings SET allow_branch_shift_sharing=1 WHERE store_id=N'';");
  await commit(saleOp(otherShift)); pass('sharing ON preserves same-branch checkout');
  await local.restart();
  assert.equal((await transaction(tx => readShiftRules(local.manager, tx, branch))).sharing, true); pass('local rule survives SQL connection restart');
  await local.manager.pool.request().query('ALTER TABLE dbo.pos_store_settings DROP COLUMN allow_branch_shift_sharing;');
  assert.equal((await transaction(tx => readShiftRules(local.manager, tx, branch))).sharing, true); pass('old-schema rule compatibility remains ON');
  const upgrade = readFileSync(resolve(__dirname, '../database/sqlserver/prepared/027_shift_branch_sharing.sql'), 'utf8');
  const caller = new sql.Transaction(local.manager.pool); await caller.begin();
  await new sql.Request(caller).batch('SET XACT_ABORT ON;');
  await assert.rejects(() => new sql.Request(caller).batch(upgrade), error => String(error.message).includes('outside an existing transaction'));
  const callerState = (await new sql.Request(caller).query('SELECT @@TRANCOUNT transactions,XACT_STATE() state;')).recordset[0];
  assert.equal(callerState.transactions, 1); assert.equal(callerState.state, 1); await caller.rollback();
  pass('local upgrade refuses an existing caller transaction without dooming it');
  await local.manager.pool.request().batch(upgrade);
  await local.manager.pool.request().batch(upgrade);
  const preserved = (await local.manager.pool.request().query("SELECT allow_branch_shift_sharing,max_drawer_cash_limit FROM dbo.pos_store_settings WHERE store_id=N'';")).recordset[0];
  assert.equal(preserved.allow_branch_shift_sharing, null); assert.equal(preserved.max_drawer_cash_limit, 77); pass('additive local upgrade is repeatable and preserves existing settings');
  console.log(`PASS ${groups} actual isolated SQL Server shift-sharing groups`);
 } finally { await local.close(); console.log('Cleaned owned shift-sharing LocalDB'); }
})().catch(error => { console.error(error.code ?? '', error.message, error.sqlDetail ?? ''); process.exitCode = 1; });
