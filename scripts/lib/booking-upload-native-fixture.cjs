// Disposable SQL Server LocalDB. The caller provides the isolated Postgres writer.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { mkdtempSync, rmSync, rmdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { createLocal } = require("./shift-protocol-integration-fixture.cjs");
const { bookingUploadSql } = require("../../electron/db/installer-source.cjs");
const { AggregateRepository } = require("../../electron/db/repositories/aggregates.cjs");
const { aggregatePolicy } = require("../../electron/db/write-policy.cjs");
const { ChangeReader } = require("../../electron/sync/change-reader.cjs");
const { PushWorker } = require("../../electron/sync/push-worker.cjs");
const { createCashCheckoutRuntime } = require("../../electron/sync/cash-checkout-runtime.cjs");
const { MIXED_PROJECTION } = require("../../electron/sync/grouped-store-settings.cjs");

async function replayFromBackup(manager, verify) {
  const original = manager.pool;
  const sql = manager.sql();
  const queryIdentity = pool => pool.request().query(`
    SELECT DB_NAME() AS name, database_guid, family_guid
    FROM sys.database_recovery_status WHERE database_id=DB_ID();`);
  const [source] = (await queryIdentity(original)).recordset;
  const disposableName = /^ProtocolFixture_[a-f0-9]{32}$/;
  assert(disposableName.test(source.name));
  const connection = original.config.connectionString;
  assert(connection.includes("Server=np:") && connection.includes("LOCALDB#") && connection.includes(`Database=${source.name};`));
  const restoreName = "BookingRestore_" + randomUUID().replaceAll("-", "");
  const directory = mkdtempSync(join(tmpdir(), "codex-booking-restore-"));
  const backup = join(directory, "original.bak");
  const data = join(directory, "restored.mdf");
  const log = join(directory, "restored.ldf");
  const quote = value => "N'" + value.replaceAll("'", "''") + "'";
  let restored;
  try {
    const files = (await original.request().query("SELECT name,type FROM sys.database_files ORDER BY type;")).recordset;
    assert.deepEqual(files.map(file => file.type), [0, 1]);
    await original.request().input("backup", backup).query(`BACKUP DATABASE [${source.name}] TO DISK=@backup WITH COPY_ONLY,CHECKSUM;`);
    await original.request().input("backup", backup).query(`RESTORE DATABASE [${restoreName}] FROM DISK=@backup WITH CHECKSUM,
      MOVE ${quote(files[0].name)} TO ${quote(data)}, MOVE ${quote(files[1].name)} TO ${quote(log)};`);
    restored = new sql.ConnectionPool({ ...original.config, connectionString: connection.replace(
      `Database=${source.name};`, `Database=${restoreName};`) });
    await restored.connect();
    const [copy] = (await queryIdentity(restored)).recordset;
    assert.equal(copy.name, restoreName);
    assert.equal(copy.family_guid, source.family_guid);
    assert.notEqual(copy.database_guid, source.database_guid);
    manager.pool = restored;
    await verify();
  } finally {
    manager.pool = original;
    try {
      await restored?.close();
      await original.request().batch(`IF DB_ID(N'${restoreName}') IS NOT NULL BEGIN
        ALTER DATABASE [${restoreName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
        DROP DATABASE [${restoreName}];
      END;`);
    } finally {
      for (const file of [backup, data, log]) rmSync(file, { force: true });
      rmdirSync(directory);
    }
  }
}

