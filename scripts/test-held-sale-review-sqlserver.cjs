"use strict";

// Uses a uniquely owned disposable LocalDB fixture and accepts no POS profile.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createOwnedUpgradeFixture } = require("./lib/owned-upgrade-fixture.cjs");
const { loadRegistry } = require("../electron/db/schema-registry.cjs");
const { HeldSaleReview } = require("../electron/sync/held-sale-review.cjs");
const { readFileSync } = require("node:fs");
const actorId = randomUUID(),
  productId = randomUUID();

const registry = loadRegistry();
const branchId = randomUUID(),
  terminalId = randomUUID(),
  shiftId = randomUUID();
const names = ["sales", "sale_items", "payment_transactions", "held_orders"];
const table = (name) => registry.tables.find((table) => table.cloudTable === name);
const full = (name, values) =>
  Object.assign(
    Object.fromEntries(table(name).columns.map((column) => [column.cloudColumn, null])),
    values,
  );
const time = "2026-10-31T13:08:56.123456+00:00";
const precise = "12.350000000001";

function fixture(billNo, exchange = false) {
  const ticket = { id: `D:${branchId}:${billNo}`, billNo, shiftId };
  const id = randomUUID(),
    item = randomUUID(),
    payment = randomUUID();
  const amount = exchange ? 0 : "__AMOUNT__";
  const sale = full("sales", {
    id,
    store_id: branchId,
    bill_number: billNo,
    branch_id: branchId,
    shift_id: shiftId,
    subtotal_amount: amount,
    total_amount: amount,
    paid_amount: amount,
    discount_amount: 0,
    tax_amount: 0,
    payment_type: "cash",
    points_earned: 0,
    points_redeemed: 0,
    is_exchange: exchange,
    is_refunded: false,
    created_at: time,
    change_amount: 0,
    exchange_credit: 0,
    coupon_discount: 0,
    row_version: 7,
    payments: exchange ? [] : [{ method: "cash", amount }],
    rounding_adjustment: 0,
    client_transaction_id: `sale:${id}`,
  });
  const items = [
    full("sale_items", {
      id: item,
      sale_id: id,
      branch_id: branchId,
      product_id: productId,
      product_name: "Owned fixture / item",
      unit_price: amount,
      quantity: 1,
      discount_percent: 0,
      discount_amount: 0,
      is_return: false,
      created_at: time,
      tax_rate: 0,
      is_foc: false,
      coupon_discount: 0,
      unit_cost: 0,
      row_version: 7,
      refunded_qty: 0,
    }),
  ];
  items.push({ ...items[0], id: randomUUID(), unit_price: 0, is_foc: true });
  const payments = exchange
    ? []
    : [
        full("payment_transactions", {
          id: payment,
          source_type: "sale",
          sale_id: id,
          store_id: branchId,
          shift_id: shiftId,
          terminal_id: terminalId,
          amount,
          method: "cash",
          kind: "payment",
          note: "",
          paid_at: time,
          created_at: time,
          updated_at: time,
          row_version: 7,
          status: "completed",
          metadata: { exact: "__UNSAFE__" },
          client_transaction_id: `payment:${payment}`,
        }),
      ];
  const response = (graph = { sale, items, payments }) => ({
    ok: true,
    version: 1,
    organizationId: "default",
    branchId,
    terminalId,
    ticketId: ticket.id,
    billNo,
    shiftId,
    actorId,
    proof: graph === null ? null : "cleaned_hold",
    graphJson:
      graph === null
        ? null
        : JSON.stringify(graph)
            .replaceAll('"__AMOUNT__"', precise)
            .replaceAll('"__UNSAFE__"', "9007199254740993"),
  });

  return { ticket, id, item, payment, response };
}

