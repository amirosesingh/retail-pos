// Runs only on a uniquely owned, disposable SQL Server LocalDB instance.
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { createLocal, createAuthorKeys } = require("./lib/shift-protocol-integration-fixture.cjs");
const { AggregateRepository } = require("../electron/db/repositories/aggregates.cjs");
const { OperationsRepository } = require("../electron/db/repositories/operations.cjs");
const { loadRegistry } = require("../electron/db/schema-registry.cjs");
const { SaleEventOutbox, hasCashAcceptance } = require("../electron/db/sale-event-outbox.cjs");
const { ShiftAuthorAuthority } = require("../electron/shift-authority.cjs");
const { aggregatePolicy } = require("../electron/db/write-policy.cjs");

async function main() {
  const mode = process.argv[2];
  assert(process.argv.length === 3 && ["--run", "--wire", "--attested-wire"].includes(mode));
  const branchId = "sale-outbox-fixture";
  const terminalId = randomUUID();
  const shiftId = randomUUID();
  const productId = randomUUID();
  const price = "19.123456789123";
  const local = await createLocal(branchId);
  const { manager } = local;
  const keyFixture = mode === "--attested-wire" ? createAuthorKeys() : null;
  try {
    const registry = loadRegistry();
    for (const name of ["products", "item_activity_logs", "settings_scoped", "stock_transfers", "stock_transfer_items"]) {
      const table = registry.tables.find(table => table.sqlServerTable === name);
      const primary = table.columns.filter(column => column.primaryKey).map(column => column.sqlServerColumn);
      const columns = table.columns.map(column => `[${column.sqlServerColumn}] ${column.sqlServerType} ${column.primaryKey ? "NOT NULL" : "NULL"}`);
      await manager.pool.request().batch(`CREATE TABLE dbo.[${name}] (${columns.join(",")}, PRIMARY KEY (${primary.map(name => `[${name}]`).join(",")}));`);
    }
    await local.insert("shifts", { id: shiftId, store_id: branchId, terminal_id: terminalId, status: "OPEN", state: "ACTIVE" });
    await manager.pool.request().input("product", productId).input("branch", branchId).input("price", price)
      .input("stock", JSON.stringify({ [branchId]: 10 }))
      .query(`INSERT dbo.products(id,owner_store_id,name,stock_quantity,stock_by_store,selling_price,cost_price,is_archived)
        VALUES(@product,@branch,N'Fixture product',10,@stock,@price,0,0);`);

    const repository = new OperationsRepository(manager, registry);
    const legacy = new AggregateRepository(manager, repository);
    const pilot = new AggregateRepository(manager, repository, { saleOutbox: new SaleEventOutbox(manager, registry) });
    const identity = { source: "pos", level: "cashier", subject: "fixture.cashier", permissions: { can_process_sale: true } };
    const count = async (table, predicate, id) => Number((await manager.pool.request().input("id", id)
      .query(`SELECT COUNT(*) AS n FROM dbo.[${table}] WHERE ${predicate};`)).recordset[0].n);
    const stock = async () => Number((await manager.pool.request().input("product", productId)
      .query("SELECT stock_quantity FROM dbo.products WHERE id=@product;")).recordset[0].stock_quantity);
    const event = async id => (await manager.pool.request().input("id", id)
      .query("SELECT * FROM dbo.pos_sync_sale_outbox_v1 WHERE operation_id=@id;")).recordset[0];

    function checkout(before, { movementDelta = -1 } = {}) {
      const saleId = randomUUID(), bill = `FIXTURE-${saleId}`, at = "2026-11-07T02:10:00.1234567+00:00";
      const operationId = randomUUID(), itemId = randomUUID(), tenderId = randomUUID(), movementId = randomUUID();
      const operations = [
        { kind: "update", table: "products", match: { id: productId }, requireMatch: true,
          values: { stock_quantity: before - 1, stock_by_store: { [branchId]: before - 1 } } },
        { kind: "upsert", table: "sales", rows: [{ id: saleId, store_id: branchId, branch_id: branchId, shift_id: shiftId,
          bill_number: bill, created_at: at, subtotal_amount: price, total_amount: price, discount_amount: "0",
          tax_amount: "0", payment_type: "cash", paid_amount: price, change_amount: "0", is_refunded: false,
          is_exchange: false, client_transaction_id: saleId, points_earned: "0", points_redeemed: "0", exchange_credit: "0",
          coupon_discount: "0", rounding_adjustment: "0", payments: [{ method: "cash", unreviewed: "omit-raw-payment-json" }] }] },
        { kind: "upsert", table: "sale_items", rows: [{ id: itemId, branch_id: branchId, sale_id: saleId,
          product_id: productId, product_name: "Fixture product", quantity: 1, unit_price: price,
          tax_rate: "0", discount_amount: "0", discount_percent: "0", is_return: false, is_foc: false, created_at: at,
          refunded_qty: 0, unit_cost: "0", coupon_discount: "0" }] },
        { kind: "upsert", table: "payment_transactions", rows: [{ id: tenderId, sale_id: saleId, shift_id: shiftId,
          store_id: branchId, source_type: "sale", kind: "payment", method: "cash", status: "completed", amount: price,
          paid_at: at, created_at: at, updated_at: at, note: "", reference: "omit-freeform-reference", metadata: { token: "omit-tender-metadata" } }] },
        { kind: "upsert", table: "item_activity_logs", rows: [{ id: movementId, store_id: branchId,
          product_id: productId, reference: bill, activity_type: "sale", quantity_delta: movementDelta, created_at: at,
          unit_cost: "0", note: "" }] },
      ];
      return { saleId, itemId, tenderId, movementId, operationId, branchId, terminalId, operations,
        permissions: identity.permissions, ...aggregatePolicy("sale", operations, identity) };
    }

    const old = checkout(10);
    await legacy.commit("sale", old);
    assert.equal(await stock(), 9);
    assert.equal((await manager.pool.request().query("SELECT OBJECT_ID(N'dbo.pos_sync_sale_outbox_v1') AS id;")).recordset[0].id, null);
    await manager.pool.request().batch(readFileSync(resolve(__dirname, "preparation/pos-sale-outbox-v1.sql"), "utf8"));
    assert.equal((await pilot.commit("sale", old)).replayed, true);
    assert.equal(await event(old.operationId), undefined);
    console.log("PASS default route and prior receipts are independent of the prepared capture");

    const sale = checkout(9);
    await pilot.commit("sale", sale);
    const frozen = await event(sale.operationId);
    assert(frozen);
    assert.equal(frozen.payload_hash, createHash("sha256").update(frozen.payload_json).digest("hex"));
    const payload = JSON.parse(frozen.payload_json);
    assert.equal(payload.eventType, "SaleCompleted");
    assert.equal(payload.version, 1);
    assert.equal(payload.operationId, sale.operationId);
    assert.equal(payload.branchId, branchId);
    assert.equal(payload.terminalId, terminalId);
    assert.equal(payload.shiftId, shiftId);
    assert.equal(payload.sale.total_amount, price);
    assert.equal(payload.items[0].unit_price, price);
    assert.equal(payload.tenders[0].amount, price);
    assert.equal(payload.items[0].id.toLowerCase(), sale.itemId);
    assert.equal(payload.tenders[0].id.toLowerCase(), sale.tenderId);
    assert.equal(payload.movements[0].id.toLowerCase(), sale.movementId);
    assert.equal(payload.movements[0].quantity_delta, "-1");
    assert.doesNotMatch(frozen.payload_json, /omit-/);
    await manager.pool.request().input("id", sale.saleId).query("UPDATE dbo.sales SET total_amount=21 WHERE id=@id;");
    assert.equal((await pilot.commit("sale", sale)).replayed, true);
    assert.equal((await event(sale.operationId)).payload_json, frozen.payload_json);
    assert.equal(await stock(), 8);
    await assert.rejects(manager.pool.request().input("id", sale.operationId)
      .query("UPDATE dbo.pos_sync_sale_outbox_v1 SET payload_json=N'{}' WHERE operation_id=@id;"), { number: 51041 });
    console.log("PASS exact cash and stock evidence survives row edits and same-operation retry");

    const badMovement = checkout(8, { movementDelta: -2 });
    await assert.rejects(pilot.commit("sale", badMovement), { code: "ESALE_EVENT_UNVERIFIED" });
    assert.equal(await event(badMovement.operationId), undefined);
    assert.equal(await count("sales", "id=@id", badMovement.saleId), 0);
    const card = checkout(8);
    card.operations.find(operation => operation.table === "payment_transactions").rows[0].method = "card";
    await assert.rejects(pilot.commit("sale", card), { code: "ESALE_EVENT_UNVERIFIED" });
    assert.equal(await event(card.operationId), undefined);
    assert.equal(await count("sales", "id=@id", card.saleId), 0);
    assert.equal(await stock(), 8);
    console.log("PASS inconsistent movement and unsupported tender roll back checkout and stock");

    const databaseGuid = (await manager.pool.request().query(`SELECT LOWER(CONVERT(nvarchar(36),database_guid)) AS guid
      FROM sys.database_recovery_status WHERE database_id=DB_ID();`)).recordset[0].guid;
    const cashBridge = { branchId, terminalId, databaseGuid, installationGeneration: randomUUID(), feedEpoch: randomUUID() };
    let prepareCashAuthor, publicKey, activeAuthor = { ...identity, branchId, authorId: randomUUID(), canonicalSubject: identity.subject };
    if (keyFixture) {
      const authority = new ShiftAuthorAuthority({
        keys: keyFixture.keys, session: { identity: () => activeAuthor, epoch: () => 1,
          hasPermission: key => activeAuthor.permissions[key] === true }, connectionManager: manager,
        terminal: () => ({ tokenId: terminalId, deviceUse: "operations", locationId: branchId }),
        project: () => "https://cash-pilot.fixture.invalid", branch: () => branchId,
      });
      const { binding, keyId } = await authority.prepare(authority.capture("ENROLL"));
      ({ publicKey } = keyFixture.keys.prepare(binding, { expectedKeyId: keyId }));
      keyFixture.keys.markEnrolled(binding, { keyId, publicKey });
      prepareCashAuthor = () => authority.prepare(authority.captureCashCheckout());
      await manager.pool.request().batch(readFileSync(resolve(__dirname, "preparation/pos-sale-acceptance-v1.sql"), "utf8"));
    }
    const bridgeStore = new SaleEventOutbox(manager, registry, { cashBridge, ...(prepareCashAuthor ? { prepareCashAuthor } : {}) });
    const bridgeRepository = new AggregateRepository(manager, repository, { saleOutbox: bridgeStore });
    assert.equal(await bridgeStore.readBridgeCheckout(sale.operationId), null);
    const unsupported = checkout(8);
    unsupported.operations.find(operation => operation.table === "sales").rows[0].rounding_adjustment = "0.01";
    await assert.rejects(bridgeRepository.commit("sale", unsupported), { code: "ESALE_CASH_BRIDGE_UNVERIFIED" });
    assert.equal(await event(unsupported.operationId), undefined);
    assert.equal(await count("sales", "id=@id", unsupported.saleId), 0);
    assert.equal(await stock(), 8);

    if (keyFixture) {
      const impersonated = checkout(8);
      impersonated.operations.find(operation => operation.table === "sales").rows[0].cashier_id = "different.cashier";
      await assert.rejects(bridgeRepository.commit("sale", impersonated), { code: "ESALE_CASH_BRIDGE_UNVERIFIED" });
      assert.equal(await event(impersonated.operationId), undefined);
      assert.equal(await count("sales", "id=@id", impersonated.saleId), 0);
      assert.equal(await stock(), 8);
    }
    const bridgeSale = checkout(8);
    if (keyFixture) bridgeSale.operations.find(operation => operation.table === "sales").rows[0].cashier_id = identity.subject;
    await bridgeRepository.commit("sale", bridgeSale);
    const wire = await bridgeStore.readBridgeCheckout(bridgeSale.operationId);
    assert.equal(wire.operationId, bridgeSale.operationId);
    assert.equal(wire.saleId, bridgeSale.saleId);
    assert.equal(wire.checkoutSha256, createHash("sha256").update(wire.checkoutJson).digest("hex"));
    assert.deepEqual(wire.scope, cashBridge);
    const checkoutPayload = JSON.parse(wire.checkoutJson);
    assert.deepEqual(Object.keys(checkoutPayload), ["sale", "item", "tender", "movement"]);
    assert.deepEqual(checkoutPayload.sale.payments, [{ id: bridgeSale.tenderId, method: "cash", amount: price }]);
    assert.equal(checkoutPayload.sale.branch_id, branchId);
    assert.equal(checkoutPayload.sale.client_transaction_id, bridgeSale.saleId);
    assert.equal(checkoutPayload.item.product_id, productId);
    assert.equal(checkoutPayload.item.unit_price, price);
    assert.equal(checkoutPayload.tender.terminal_id, terminalId);
    assert.equal(checkoutPayload.movement.terminal_id, terminalId);
    assert.deepEqual(checkoutPayload.tender.metadata, {});
    assert.doesNotMatch(wire.checkoutJson, /omit-/);
    if (keyFixture) {
      assert.equal(wire.attestation.authorId, activeAuthor.authorId);
      assert.equal(wire.attestation.subject, activeAuthor.canonicalSubject);
      assert.equal(wire.attestation.payloadHash, wire.checkoutSha256);
      assert.equal(wire.attestation.databaseGuid, databaseGuid);
      assert.equal(wire.attestation.feedEpoch, cashBridge.feedEpoch);
      const check = { operationId: wire.operationId, saleId: wire.saleId, itemId: bridgeSale.itemId, tenderId: bridgeSale.tenderId,
        movementId: bridgeSale.movementId, seq: "9007199254740993", branchId, terminalId,
        epoch: cashBridge.feedEpoch, databaseGuid, installationGeneration: cashBridge.installationGeneration, checkoutSha256: wire.checkoutSha256 };
      const result = { operation_id: check.operationId, sale_id: check.saleId, scope_id: branchId, epoch: check.epoch,
        terminal_id: terminalId, database_guid: databaseGuid, installation_generation: check.installationGeneration,
        checkout_sha256: check.checkoutSha256, author_id: wire.attestation.authorId, author_key_id: wire.attestation.keyId, seq: check.seq };
      const verifyReceipt = async input => {
        const sql = manager.sql(), tx = new sql.Transaction(manager.pool);
        await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        try { return await hasCashAcceptance(tx, input); }
        finally { await tx.rollback(); }
      };
      assert.equal(await verifyReceipt(check), false);
      await assert.rejects(bridgeStore.recordBridgeAcceptance(wire, { status: "APPLIED", result: { ...result, author_id: randomUUID() } }),
        { code: "ESALE_CASH_BRIDGE_UNVERIFIED" });
      const pending = async operationId => Number((await manager.pool.request().input("operation", operationId)
        .query("SELECT COUNT(*) AS n FROM dbo.sync_change_journal WHERE aggregate_id=@operation AND acknowledged_at IS NULL;")).recordset[0].n);
      assert.equal(await pending(wire.operationId), 5);
      await manager.pool.request().input("operation", wire.operationId).query(`
        INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id)
        VALUES(N'activity_events',N'{"id":"fixture-extra-effect"}',N'insert',N'foreign-branch',1,@operation);
      `);
      await assert.rejects(bridgeStore.recordBridgeAcceptance(wire, { status: "APPLIED", result }),
        { code: "ESALE_CASH_BRIDGE_UNVERIFIED" });
      assert.equal(await verifyReceipt(check), false);
      assert.equal(await pending(wire.operationId), 6);
      await manager.pool.request().input("operation", wire.operationId).query(`
        DELETE dbo.sync_change_journal WHERE aggregate_id=@operation AND entity_type=N'activity_events'
          AND branch_id=N'foreign-branch' AND entity_id=N'{"id":"fixture-extra-effect"}';
      `);
      await manager.pool.request().batch(`CREATE TRIGGER dbo.fixture_fail_cash_ack ON dbo.sync_change_journal AFTER UPDATE AS
        BEGIN IF EXISTS(SELECT 1 FROM inserted WHERE acknowledged_at IS NOT NULL)
          THROW 51978, 'Fixture refused the journal acknowledgement after the receipt insert.', 1;
        END;`);
      await assert.rejects(bridgeStore.recordBridgeAcceptance(wire, { status: "APPLIED", result }), { number: 51978 });
      assert.equal(await verifyReceipt(check), false);
      assert.equal(await pending(wire.operationId), 5);
      await manager.pool.request().batch("DROP TRIGGER dbo.fixture_fail_cash_ack;");
      let sourceChecks = 0;
      await assert.rejects(bridgeStore.recordBridgeAcceptance(wire, { status: "APPLIED", result }, () => {
        if (++sourceChecks === 2) throw Object.assign(new Error("The sender source changed before commit."), { code: "EFIXTURE_SOURCE_CHANGED" });
      }), { code: "EFIXTURE_SOURCE_CHANGED" });
      assert.equal(await verifyReceipt(check), false);
      assert.equal(await pending(wire.operationId), 5);
      const unrelatedPending = await pending(sale.operationId);
      await bridgeStore.recordBridgeAcceptance(wire, { status: "APPLIED", result });
      await bridgeStore.recordBridgeAcceptance(wire, { status: "ALREADY_APPLIED", result });
      assert.equal(await verifyReceipt(check), true);
      assert.equal(await pending(wire.operationId), 0);
      assert.equal(await pending(sale.operationId), unrelatedPending);
      for (const field of ["saleId", "itemId", "tenderId", "movementId", "installationGeneration", "databaseGuid"])
        assert.equal(await verifyReceipt({ ...check, [field]: randomUUID() }), false);
      assert.equal(await verifyReceipt({ ...check, seq: "9007199254740994" }), false);
      await assert.rejects(manager.pool.request().input("id", bridgeSale.operationId)
        .query("DELETE dbo.pos_sync_sale_acceptance_v1 WHERE operation_id=@id;"), { number: 51041 });
      console.log("PASS native cash proof, exact journal membership, atomic rollback and immutable own-operation acceptance");
      const original = activeAuthor;
      activeAuthor = { ...original, authorId: randomUUID(), canonicalSubject: "different.cashier" };
      assert.equal((await bridgeStore.readBridgeCheckout(bridgeSale.operationId)).attestation.authorId, original.authorId);
      assert.equal((await bridgeRepository.commit("sale", bridgeSale)).replayed, true);
      activeAuthor = original;
    }
    await manager.pool.request().input("id", bridgeSale.saleId).query("UPDATE dbo.sales SET total_amount=99 WHERE id=@id;");
    await local.restart();
    assert.deepEqual(await bridgeStore.readBridgeCheckout(bridgeSale.operationId), wire);
    assert.equal((await bridgeRepository.commit("sale", bridgeSale)).replayed, true);
    assert.equal(await stock(), 7);
    for (const key of ["installationGeneration", "databaseGuid", "feedEpoch"]) {
      const changed = new SaleEventOutbox(manager, registry, { cashBridge: { ...cashBridge, [key]: randomUUID() } });
      await assert.rejects(changed.readBridgeCheckout(bridgeSale.operationId), { code: "ESALE_CASH_BRIDGE_UNVERIFIED" });
    }
    const anotherTill = new SaleEventOutbox(manager, registry, { cashBridge: { ...cashBridge, terminalId: randomUUID() } });
    assert.equal(await anotherTill.readBridgeCheckout(bridgeSale.operationId), null);
    console.log("PASS cash bridge freezes its authorized wire bytes and refuses another source, epoch, or installation");

    await manager.pool.request().batch(`CREATE TRIGGER dbo.fixture_break_after_sale_capture
      ON dbo.local_operation_receipts AFTER INSERT AS BEGIN
        SET NOCOUNT ON;
        IF EXISTS (SELECT 1 FROM inserted r JOIN dbo.pos_sync_sale_outbox_v1 e ON e.operation_id=r.operation_id)
          THROW 51977, 'Fixture rejected receipt after seeing sale event.', 1;
      END;`);
    const interrupted = checkout(7);
    await assert.rejects(bridgeRepository.commit("sale", interrupted), { code: "ESQLSERVER_WRITE", sqlNumber: 51977 });
    assert.equal(await event(interrupted.operationId), undefined);
    assert.equal(await count("sales", "id=@id", interrupted.saleId), 0);
    assert.equal(await count("sync_change_journal", "aggregate_id=@id", interrupted.operationId), 0);
    assert.equal(await count("local_operation_receipts", "operation_id=@id", interrupted.operationId), 0);
    assert.equal(await stock(), 7);
    console.log("PASS failure after event insert rolls back the event, sale, stock and original journal");
    if (mode !== "--run") console.log(`POS_CASH_WIRE ${JSON.stringify({ ...wire, ...(publicKey ? { publicKey } : {}) })}`);
  } finally {
    try { await local.close(); } finally { keyFixture?.close(); }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
