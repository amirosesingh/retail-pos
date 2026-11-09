import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createLocal, createAuthorKeys } = require("./shift-protocol-integration-fixture.cjs");
const { ChangeReader } = require("../../electron/sync/change-reader.cjs");
const { ShiftIntentStore } = require("../../electron/db/shift-intents.cjs");
const { parseFinancialCorrection, applyFinancialCorrection } = require("../../electron/sync/grouped-financial-corrections.cjs");

export async function verifyManagedShiftAndDrawerFeed({ db, read, table, branch, terminal, cashier,
  state, stateRole, addShift, original, test }) {
  const epoch = randomUUID();
  const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
  const preparation = [
    "pos-sync-feed-v1.sql", "pos-sync-store-settings-v1.sql", "pos-sync-grouped-gateway-v1.sql",
    "pos-sync-cash-settings-gateway-v1.sql", "pos-sync-cash-legacy-coverage-v1.sql", "pos-sync-live-stock-v1.sql",
    "pos-sync-extended-feed-v1.sql", "pos-sync-cash-settings-recovery-v1.sql", "pos-sync-managed-shift-feed-v1.sql",
  ];
  const history = await read("scripts/preparation/shift-financial-operation-history.sql");
  const guard = history.slice(history.indexOf("CREATE FUNCTION fin62_history_preparation.guard_shift_graph()"),
    history.indexOf("REVOKE ALL ON FUNCTION fin62_history_preparation.guard_shift_graph()"));
  assert(guard.startsWith("CREATE FUNCTION"));
  await db.exec(`CREATE SCHEMA fin62_history_preparation;
    REVOKE ALL ON SCHEMA fin62_history_preparation FROM PUBLIC,anon,authenticated,service_role;
    CREATE TABLE fin62_history_preparation.protected_shifts(shift_id uuid PRIMARY KEY,branch_id text NOT NULL);
    CREATE TABLE fin62_history_preparation.graph_context(pid integer NOT NULL,xid xid8 NOT NULL,
      branch_id text NOT NULL,shift_id uuid NOT NULL,PRIMARY KEY(pid,xid));
    ${guard}
    ${table("products")}
    ALTER TABLE public.products ADD COLUMN IF NOT EXISTS owner_store_id text, ADD COLUMN IF NOT EXISTS row_version integer DEFAULT 1;
    ${table("drawer_events")}
    ALTER TABLE public.drawer_events ADD PRIMARY KEY(id);`);
  for (const name of preparation) await db.exec(await read(`scripts/preparation/${name}`));
  const correctionFeed = await read("scripts/preparation/pos-sync-financial-corrections-feed-v1.sql");
  const helper = correctionFeed.slice(correctionFeed.indexOf("CREATE FUNCTION pos_sync_feed_v1.financial_change("),
    correctionFeed.indexOf("CREATE FUNCTION pos_sync_feed_v1.publish_refund_correction()"));
  assert(helper.startsWith("CREATE FUNCTION"));
  await db.exec(helper);
  await db.exec(await read("scripts/preparation/pos-sync-drawer-audit-feed-v1.sql"));
  await db.query("INSERT INTO pos_sync_feed_v1.feed_heads VALUES ('default',$1,$2,0,0)", [branch, epoch]);
  await db.query(`INSERT INTO pos_sync_feed_v1.settings_pilots(organization_id,scope_id,epoch)
    VALUES ('default',$1,$2)`, [branch, epoch]);
  await scalar("SELECT pos_sync_feed_v1.arm_cash_settings_scope('default',$1,$2)", [branch, epoch]);
  await scalar("SELECT pos_sync_feed_v1.arm_cash_stock_scope('default',$1,$2)", [branch, epoch]);
  await scalar("SELECT pos_sync_feed_v1.arm_extended_scope('default',$1,$2)", [branch, epoch]);

  const readGroups = async kind => scalar(`SELECT coalesce(jsonb_agg(jsonb_build_object(
    'seq',seq::text,'operation_id',operation_id,'changes',changes)||metadata ORDER BY seq),'[]'::jsonb)
    FROM pos_sync_feed_v1.extended_publications WHERE metadata->'financial'->>'kind'=$1`, [kind]);
  const shift = await addShift();
  const drawer = randomUUID();
  await db.query("INSERT INTO fin62_history_preparation.protected_shifts VALUES($1,$2)", [shift, branch]);
  let close, recount, request, result;
  await test("one scoped group per protected close or recount and exact drawer audit stage", async () => {
    assert.deepEqual(await readGroups("shift_v1"), []);
    await state("authenticated", cashier);
    assert.equal((await original(shift)).rows[0].state, "CLOSED");
    assert.equal((await original(shift)).rows[0].state, "CLOSED");
    await stateRole();
    const originalGroups = await readGroups("shift_v1");
    assert.equal(originalGroups.length, 1);
    close = parseFinancialCorrection(originalGroups[0], branch);
    assert.throws(() => parseFinancialCorrection(originalGroups[0], "other"), /verified closing scope/);
    const tampered = structuredClone(originalGroups[0]);
    tampered.changes[0].row_data.graph_json += " ";
    assert.throws(() => parseFinancialCorrection(tampered, branch), /verified closing scope/);
    await state("authenticated", cashier);
    assert.equal(await scalar("SELECT public.shift_recount_submit($1,21.01,'second verified count',NULL,NULL,$2)",
      [shift, terminal]), "CLOSED");
    await stateRole();
    const graphs = await readGroups("shift_v1");
    assert.equal(graphs.length, 2);
    recount = parseFinancialCorrection(graphs[1], branch);
    assert(recount.rowVersion > close.rowVersion);
    assert.equal(recount.graph.tables.find(entry => entry.table === "shift_cash_counts").rows.length, 2);

    await db.query(`INSERT INTO public.drawer_events(id,store_id,terminal_id,shift_id,staff_id,staff_name,role,
      reason,note,approved_by,created_at) VALUES($1,$2,$3,$4,$5,'Fixture Cashier','staff','Till audit',
      'OPEN_REQUESTED',NULL,'2026-11-09T07:00:00.123456Z')`, [drawer, branch, terminal, shift, cashier]);
    await db.query("UPDATE public.drawer_events SET note='OPENED' WHERE id=$1", [drawer]);
    await db.query("UPDATE public.drawer_events SET note='OPENED' WHERE id=$1", [drawer]);
    const audit = await readGroups("drawer_v1");
    assert.equal(audit.length, 2);
    [request, result] = audit.map(group => parseFinancialCorrection(group, branch));
    assert.equal(request.row.note, "OPEN_REQUESTED");
    assert.equal(result.row.note, "OPENED");
    assert.throws(() => parseFinancialCorrection(audit[0], "other"), /verified scope/);
  });

  await test("LocalDB preserves pending shifts and replays drawer audit without changing the saved result", async () => {
    const local = await createLocal(branch, { extraTables: ["drawer_events"] });
    const { manager, registry } = local;
    const worker = { registry, connectionManager: manager, reader: new ChangeReader(manager, registry) };
    const projectOrigin = "https://fixture.example";
    const source = { terminal: { tokenId: terminal }, project: { projectOrigin } };
    const inTransaction = async work => {
      const sql = manager.sql();
      const transaction = new sql.Transaction(manager.pool);
      await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      try {
        const changed = await work(transaction);
        await transaction.commit();
        return changed;
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    };
    const apply = (facts, currentSource = source) => inTransaction(transaction =>
      applyFinancialCorrection(worker, transaction, { branch, financialEpoch: epoch, source: currentSource }, facts));
    try {
      await local.insert("shifts", { id: shift, store_id: branch, terminal_id: terminal, status: "OPEN", state: "CASH_COUNT_REQUIRED",
        opening_float: "1.005", opened_at: "2026-11-05T00:00:00Z", row_version: 1 });
      await manager.pool.request().query("UPDATE dbo.sync_checkpoints SET change_tracking_version=CHANGE_TRACKING_CURRENT_VERSION();");
      const operation = randomUUID();
      await manager.pool.request().input("key", JSON.stringify({ id: shift })).input("op", operation).input("branch", branch)
        .query(`INSERT dbo.sync_change_journal(entity_type,entity_id,branch_id,operation,entity_version,aggregate_id)
          VALUES(N'shifts',@key,@branch,N'update',1,@op);`);
      await assert.rejects(apply(close), { code: "ELOCAL_UPLOAD_PENDING" });
      const shiftState = async () => (await manager.pool.request().input("id", shift)
        .query("SELECT status,state,row_version FROM dbo.shifts WHERE id=@id;")).recordset[0];
      assert.equal((await shiftState()).status, "OPEN");
      await manager.pool.request().input("op", operation).query("DELETE dbo.sync_change_journal WHERE aggregate_id=@op;");
      assert(await apply(close) > 0);
      assert.equal(await apply(close), 0);
      assert(await apply(recount) > 0);
      assert.equal(await apply(recount), 0);
      assert.equal((await shiftState()).row_version, recount.rowVersion);
      await assert.rejects(apply(close), { code: "ESYNC_GROUPED_REVIEW_REQUIRED" });

      const vault = createAuthorKeys();
      try {
        const intentId = randomUUID();
        const payload = { version: 1, intentId, branchId: branch, shiftId: shift, kind: "ORIGINAL",
          operations: close.graph.tables.map(part => ({ table: part.table, rows: part.rows })) };
        const raw = JSON.stringify(payload);
        const payloadHash = createHash("sha256").update(raw).digest("hex");
        const binding = { projectOrigin, terminalId: terminal, authorId: cashier };
        const key = vault.keys.prepare(binding);
        vault.keys.markEnrolled(binding, { keyId: key.keyId, publicKey: key.publicKey });
        const signature = vault.keys.signIntent(binding, { expectedKeyId: key.keyId, subject: cashier, branchId: branch,
          shiftId: shift, intentId, action: "ORIGINAL", payloadHash });
        const coverage = { version: 1, mode: "matched_request_rows", tables: close.graph.tables.map(part => {
          const columns = registry.tables.find(entry => entry.cloudTable === part.table).columns.map(column => column.cloudColumn);
          const serverManagedFields = columns.filter(name => ["updated_at", "row_version"].includes(name));
          return { table: part.table, fields: columns.filter(name => !serverManagedFields.includes(name)),
            serverManagedFields, rows: part.rows.map(row => ({ id: row.id,
              serverValues: Object.fromEntries(serverManagedFields.map(name => [name, row[name]])) })) };
        }) };
        await inTransaction(async transaction => {
          await transaction.request().input("id", intentId).input("branch", branch).input("shift", shift)
            .input("payload", raw).input("hash", payloadHash).input("key", key.keyId).input("signature", JSON.stringify(signature))
            .query(`INSERT dbo.pos_sync_shift_intents(intent_id,branch_id,shift_id,intent_kind,payload_json,payload_hash)
              VALUES(@id,@branch,@shift,N'ORIGINAL',@payload,@hash);
              INSERT dbo.pos_sync_shift_authors(intent_id,scope_hash,key_id,attestation_json)
              VALUES(@id,@hash,@key,@signature);`);
          await new ShiftIntentStore(manager, registry).acknowledge(transaction, { ...payload, payloadHash }, {
            intent_id: intentId, intent_hash: payloadHash, accepted_token: close.graph.graphToken,
            current_token: recount.graph.graphToken, superseded: true, coverage,
          });
        });
        assert.equal(await apply(close), 0);
        assert.equal((await shiftState()).row_version, recount.rowVersion);
        await assert.rejects(apply(close, { ...source, project: { projectOrigin: "https://other.example" } }),
          { code: "ESYNC_GROUPED_REVIEW_REQUIRED" });
      } finally { vault.close(); }

      assert.equal(await apply(request), 1);
      assert.equal(await apply(result), 1);
      assert.equal(await apply(request), 0);
      assert.equal(await apply(result), 0);
      const audit = (await manager.pool.request().input("id", drawer).query(`
        SELECT note,staff_name FROM dbo.drawer_events WHERE id=@id;`)).recordset;
      assert.deepEqual(audit, [{ note: "OPENED", staff_name: "Fixture Cashier" }]);
    } finally { await local.close(); }
  });
}