async function main() {
  assert.deepEqual(process.argv.slice(2), ["--run"]);
  const f = await createOwnedUpgradeFixture();
  const { sql, pool } = f;
  const metadata = readFileSync(
    require("node:path").join(
      __dirname,
      "../database/sqlserver/recovery/held-sale-review-metadata.sql",
    ),
    "utf8",
  );
  const install = (parent, guid = f.guid) =>
    new sql.Request(parent)
      .input("expectedDatabaseGuid", sql.UniqueIdentifier, guid)
      .input("expectedDatabaseName", sql.NVarChar(128), f.database)
      .query(metadata);
  try {
    await f.installCore();
    await pool
      .request()
      .input("branch", branchId)
      .input("shift", shiftId)
      .input("terminal", terminalId)
      .input("product", productId).query(`
      INSERT dbo.stores(id,code,name) VALUES(@branch,N'OWNED',N'Owned fixture');
      INSERT dbo.shifts(id,store_id,terminal_id,state) VALUES(@shift,@branch,@terminal,N'ACTIVE');
      INSERT dbo.products(id,barcode,name,stock_by_store) VALUES(@product,N'FIXTURE-001',N'Owned product',N'{"'+@branch+N'":100}');`);

    let currentActor = actorId,
      currentFingerprint = "a".repeat(64),
      clock = 100,
      api = new Map(),
      calls = 0;
    const projectOrigin = "https://fixture.invalid";
    const source = () => ({
      pool,
      fingerprint: currentFingerprint,
      terminal: {
        tokenId: terminalId,
        locationId: branchId,
        deviceUse: "operations",
        deviceType: "pc",
      },
      profile: { database: f.database },
      project: { branchId, projectOrigin },
      personProof: { accessToken: "fixture" },
    });
    const review = new HeldSaleReview({
      connectionManager: f.manager,
      registry,
      now: () => clock,
      authority: {
        capture: () => {
          const id = currentActor;
          return {
            branchId,
            binding: { terminalId, projectOrigin, authorId: id },
            subject: "fixture-admin",
            assertCurrent: () => assert.equal(currentActor, id, "Administrator changed"),
          };
        },
      },
      cloud: {
        requestContext: (governance) => {
          assert(governance);
          return source();
        },
        heldSaleReview: async ({ branchId: branch, ticketId, billNo, shiftId: shift }) => {
          calls++;
          assert.equal(branch, branchId);
          assert.equal(shift, shiftId);
          const row = api.get(ticketId);
          assert.equal(row?.ticket.billNo, billNo);
          return row.remote;
        },
      },
    });

    const seed = async (bill, remote) => {
      const row = fixture(bill);
      const lines = JSON.stringify([
        {
          name: "Owned fixture / cart item",
          variantCode: "XL",
          qty: 2,
          price: 6.175,
          secretFixtureValue: "must-not-leave-Main",
        },
      ]);
      await pool
        .request()
        .input("id", row.ticket.id)
        .input("branch", branchId)
        .input("shift", shiftId)
        .input("bill", bill)
        .input("lines", lines)
        .query(`INSERT dbo.held_orders(id,store_id,shift_id,bill_no,label,status,lines,row_version,total)
          VALUES(@id,@branch,@shift,@bill,N'Fixture / cart',N'held',@lines,7,12.35);`);
      row.remote = remote ? remote(row) : row.response();
      api.set(row.ticket.id, row);
      return row;
    };
    const reset = async () =>
      pool.request().input("branch", branchId).input("names", JSON.stringify(names)).query(`
      DELETE dbo.sync_checkpoints WHERE branch_id=@branch;
      INSERT dbo.sync_checkpoints(organization_id,branch_id,entity_type,direction,change_tracking_version)
      SELECT N'default',@branch,value,N'push',CHANGE_TRACKING_CURRENT_VERSION() FROM OPENJSON(@names);`);
    const error = (name) => ({ code: "EHELD_SALE_RECOVERY_" + name });
    const snapshot = async () =>
      (
        await pool.request().input("shift", shiftId).query(`SELECT
      (SELECT * FROM dbo.shifts WHERE id=@shift FOR JSON PATH,INCLUDE_NULL_VALUES) shifts,
      (SELECT * FROM dbo.products ORDER BY id FOR JSON PATH,INCLUDE_NULL_VALUES) products,
      (SELECT * FROM dbo.stock_adjustments ORDER BY id FOR JSON PATH,INCLUDE_NULL_VALUES) stock,
      (SELECT * FROM dbo.stock_delta_applied ORDER BY movement_id FOR JSON PATH,INCLUDE_NULL_VALUES) stock_deltas,
      (SELECT * FROM dbo.sync_change_journal ORDER BY change_id FOR JSON PATH,INCLUDE_NULL_VALUES) journal,
      (SELECT * FROM dbo.sync_checkpoints ORDER BY organization_id,branch_id,entity_type,direction FOR JSON PATH,INCLUDE_NULL_VALUES) checkpoints;`)
      ).recordset[0];
    const primary = await seed("OWNED/REVIEW-01");
    assert.deepEqual(
      (await review.list()).items.map((row) => row.ticketId),
      [primary.ticket.id],
    );
    const readOnly = await review.preview(primary.ticket.id);
    assert.equal(readOnly.reason, "SCHEMA_REQUIRED");
    assert.equal(readOnly.reviewToken, null);
    assert.deepEqual(readOnly.local.items, [
      { name: "Owned fixture / cart item", variant: "XL", quantity: "2", price: "6.175" },
    ]);
    assert.equal(readOnly.local.total, "12.35");
    assert.equal(readOnly.cloud.total, precise);
    assert.equal(readOnly.cloud.paymentCount, 1);
    assert(!JSON.stringify(readOnly).includes("must-not-leave-Main"));
    console.log("PASS exact read-only summary and missing metadata guard");

    await assert.rejects(install(pool, randomUUID()), /exact managed Retail database/);
    const ambient = new sql.Transaction(pool);
    await ambient.begin();
    try {
      await new sql.Request(ambient).query("SET XACT_ABORT ON;");
      await assert.rejects(install(ambient), /dedicated connection/);
      assert.deepEqual(
        (await new sql.Request(ambient).query("SELECT @@TRANCOUNT active,XACT_STATE() state;"))
          .recordset[0],
        { active: 1, state: 1 },
      );
    } finally {
      await new sql.Request(ambient).query("SET XACT_ABORT OFF;");
      await ambient.rollback();
    }
    await install(pool);
    await assert.rejects(install(pool), /metadata needs verification/);
    console.log("PASS wrong-target, ambient transaction and repeated DDL refusal");

    await reset();
    await pool
      .request()
      .input("product", productId)
      .query(
        "UPDATE dbo.products SET name=N'Owned product after CT maintenance' WHERE id=@product; ALTER TABLE dbo.held_orders DISABLE CHANGE_TRACKING; ALTER TABLE dbo.held_orders ENABLE CHANGE_TRACKING;",
      );
    const bounds = (
      await pool
        .request()
        .input("branch", branchId)
        .query(
          "SELECT CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.held_orders')) minimum, change_tracking_version saved_version FROM dbo.sync_checkpoints WHERE branch_id=@branch AND entity_type=N'held_orders';",
        )
    ).recordset[0];
    assert(BigInt(bounds.minimum) > BigInt(bounds.saved_version));
    const start = await snapshot();
    const preview = await review.preview(primary.ticket.id);
    assert.equal(preview.canAdopt, true);
    const choice = {
      reviewToken: preview.reviewToken,
      reason: "Compared held cart with the completed bill.",
    };
    const atomic = review.atomic.bind(review);
    review.atomic = async (...args) => {
      await atomic(...args);
      throw new Error("Fixture simulates losing the first committed response");
    };
    await assert.rejects(review.resolve(choice), /losing the first committed response/);
    review.atomic = atomic;
    const result = await review.resolve(choice);
    assert.equal(result.state, "ADOPTED");
    assert.equal(result.saleId, primary.id);
    const after = await snapshot();
    assert.deepEqual(after, start);
    assert.deepEqual(
      await review.resolve({
        reviewToken: preview.reviewToken,
        reason: "Compared held cart with the completed bill.",
      }),
      result,
    );
    await assert.rejects(
      review.resolve({ reviewToken: preview.reviewToken, reason: "Different review" }),
      error("REVIEW"),
    );
    assert.equal((await review.list()).items.length, 0);
    const read = (
      await pool
        .request()
        .input("decision", result.decisionId)
        .input("ticket", primary.ticket.id)
        .input("sale", primary.id).query(`SELECT
        (SELECT status FROM dbo.held_orders WHERE id=@ticket) status,
        (SELECT COUNT(*) FROM dbo.sales WHERE id=@sale) sales,
        (SELECT COUNT(*) FROM dbo.sale_items WHERE sale_id=@sale) items,
        (SELECT COUNT(*) FROM dbo.payment_transactions WHERE sale_id=@sale) payments,
        (SELECT CONVERT(nvarchar(100),amount) FROM dbo.payment_transactions WHERE sale_id=@sale) paid,
        (SELECT local_before_json FROM dbo.pos_held_sale_review_decisions WHERE decision_id=@decision) before_json,
        (SELECT cloud_graph_json FROM dbo.pos_held_sale_review_decisions WHERE decision_id=@decision) graph_json,
        (SELECT TOP(1) SYS_CHANGE_CONTEXT FROM CHANGETABLE(CHANGES dbo.held_orders,0) changed WHERE id=@ticket) context;`)
    ).recordset[0];
    assert.deepEqual(
      [read.status, read.sales, read.items, read.payments, read.paid],
      ["completed", 1, 2, 1, precise],
    );
    assert.equal(read.context.toString("hex"), Buffer.from("CLOUD").toString("hex"));
    assert(read.before_json.includes("must-not-leave-Main"));
    assert.equal(JSON.parse(read.before_json).status, "held");
    assert.equal(read.graph_json, primary.remote.graphJson);
    await assert.rejects(
      pool
        .request()
        .input("id", result.decisionId)
        .query("DELETE FROM dbo.pos_held_sale_review_decisions WHERE decision_id=@id;"),
      /append-only/,
    );
    console.log(
      "PASS exact owned SQL Server graph adoption, immutable archive, cloud marker and replay; shifts, stock, journal and checkpoints unchanged",
    );

    const unavailable = await seed("OWNED/UNAVAILABLE", (row) => row.response(null));
    assert.equal((await review.preview(unavailable.ticket.id)).reason, "NO_COMPLETION_PROOF");
    unavailable.remote = { ...unavailable.response(), actorId: randomUUID() };
    await assert.rejects(review.preview(unavailable.ticket.id), error("PROTOCOL"));
    unavailable.remote = unavailable.response();
    await reset();
    const changed = await review.preview(unavailable.ticket.id);
    unavailable.remote = { ...unavailable.remote, proof: "completed_hold" };
    await assert.rejects(
      review.resolve({ reviewToken: changed.reviewToken, reason: "Cloud proof changed" }),
      error("CHANGED"),
    );
    const other = await review.preview(unavailable.ticket.id);
    currentFingerprint = "b".repeat(64);
    await assert.rejects(
      review.resolve({ reviewToken: other.reviewToken, reason: "Backend or session changed" }),
      error("CONTEXT"),
    );
    currentFingerprint = "a".repeat(64);
    const otherActor = await review.preview(unavailable.ticket.id);
    currentActor = randomUUID();
    await assert.rejects(
      review.resolve({ reviewToken: otherActor.reviewToken, reason: "Administrator changed" }),
      /Administrator changed/,
    );
    currentActor = actorId;
    const expired = await review.preview(unavailable.ticket.id);
    clock += 300_000;
    await assert.rejects(
      review.resolve({ reviewToken: expired.reviewToken, reason: "Confirmation expired" }),
      error("REVIEW"),
    );
    const pending = await review.preview(unavailable.ticket.id);
    await pool
      .request()
      .input("branch", branchId)
      .input("id", unavailable.ticket.id)
      .query(
        "INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version) VALUES(N'held_orders',@id,N'update',@branch,7);",
      );
    await assert.rejects(
      review.resolve({ reviewToken: pending.reviewToken, reason: "Existing pending upload" }),
      error("PENDING"),
    );
    await pool.request().query("DELETE dbo.sync_change_journal;");
    const localEdit = await review.preview(unavailable.ticket.id);
    await pool
      .request()
      .input("ticket", unavailable.ticket.id)
      .query("UPDATE dbo.held_orders SET label=N'New local cart label' WHERE id=@ticket;");
    await assert.rejects(
      review.resolve({ reviewToken: localEdit.reviewToken, reason: "Existing local edit" }),
      error("CHANGED"),
    );
    const big = await seed("OWNED/BIG");
    await pool
      .request()
      .input("id", big.ticket.id)
      .input(
        "lines",
        sql.NVarChar(sql.MAX),
        JSON.stringify(Array.from({ length: 257 }, () => ({ name: "A", qty: 1 }))),
      )
      .query("UPDATE dbo.held_orders SET lines=@lines WHERE id=@id;");
    const bigPreview = await review.preview(big.ticket.id);
    assert.equal(bigPreview.reason, "CART_TOO_LARGE");
    assert.equal(bigPreview.reviewToken, null);
    assert.equal(bigPreview.local.itemCount, 257);
    const foreign = await seed("OWNED/FOREIGN-TERMINAL");
    const otherShift = randomUUID();
    await pool
      .request()
      .input("id", otherShift)
      .input("branch", branchId)
      .input("terminal", randomUUID())
      .input("ticket", foreign.ticket.id)
      .query(
        "INSERT dbo.shifts(id,store_id,terminal_id,state) VALUES(@id,@branch,@terminal,N'ACTIVE'); UPDATE dbo.held_orders SET shift_id=CONVERT(nvarchar(36),@id) WHERE id=@ticket;",
      );
    const previously = calls;
    assert(!(await review.list()).items.some((item) => item.ticketId === foreign.ticket.id));
    await assert.rejects(review.preview(foreign.ticket.id), error("IDENTITY"));
    assert.equal(calls, previously);
    assert(calls > 5);
    console.log(
      "PASS missing or foreign proof, stale cloud/device/decision, pending journal and changed local cart fail closed",
    );

    const failure = await seed("OWNED/ROLLBACK");
    await reset();
    const beforeFailure = await snapshot();
    const failurePreview = await review.preview(failure.ticket.id);
    assert.equal(failurePreview.canAdopt, true);
    const query = review.query.bind(review);
    let reachedReadback = false;
    review.query = async (tx, statement, inputs) => {
      if (statement.includes("FROM dbo.held_orders h WITH(HOLDLOCK) WHERE h.id=@id;")) {
        reachedReadback = true;
        throw new Error("Fixture failure after the financial graph was written");
      }
      return query(tx, statement, inputs);
    };
    try {
      await assert.rejects(review.resolve({ reviewToken: failurePreview.reviewToken, reason: "Test atomic rollback" }),
        /failure after the financial graph was written/);
    } finally {
      review.query = query;
    }
    assert.equal(reachedReadback, true);
    const restored = (await pool.request().input("sale", failure.id).input("ticket", failure.ticket.id)
      .input("decision", failurePreview.reviewToken).query(`SELECT
        (SELECT status FROM dbo.held_orders WHERE id=@ticket) status,
        (SELECT COUNT(*) FROM dbo.sales WHERE id=@sale) sales,
        (SELECT COUNT(*) FROM dbo.sale_items WHERE sale_id=@sale) items,
        (SELECT COUNT(*) FROM dbo.payment_transactions WHERE sale_id=@sale) payments,
        (SELECT COUNT(*) FROM dbo.pos_held_sale_review_decisions WHERE decision_id=@decision) decisions;`)).recordset[0];
    assert.deepEqual(restored, { status: "held", sales: 0, items: 0, payments: 0, decisions: 0 });
    assert.deepEqual(await snapshot(), beforeFailure);
    console.log("PASS late write failure rolls back the sale, items, payments and hold together");
  } finally {
    await f.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