async function verifyNativeBooking({ branchId, terminalId, push }) {
  const local = await createLocal(branchId);
  try {
    const { manager, registry, repository } = local;
    const query = statement => manager.pool.request().query(statement);
    const { database_guid: databaseGuid } = (await query(
      "SELECT LOWER(CONVERT(varchar(36),database_guid)) database_guid FROM sys.database_recovery_status WHERE database_id=DB_ID();")).recordset[0];
    const now = "2026-11-19T09:00:00.000Z";
    const shiftId = randomUUID(), bookingId = randomUUID(), saleId = randomUUID();
    const itemId = randomUUID(), saleTenderId = randomUUID();
    const cashier = { source: "pos", subject: "fixture", permissions: {
      can_process_sale: true, can_create_booking: true, can_manage_bookings: true, can_collect_booking: true,
    } };
    const legacy = new AggregateRepository(manager, repository);
    const backendOrigin = "https://booking-fixture.invalid";
    const projectOrigin = "https://booking-db.invalid";
    const scope = { branchId, terminalId, databaseGuid, installationGeneration: randomUUID(), feedEpoch: randomUUID() };
    const runtime = createCashCheckoutRuntime({
      configured: { scope, enrollment: { backendOrigin, projectOrigin, projection: MIXED_PROJECTION } },
      connectionManager: manager, registry,
      cloud: {
        requestContext: () => ({ pool: manager.pool, base: backendOrigin, profile: {},
          project: { projectOrigin, branchId },
          terminal: { tokenId: terminalId, locationId: branchId, deviceUse: "operations", deviceType: "pc",
            deviceBindingProof: "a".repeat(64) } }),
        assertRequestContext: () => {},
      },
      coordinator: { ownsExclusive: () => true, paused: false, withExclusive: work => work() },
      ready: () => true, handoff: async () => true,
    });
    assert.equal((await runtime.admit()).scope, scope);
    const commit = (kind, operations, actor = cashier) => runtime.commit(legacy, kind, {
      branchId, terminalId, operations, permissions: actor.permissions, ...aggregatePolicy(kind, operations, actor),
    });
    const insert = (table, row) => ({ kind: "insert", table, rows: [row] });
    const create = [insert("bookings", { id: bookingId, store_id: branchId, status: "active", total: 25, paid: 0,
      ref: "NATIVE-BOOKING", booking_kind: "standard", job_status: null, created_at: now, updated_at: now })];
    const tender = (id, amount, clientPaymentId, change = 0) => insert("booking_payments", {
      id, booking_id: bookingId, amount, method: "cash", client_payment_id: clientPaymentId,
      status: "settled", kind: "payment", change_given: change, paid_at: now, created_at: now,
    });
    const update = (version, values) => ({ kind: "update", table: "bookings", requireMatch: true,
      match: { id: bookingId, status: "active", row_version: version }, values: { store_id: branchId, ...values } });
    const deposit = [tender(randomUUID(), 10, randomUUID()), update(1, { paid: 10 })];
    const bill = "NATIVE-OFFLINE-" + saleId;
    const handover = [
      insert("sales", { id: saleId, bill_number: bill, client_transaction_id: saleId, store_id: branchId,
        shift_id: shiftId, created_at: now, subtotal_amount: 25, total_amount: 25, discount_amount: 0,
        tax_amount: 0, paid_amount: 25, change_amount: 5, payment_type: "cash", points_earned: 0,
        points_redeemed: 0, is_exchange: false, is_refunded: false, exchange_credit: 0, coupon_discount: 0,
        payments: [{ id: saleTenderId, method: "cash", amount: 25 }], rounding_adjustment: 0 }),
      tender(randomUUID(), 15, saleId, 5),
      update(2, { paid: 25, status: "collected", sale_receipt_no: bill, closed_at: now, updated_at: now }),
      insert("sale_items", { id: itemId, sale_id: saleId, branch_id: branchId, product_name: "Service",
        unit_price: 25, quantity: 1, discount_percent: 0, discount_amount: 0, is_return: false, created_at: now,
        tax_rate: 0, is_foc: false, coupon_discount: 0, unit_cost: 0, refunded_qty: 0 }),
      insert("payment_transactions", { id: saleTenderId, source_type: "sale", sale_id: saleId, store_id: branchId,
        shift_id: shiftId, terminal_id: terminalId, amount: 25, method: "cash", kind: "payment", note: "",
        paid_at: now, created_at: now, updated_at: now, status: "completed", metadata: {} }),
    ];
    await assert.rejects(commit("booking", create), { code: "EBOOKING_UPLOAD_STORAGE" });
    assert.equal((await query("SELECT COUNT(*) AS n FROM dbo.bookings;")).recordset[0].n, 0);
    await manager.pool.request().batch(bookingUploadSql());
    await manager.pool.request().batch(bookingUploadSql());
    await local.insert("shifts", { id: shiftId, store_id: branchId, terminal_id: terminalId,
      status: "OPEN", state: "ACTIVE", row_version: 1, opened_at: now });
    await commit("booking", create);
    await commit("payment", deposit);
    await assert.rejects(commit("sale", [handover[0], handover[1], update(1, handover[2].values), ...handover.slice(3)]), { code: "EBOOKING_CHANGED" });
    await assert.rejects(commit("sale", [handover[0], tender(randomUUID(), 14, saleId, 5), ...handover.slice(2)]), { code: "EBOOKING_CHANGED" });
    assert.throws(() => commit("sale", handover,
      { ...cashier, permissions: { ...cashier.permissions, can_collect_booking: false } }), { code: "PERMISSION_DENIED" });
    assert.equal((await query("SELECT COUNT(*) AS n FROM dbo.sales;")).recordset[0].n, 0);
    await commit("sale", handover);
    assert.equal((await commit("sale", handover)).replayed, true);
    assert.equal((await query("SELECT COUNT(*) AS n FROM dbo.pos_sync_booking_payloads_v1;")).recordset[0].n, 3);
    assert.equal((await query("SELECT COUNT(*) AS n FROM dbo.booking_payments;")).recordset[0].n, 2);

    let lost = false, handoverBatch;
    const calls = [];
    const makeWorker = () => new PushWorker({
      reader: new ChangeReader(manager, registry), checkpoints: {}, registry,
      cloud: { terminalId: () => terminalId, pushAggregate: async batch => {
        // SQL Server has already reached collected before any reconnect.
        const booking = batch.operations.find(op => op.table === "bookings").rows[0];
        calls.push([booking.status, booking.row_version, booking.paid]);
        const response = await push(batch);
        if (booking.status === "collected") {
          if (!lost) {
            lost = true;
            handoverBatch = batch;
            assert.equal(response.replayed, undefined);
            throw Object.assign(new Error("Lost acknowledgment"), { code: "ETIMEDOUT" });
          }
          assert.deepEqual(batch, handoverBatch);
          assert.equal(response.replayed, true);
        }
        return response;
      } },
    });
    await assert.rejects(makeWorker().pushAggregates(branchId, 1), { code: "ETIMEDOUT" });
    assert.equal((await query("SELECT COUNT(*) AS n FROM dbo.pos_sync_booking_payloads_v1;")).recordset[0].n, 1);
    const pendingReader = new ChangeReader(manager, registry);
    const [pending] = await pendingReader.pendingAggregates(branchId, 1);
    await assert.rejects(pendingReader.bookingUpload(pending, "other", terminalId, false), { code: "EBOOKING_UPLOAD_UNVERIFIED" });
    await assert.rejects(pendingReader.bookingUpload(pending, branchId, randomUUID(), false), { code: "EBOOKING_UPLOAD_UNVERIFIED" });
    await local.restart();
    await replayFromBackup(manager, async () => {
      await makeWorker().pushAggregates(branchId, 1);
      assert.equal((await query("SELECT COUNT(*) AS n FROM dbo.pos_sync_booking_payloads_v1;")).recordset[0].n, 0);
      assert.equal((await query("SELECT COUNT(*) AS n FROM dbo.sync_change_journal WHERE acknowledged_at IS NULL;")).recordset[0].n, 0);
      const reader = new ChangeReader(manager, registry);
      const changes = deposit.concat(handover.slice(1, 2)).filter(op => op.table === "booking_payments")
        .map(op => ({ key: { id: op.rows[0].id }, operation: "I" }));
      assert.deepEqual(await reader.bookingHandoverTracking(branchId, "booking_payments", changes),
        { pending: false, covered: new Set(changes) });
      const bookingTracking = { key: { id: bookingId }, operation: "U" };
      assert.deepEqual(await reader.bookingHandoverTracking(branchId, "bookings", [bookingTracking]),
        { pending: false, covered: new Set([bookingTracking]) });
    });
    assert.deepEqual(calls, [["active", 1, 0], ["active", 2, 10], ["collected", 3, 25], ["collected", 3, 25]]);
    assert.equal((await query("SELECT COUNT(*) AS n FROM dbo.pos_sync_booking_payloads_v1;")).recordset[0].n, 1);
    return { bookingId, saleId, bill, itemId, saleTenderId };
  } finally {
    await local.close();
  }
}

module.exports = { verifyNativeBooking };
