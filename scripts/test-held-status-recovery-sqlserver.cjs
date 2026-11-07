"use strict";
// Owned full-core SQL Server acceptance only; no POS profile/URL is accepted.
const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const { createOwnedUpgradeFixture } = require("./lib/owned-upgrade-fixture.cjs");
const { loadRegistry } = require("../electron/db/schema-registry.cjs");
const {
  HeldStatusRecovery,
  projectIdentity,
  adoptionReceipt,
} = require("../electron/sync/held-status-recovery.cjs");
const {
  parseExactJson,
  stringifyExactJson,
  projection,
} = require("../electron/sync/shift-recovery-exact.cjs");
const branch = "HOLD-OWNED-A",
  other = "HOLD-OWNED-B",
  terminal = randomUUID(),
  sourceKey = "owned-held-status-source";
const names = [
  "held_orders",
  "sales",
  "sale_items",
  "payment_transactions",
  "bookings",
  "booking_payments",
];
async function main() {
  assert.deepEqual(process.argv.slice(2), ["--run"]);
  const f = await createOwnedUpgradeFixture();
  let count = 0;
  const test = async (name, work) => {
    if (process.env.HELD_STATUS_ONLY && !name.includes(process.env.HELD_STATUS_ONLY)) return;
    await work();
    count++;
    console.log("PASS " + name);
  };
  try {
    await f.installCore();
    const registry = loadRegistry(),
      held = registry.tables.find((table) => table.cloudTable === "held_orders"),
      profile = { host: "OWNED-HELD-FIXTURE", database: f.database, authMode: "windows" };
    const manager = { ...f.manager, profile };
    let records = [],
      onCloud = async () => {},
      current = true,
      receiptFault = false,
      attemptDDL = false,
      attemptPending = null;
    const events = [],
      cloud = {
        heldStatuses: async (args) => {
          assert.equal(args.branchId, branch);
          assert(args.tickets.length <= 4);
          await onCloud(args);
          return {
            ok: true,
            heldStatusVersion: 1,
            organizationId: "default",
            branchId: branch,
            terminalId: terminal,
            records: records.filter((row) => args.tickets.some((ticket) => ticket.id === row.id)),
          };
        },
      };
    const originalHeld = (
      await f.pool
        .request()
        .query("SELECT OBJECT_DEFINITION(OBJECT_ID(N'dbo.held_orders_lifecycle')) definition;")
    ).recordset[0].definition;
    class Request extends f.sql.Request {
      async query(statement, ...args) {
        if (receiptFault && statement.includes("INSERT dbo.local_operation_receipts"))
          throw Object.assign(Error("Owned fixture receipt failure"), {
            code: "FIXTURE_RECEIPT_FAIL",
          });
        if (
          (attemptDDL || attemptPending) &&
          statement.includes("WITH CHANGE_TRACKING_CONTEXT(0x434C4F5544) UPDATE dbo.held_orders")
        ) {
          const ddl =
            attemptDDL === "receipt"
              ? "CREATE TRIGGER dbo.owned_late_receipt ON dbo.local_operation_receipts AFTER INSERT AS BEGIN SET NOCOUNT ON;END;"
              : "ALTER TRIGGER dbo.held_orders_lifecycle ON dbo.held_orders AFTER INSERT,UPDATE AS BEGIN SET NOCOUNT ON;END;";
          attemptDDL = false;
          const pending = attemptPending;
          attemptPending = null;
          const rival = await f.connect(f.database),
            tx = new f.sql.Transaction(rival);
          await tx.begin();
          try {
            await new f.sql.Request(tx).query("SET LOCK_TIMEOUT 200;");
            const request = new f.sql.Request(tx);
            if (pending) {
              const result = await request
                .input("entity", JSON.stringify({ id: pending }))
                .input("branch", branch)
                .query(`BEGIN TRY
                  INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id)
                  VALUES(N'held_orders',@entity,N'update',@branch,7,NEWID());
                  SELECT 0 error_number;
                END TRY BEGIN CATCH SELECT ERROR_NUMBER() error_number; END CATCH;`);
              assert.equal(result.recordset[0].error_number, 1222);
            } else {
              await assert.rejects(request.batch(ddl), (error) => error.number === 1222);
            }
          } finally {
            await tx.rollback().catch(() => {});
            await rival.close();
          }
        }
        return super.query(statement, ...args);
      }
    }
    manager.sql = () => ({ ...f.sql, Request });
    const helper = new HeldStatusRecovery({
      manager,
      registry,
      cloud,
      publish: (event) => events.push(event),
    });
    const scope = () => ({
      branchId: branch,
      terminalId: terminal,
      profile,
      sourceKey,
      expectedDatabaseGuid: f.guid.toLowerCase(),
      expectedDatabaseName: f.database,
      assertCurrent: () => {
        if (!current)
          throw Object.assign(Error("Changed owned source"), { code: "EHELD_STATUS_CONTEXT" });
      },
    });
    const json = async (id) =>
      (
        await f.pool
          .request()
          .input("id", id)
          .query(
            `SELECT (SELECT ${projection(held, "h")} FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER) exact_json FROM dbo.held_orders h WHERE id=@id;`,
          )
      ).recordset[0]?.exact_json;
    const native = async (id) => {
      const value = await json(id);
      return value ? JSON.parse(value) : null;
    };
    const receiptCount = async () =>
      Number(
        (
          await f.pool
            .request()
            .query(
              "SELECT COUNT(*) n FROM dbo.local_operation_receipts WHERE operation_type=N'held_status_cloud_adoption_v1';",
            )
        ).recordset[0].n,
      );
    const checkpoints = async () => {
      for (const name of names)
        await f.pool
          .request()
          .input("branch", branch)
          .input("entity", name)
          .query(
            "MERGE dbo.sync_checkpoints target USING(SELECT N'default' organization_id,@branch branch_id,@entity entity_type,N'push' direction) source ON target.organization_id=source.organization_id AND target.branch_id=source.branch_id AND target.entity_type=source.entity_type AND target.direction=source.direction WHEN MATCHED THEN UPDATE SET change_tracking_version=CHANGE_TRACKING_CURRENT_VERSION() WHEN NOT MATCHED THEN INSERT(organization_id,branch_id,entity_type,direction,change_tracking_version) VALUES(source.organization_id,source.branch_id,source.entity_type,source.direction,CHANGE_TRACKING_CURRENT_VERSION());",
          );
    };
    const reset = async () => {
      records = [];
      onCloud = async () => {};
      current = true;
      receiptFault = false;
      attemptDDL = false;
      attemptPending = null;
      events.length = 0;
      await f.pool
        .request()
        .batch(
          "DELETE dbo.held_orders;DELETE dbo.payment_transactions;DELETE dbo.sale_items;DELETE dbo.sales;DELETE dbo.booking_payments;DELETE dbo.bookings;DELETE dbo.sync_change_journal;DELETE dbo.local_operation_receipts;DELETE dbo.sync_checkpoints;",
        );
    };
    await f.pool
      .request()
      .input("branch", branch)
      .input("other", other)
      .batch(
        "INSERT dbo.stores(id,code,name)VALUES(@branch,N'HSA',N'Owned held A'),(@other,N'HSB',N'Owned held B');",
      );
    const seed = async ({
      localParent = false,
      bill = "HS-0001",
      status = "held",
      amount = "12.350000000000",
      id = "held-" + randomUUID(),
      storeId = branch,
    } = {}) => {
      const parent = randomUUID();
      await f.pool
        .request()
        .input("id", id)
        .input("branch", storeId)
        .input("bill", bill)
        .input("status", status)
        .input("amount", amount)
        .input(
          "lines",
          '[{"productId":"fixture-product","qty":1,"price":12.35,"cost":99,"name":"private fixture"}]',
        )
        .query(
          "INSERT dbo.held_orders(id,store_id,bill_no,label,status,total,lines,row_version)VALUES(@id,@branch,@bill,N'Owned ticket',@status,CONVERT(decimal(38,12),@amount),@lines,7);",
        );
      if (localParent) {
        // Historical fixture: accepted parent exists but an older installation did
        // not apply its completion trigger. Restore the real trigger before proof.
        await f.pool
          .request()
          .batch("DISABLE TRIGGER dbo.sales_complete_held_ticket ON dbo.sales;");
        try {
          await f.pool
            .request()
            .input("id", parent)
            .input("branch", storeId)
            .input("bill", bill)
            .query(
              "INSERT dbo.sales(id,store_id,bill_number,total_amount,paid_amount)VALUES(@id,@branch,@bill,12.35,12.35);",
            );
        } finally {
          await f.pool
            .request()
            .batch("ENABLE TRIGGER dbo.sales_complete_held_ticket ON dbo.sales;");
        }
      }
      await checkpoints();
      return { id, parent, bill, before: await json(id) };
    };
    const parentRecord = (value) => ({
      id: value.id,
      status: "completed",
      proofFrom: "accepted_parent",
      rowVersion: null,
      updatedAt: null,
      identityJson: null,
      parent: {
        kind: "sale",
        id: value.parent,
        storeId: branch,
        billNo: value.bill,
        shiftId: null,
      },
    });
    const heldRecord = async (value, status = "cancelled") => {
      const row = await native(value.id),
        identity = projectIdentity(row, { local: true });
      for (const key of ["total", "cart_discount"]) identity[key] = parseExactJson(identity[key]);
      identity.lines = parseExactJson(identity.lines);
      if (typeof identity.coupon === "string") identity.coupon = parseExactJson(identity.coupon);
      return {
        id: value.id,
        status,
        proofFrom: "held",
        rowVersion: "9",
        updatedAt: "2026-11-07T01:02:03.123456Z",
        identityJson: stringifyExactJson(identity),
        parent:
          status === "completed"
            ? { kind: "sale", id: value.parent, storeId: branch, billNo: value.bill, shiftId: null }
            : null,
      };
    };
    await test("accepted parent adopts status only, retains all exact fields and records compact same-transaction provenance", async () => {
      await reset();
      const value = await seed({ localParent: true });
      records = [parentRecord(value)];
      const before = JSON.parse(value.before),
        result = await helper.reconcile(scope());
      assert.equal(result.updated, 1);
      assert.deepEqual(await native(value.id), { ...before, status: "completed" });
      assert.equal(await receiptCount(), 1);
      const receipt = (
        await f.pool
          .request()
          .query(
            "SELECT operation_type,entity_id,note FROM dbo.local_operation_receipts WHERE operation_type=N'held_status_cloud_adoption_v1';",
          )
      ).recordset[0];
      assert(receipt.note.length <= 400);
      assert.equal(receipt.entity_id, createHash("sha256").update(value.id).digest("hex"));
      assert.equal(JSON.parse(receipt.note).s, "held");
      assert(!receipt.note.includes("private fixture"));
      assert.equal(events.length, 1);
      assert.deepEqual(events[0].tables, ["held_orders"]);
      assert.equal(
        (await f.pool.request().query("SELECT COUNT(*) n FROM dbo.sync_change_journal"))
          .recordset[0].n,
        0,
      );
    });
    await test("cold connection retry is a no-op and does not fabricate a second receipt", async () => {
      const replacement = await f.connect(f.database);
      try {
        manager.pool = replacement;
        assert.equal((await helper.reconcile(scope())).updated, 0);
        assert.equal(
          (
            await replacement
              .request()
              .query(
                "SELECT COUNT(*) n FROM dbo.local_operation_receipts WHERE operation_type=N'held_status_cloud_adoption_v1';",
              )
          ).recordset[0].n,
          1,
        );
      } finally {
        manager.pool = f.pool;
        await replacement.close();
      }
    });
    await test("missing accepted local parent remains held with no receipt or header copy", async () => {
      await reset();
      const value = await seed();
      records = [parentRecord(value)];
      const result = await helper.reconcile(scope());
      assert.equal(result.updated, 0);
      assert(result.reviewRequired);
      assert.equal(await json(value.id), value.before);
      assert.equal(await receiptCount(), 0);
      assert.equal(
        (await f.pool.request().query("SELECT COUNT(*) n FROM dbo.sales")).recordset[0].n,
        0,
      );
    });
    await test("cancelled cloud state adopts only status and never invents a sale", async () => {
      await reset();
      const value = await seed();
      records = [await heldRecord(value)];
      const before = JSON.parse(value.before);
      assert.equal((await helper.reconcile(scope())).updated, 1);
      assert.deepEqual(await native(value.id), { ...before, status: "cancelled" });
      assert.equal(
        (await f.pool.request().query("SELECT COUNT(*) n FROM dbo.sales")).recordset[0].n,
        0,
      );
    });
    await test("NULL bill number cannot be inferred from a label or accepted-parent echo", async () => {
      await reset();
      const value = await seed({ bill: null });
      records = [parentRecord({ ...value, bill: "guessed-from-label" })];
      await assert.rejects(helper.reconcile(scope()), { code: "EHELD_STATUS_PROTOCOL" });
      assert.equal(await json(value.id), value.before);
      assert.equal(await receiptCount(), 0);
    });
    await test("same bill with a different local parent ID is not accepted", async () => {
      await reset();
      const value = await seed({ localParent: true });
      records = [parentRecord({ ...value, parent: randomUUID() })];
      assert.equal((await helper.reconcile(scope())).updated, 0);
      assert.equal(await json(value.id), value.before);
      assert.equal(await receiptCount(), 0);
    });
    await test("local pending held operation prevents an adoption", async () => {
      await reset();
      const value = await seed();
      records = [await heldRecord(value)];
      await f.pool
        .request()
        .input("entity", JSON.stringify({ id: value.id }))
        .input("branch", branch)
        .query(
          "INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id)VALUES(N'held_orders',@entity,N'update',@branch,7,NEWID());",
        );
      await assert.rejects(helper.reconcile(scope()), { code: "EHELD_STATUS_CT_REVIEW" });
      assert.equal(await json(value.id), value.before);
      assert.equal(await receiptCount(), 0);
    });
    await test("exact cloud completion can clear one hold while an unrelated scoped hold remains pending", async () => {
      await reset();
      const complete = await seed({ localParent: true, bill: "SCOPED-SAVED" });
      const pending = await seed({ bill: "SCOPED-PENDING" });
      const foreign = await seed({ storeId: other, bill: complete.bill });
      await f.pool
        .request()
        .input("sale", complete.parent)
        .input("branch", branch)
        .query(`DECLARE @product uniqueidentifier=NEWID();
          INSERT dbo.products(id,barcode,name,stock_quantity,stock_by_store)
          VALUES(@product,N'SCOPED-STOCK',N'Saved item',4,N'{"HOLD-OWNED-A":4}');
          INSERT dbo.sale_items(sale_id,product_id,product_name,quantity,unit_price,branch_id)
          VALUES(@sale,@product,N'Saved line',1,12.35,@branch);
          INSERT dbo.payment_transactions(sale_id,source_type,amount,method,kind,status,store_id)
          VALUES(@sale,N'sale',12.35,N'cash',N'payment',N'completed',@branch);
          INSERT dbo.local_operation_receipts(operation_id,operation_type,entity_id,note)
          VALUES(NEWID(),N'sale',CONVERT(nvarchar(36),@sale),REPLICATE(N'a',64));`);
      await checkpoints();
      await f.pool
        .request()
        .input("id", pending.id)
        .input("entity", JSON.stringify({ id: pending.id }))
        .input("branch", branch)
        .query(`UPDATE dbo.held_orders SET label=N'Unsent local cart' WHERE id=@id;
          INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id)
          VALUES(N'held_orders',@entity,N'update',@branch,7,NEWID());`);
      const business = async () =>
        (
          await f.pool.request().query(`SELECT
            (SELECT * FROM dbo.sales FOR JSON PATH,INCLUDE_NULL_VALUES) sales,
            (SELECT * FROM dbo.sale_items FOR JSON PATH,INCLUDE_NULL_VALUES) items,
            (SELECT * FROM dbo.payment_transactions FOR JSON PATH,INCLUDE_NULL_VALUES) payments,
            (SELECT * FROM dbo.products FOR JSON PATH,INCLUDE_NULL_VALUES) stock,
            (SELECT * FROM dbo.local_operation_receipts WHERE operation_type=N'sale' FOR JSON PATH,INCLUDE_NULL_VALUES) sale_receipts,
            (SELECT * FROM dbo.sync_change_journal FOR JSON PATH,INCLUDE_NULL_VALUES) journal,
            (SELECT * FROM dbo.sync_checkpoints ORDER BY entity_type FOR JSON PATH,INCLUDE_NULL_VALUES) checkpoints;`)
        ).recordset[0];
      const retained = await business();
      const pendingBefore = await json(pending.id);
      records = [
        await heldRecord(complete, "completed"),
        await heldRecord(pending),
        { ...await heldRecord(foreign, "completed"), parent: parentRecord(complete).parent },
      ];
      onCloud = async ({ tickets }) => assert(!tickets.some((ticket) => ticket.id === foreign.id));
      attemptPending = complete.id;
      const result = await helper.reconcile(scope());
      assert.equal(result.updated, 1);
      assert.equal(result.reviewRequired, 1);
      assert.equal(result.code, "EHELD_STATUS_CT_REVIEW");
      assert.deepEqual(await native(complete.id), { ...JSON.parse(complete.before), status: "completed" });
      assert.equal(await json(pending.id), pendingBefore);
      assert.equal(await json(foreign.id), foreign.before);
      assert.deepEqual(await business(), retained);
      assert.equal(await receiptCount(), 1);
      await assert.rejects(helper.reconcile(scope()), { code: "EHELD_STATUS_CT_REVIEW" });
      assert.equal(await receiptCount(), 1);
      assert.deepEqual(await business(), retained);
    });
    await test("a target Change Tracking edit and weaker parent-only proof remain pending", async () => {
      await reset();
      const safe = await seed({ bill: "SCOPED-SAFE" });
      const edited = await seed({ bill: "SCOPED-CT" });
      const parentOnly = await seed({ localParent: true, bill: "SCOPED-PARENT-ONLY" });
      await f.pool
        .request()
        .input("id", edited.id)
        .query("UPDATE dbo.held_orders SET label=N'Legacy unsent edit' WHERE id=@id;");
      const changed = await json(edited.id);
      records = [await heldRecord(safe), await heldRecord(edited), parentRecord(parentOnly)];
      const result = await helper.reconcile(scope());
      assert.equal(result.updated, 1);
      assert.equal(result.reviewRequired, 2);
      assert.equal(result.code, "EHELD_STATUS_CT_REVIEW");
      assert.equal((await native(safe.id)).status, "cancelled");
      assert.equal(await json(edited.id), changed);
      assert.equal(await json(parentOnly.id), parentOnly.before);
      assert.equal(await receiptCount(), 1);
    });
    await test("unscoped, ambiguous and malformed held keys cannot authorize independent completion", async () => {
      for (const [pendingBranch, key] of [
        ["global", JSON.stringify({ id: "known-other" })],
        ["", JSON.stringify({ id: "known-other" })],
        [branch, "legacy-unknown-key"],
        [branch, '{"id":"known-other","id":"different"}'],
        [branch, '{"id":"held-case-alias"}'],
      ]) {
        await reset();
        const value = await seed({ localParent: true, id: "HELD-CASE-ALIAS" });
        records = [await heldRecord(value, "completed")];
        await f.pool
          .request()
          .input("entity", key)
          .input("branch", pendingBranch)
          .query(`INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id)
            VALUES(N'held_orders',@entity,N'update',@branch,7,NEWID());`);
        await assert.rejects(helper.reconcile(scope()), { code: "EHELD_STATUS_CT_REVIEW" });
        assert.equal(await json(value.id), value.before);
        assert.equal(await receiptCount(), 0);
      }
    });
    await test("same-branch bill aliases and deleted local holds cannot be treated as independent", async () => {
      for (const deleted of [false, true]) {
        await reset();
        const value = await seed({ localParent: true });
        const alias = await seed({ bill: value.bill });
        if (deleted) {
          await f.pool
            .request()
            .input("id", alias.id)
            .query("DELETE dbo.held_orders WHERE id=@id;");
        } else {
          await f.pool
            .request()
            .input("entity", JSON.stringify({ id: alias.id }))
            .input("branch", branch)
            .query(`INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id)
              VALUES(N'held_orders',@entity,N'update',@branch,7,NEWID());`);
        }
        records = [await heldRecord(value, "completed")];
        await assert.rejects(helper.reconcile(scope()), { code: "EHELD_STATUS_CT_REVIEW" });
        assert.equal(await json(value.id), value.before);
        assert.equal(await receiptCount(), 0);
      }
    });
    await test("unattributed legacy pending work cannot be treated as another branch", async () => {
      await reset();
      const value = await seed();
      records = [await heldRecord(value)];
      await f.pool
        .request()
        .input("entity", JSON.stringify({ id: value.id }))
        .query(
          "INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id)VALUES(N'held_orders',@entity,N'update',N'',7,NEWID());",
        );
      await assert.rejects(helper.reconcile(scope()), { code: "EHELD_STATUS_CT_REVIEW" });
      assert.equal(await json(value.id), value.before);
      assert.equal(await receiptCount(), 0);
    });
    await test("global retained held and sale work remains pending despite a valid CT baseline", async () => {
      for (const entity of ["held_orders", "sales"]) {
        await reset();
        const value = await seed({ localParent: entity === "sales" });
        records = [entity === "sales" ? parentRecord(value) : await heldRecord(value)];
        await f.pool
          .request()
          .input("entity", entity)
          .input("id", JSON.stringify({ id: entity === "sales" ? value.parent : value.id }))
          .query(
            "INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id)VALUES(@entity,@id,N'update',N'global',7,NEWID());",
          );
        // The canonical reader still recognizes this journal namespace even
        // when retained CT was already covered by a previous push checkpoint.
        const { ChangeReader } = require("../electron/sync/change-reader.cjs");
        assert.equal(
          (await new ChangeReader(manager, registry).pendingAggregates(branch)).length,
          1,
        );
        const result = await helper.reconcile(scope()).catch((error) => {
          assert.equal(error.code, "EHELD_STATUS_CT_REVIEW");
          return { updated: 0, reviewRequired: 1 };
        });
        assert.equal(result.updated, 0);
        assert(result.reviewRequired);
        assert.equal(await json(value.id), value.before);
        assert.equal(await receiptCount(), 0);
      }
    });
    await test("expired held CT is review-required and no progress is reset", async () => {
      await reset();
      const value = await seed();
      records = [await heldRecord(value)];
      const before = (
        await f.pool
          .request()
          .query(
            "SELECT CONVERT(varchar(30),change_tracking_version) v FROM dbo.sync_checkpoints WHERE branch_id=N'HOLD-OWNED-A' AND entity_type=N'held_orders';",
          )
      ).recordset[0].v;
      await f.pool
        .request()
        .batch(
          "UPDATE dbo.stores SET name=N'Advance owned CT' WHERE id=N'HOLD-OWNED-A';ALTER TABLE dbo.held_orders DISABLE CHANGE_TRACKING;ALTER TABLE dbo.held_orders ENABLE CHANGE_TRACKING;",
        );
      await assert.rejects(helper.reconcile(scope()), { code: "EHELD_STATUS_CT_REVIEW" });
      assert.equal(await json(value.id), value.before);
      assert.equal(
        (
          await f.pool
            .request()
            .query(
              "SELECT CONVERT(varchar(30),change_tracking_version) v FROM dbo.sync_checkpoints WHERE branch_id=N'HOLD-OWNED-A' AND entity_type=N'held_orders';",
            )
        ).recordset[0].v,
        before,
      );
      assert.equal(await receiptCount(), 0);
    });
    await test("related pending sale or missing parent CT evidence is not silently accepted", async () => {
      await reset();
      const value = await seed({ localParent: true });
      records = [parentRecord(value)];
      await f.pool
        .request()
        .input("branch", branch)
        .query(
          "DELETE dbo.sync_checkpoints WHERE branch_id=@branch AND entity_type=N'payment_transactions';",
        );
      assert.equal((await helper.reconcile(scope())).updated, 0);
      assert.equal(await json(value.id), value.before);
      assert.equal(await receiptCount(), 0);
    });
    await test("source change during network work prevents every local write", async () => {
      await reset();
      const value = await seed();
      records = [await heldRecord(value)];
      onCloud = async () => {
        current = false;
      };
      await assert.rejects(helper.reconcile(scope()), { code: "EHELD_STATUS_CONTEXT" });
      assert.equal(await json(value.id), value.before);
      assert.equal(await receiptCount(), 0);
    });
    await test("a changed local row is preserved even when its CT context is CLOUD", async () => {
      await reset();
      const value = await seed();
      records = [await heldRecord(value)];
      onCloud = async () => {
        await f.pool
          .request()
          .input("id", value.id)
          .query(
            "WITH CHANGE_TRACKING_CONTEXT(0x434C4F5544) UPDATE dbo.held_orders SET label=N'Newly downloaded label' WHERE id=@id;",
          );
      };
      assert.equal((await helper.reconcile(scope())).updated, 0);
      assert.equal((await native(value.id)).label, "Newly downloaded label");
      assert.equal((await native(value.id)).status, "held");
      assert.equal(await receiptCount(), 0);
    });
    await test("receipt failure rolls back status, CT and provenance atomically", async () => {
      await reset();
      const value = await seed();
      records = [await heldRecord(value)];
      receiptFault = true;
      await assert.rejects(helper.reconcile(scope()), { code: "FIXTURE_RECEIPT_FAIL" });
      receiptFault = false;
      assert.equal(await json(value.id), value.before);
      assert.equal(await receiptCount(), 0);
      assert.equal((await helper.reconcile(scope())).updated, 1);
      assert.equal(await receiptCount(), 1);
    });
    await test("a foreign operation receipt collision cannot authorize or overwrite this adoption", async () => {
      await reset();
      const value = await seed();
      records = [await heldRecord(value)];
      const receipt = adoptionReceipt({
        databaseGuid: f.guid.toLowerCase(),
        branchId: branch,
        terminalId: terminal,
        record: records[0],
        beforeJson: value.before,
        oldStatus: "held",
        sourceKey,
      });
      await f.pool
        .request()
        .input("id", receipt.id)
        .query(
          "INSERT dbo.local_operation_receipts(operation_id,operation_type,entity_id,note)VALUES(@id,N'sale',N'foreign',N'not adoption evidence');",
        );
      await assert.rejects(helper.reconcile(scope()), { code: "EHELD_STATUS_RECEIPT" });
      assert.equal(await json(value.id), value.before);
      assert.equal(await receiptCount(), 0);
    });
    await test("an exact adoption receipt beside an active row requires review, not another write", async () => {
      await reset();
      const value = await seed();
      records = [await heldRecord(value)];
      const receipt = adoptionReceipt({
        databaseGuid: f.guid.toLowerCase(),
        branchId: branch,
        terminalId: terminal,
        record: records[0],
        beforeJson: value.before,
        oldStatus: "held",
        sourceKey,
      });
      await f.pool
        .request()
        .input("id", receipt.id)
        .input("entity", receipt.entity)
        .input("note", receipt.note)
        .query(
          "INSERT dbo.local_operation_receipts(operation_id,operation_type,entity_id,note)VALUES(@id,N'held_status_cloud_adoption_v1',@entity,@note);",
        );
      const result = await helper.reconcile(scope());
      assert.equal(result.updated, 0);
      assert(result.reviewRequired);
      assert.equal(await json(value.id), value.before);
      assert.equal(await receiptCount(), 1);
    });
    await test("held row locks exclude ALTER TRIGGER between validation and status use", async () => {
      await reset();
      const value = await seed();
      records = [await heldRecord(value)];
      attemptDDL = true;
      assert.equal((await helper.reconcile(scope())).updated, 1);
      assert.equal(attemptDDL, false);
      assert.equal(
        (
          await f.pool
            .request()
            .query("SELECT OBJECT_DEFINITION(OBJECT_ID(N'dbo.held_orders_lifecycle')) definition;")
        ).recordset[0].definition,
        originalHeld,
      );
    });
    await test("binary continuation reaches a recoverable suffix after 101 unresolved tickets and excludes concurrent IDs beyond the initial fence", async () => {
      await reset();
      const ids = Array.from({ length: 101 }, (_, i) => "a-prefix-" + String(i).padStart(3, "0"));
      await f.pool
        .request()
        .input("branch", branch)
        .input("ids", JSON.stringify(ids))
        .query(
          "INSERT dbo.held_orders(id,store_id,bill_no,label,status,total,lines,row_version) SELECT value,@branch,value,N'Unresolved fixture',N'held',12.35,N'[]',7 FROM OPENJSON(@ids);",
        );
      const value = await seed({ id: "z-recoverable", localParent: true });
      records = [parentRecord(value)];
      const visited = [];
      onCloud = async (args) => {
        visited.push(...args.tickets.map((ticket) => ticket.id));
        if (visited.length === 4)
          await f.pool
            .request()
            .input("branch", branch)
            .query(
              "WITH CHANGE_TRACKING_CONTEXT(0x434C4F5544) INSERT dbo.held_orders(id,store_id,bill_no,label,status,total,lines,row_version) VALUES(N'zz-after-fence',@branch,N'After',N'Concurrent fixture',N'held',12.35,N'[]',7);",
            );
      };
      const result = await helper.reconcile(scope());
      assert.deepEqual(visited, [...ids, value.id]);
      assert.equal(result.updated, 1);
      assert.equal(result.reviewRequired, 101);
      assert.equal((await native(value.id)).status, "completed");
      assert.equal((await native("zz-after-fence")).status, "held");
      assert.equal(await receiptCount(), 1);
    });
    await test("receipt key lock excludes a new INSERT trigger between validation and receipt write", async () => {
      await reset();
      const value = await seed();
      records = [await heldRecord(value)];
      attemptDDL = "receipt";
      assert.equal((await helper.reconcile(scope())).updated, 1);
      assert.equal(attemptDDL, false);
      assert.equal(await receiptCount(), 1);
      assert.equal(
        (await f.pool.request().query("SELECT OBJECT_ID(N'dbo.owned_late_receipt') trigger_id;"))
          .recordset[0].trigger_id,
        null,
      );
    });
    await test("large escaped identity responses are split into no more than four known IDs without losing valid proofs", async () => {
      await reset();
      const ids = Array.from({ length: 9 }, (_, i) => "large-ticket-" + i),
        lines = JSON.stringify([
          { productId: "\u0800".repeat(19000) + '"'.repeat(2000), qty: 1, price: 12.35 },
        ]);
      await f.pool
        .request()
        .input("branch", branch)
        .input("ids", JSON.stringify(ids))
        .input("lines", f.sql.NVarChar(f.sql.MAX), lines)
        .query(
          "INSERT dbo.held_orders(id,store_id,bill_no,label,status,total,lines,row_version) SELECT value,@branch,value,N'Large fixture',N'held',12.35,@lines,7 FROM OPENJSON(@ids);",
        );
      await checkpoints();
      records = await Promise.all(ids.map((id) => heldRecord({ id })));
      assert(records.every((row) => Buffer.byteLength(row.identityJson) > 60000));
      const sizes = [];
      onCloud = async (args) => {
        sizes.push(args.tickets.length);
        assert(
          Buffer.byteLength(
            JSON.stringify(
              records.filter((row) => args.tickets.some((ticket) => ticket.id === row.id)),
            ),
          ) <
            2 * 1024 * 1024,
        );
      };
      const result = await helper.reconcile(scope());
      assert.equal(result.updated, 9);
      assert.equal(result.reviewRequired, 0);
      assert.deepEqual(sizes, [4, 4, 1]);
      assert.equal(await receiptCount(), 9);
    });
    await test("one explicitly oversized source and one large identity remain in review while a safe suffix still completes", async () => {
      await reset();
      const huge = await seed({ id: "a-explicit-oversize", bill: "A" }),
        large = await seed({ id: "b-large-identity", bill: "B" }),
        good = await seed({ id: "c-good", bill: "C" });
      records = [
        { ...(await heldRecord(large)), identityJson: "x".repeat(65537) },
        await heldRecord(good),
      ];
      const sizes = [];
      onCloud = async (args) => {
        sizes.push(args.tickets.length);
        if (args.tickets.some((ticket) => ticket.id === huge.id))
          throw Object.assign(Error("HELD_STATUS_TOO_LARGE"), { code: "54000" });
      };
      const result = await helper.reconcile(scope());
      assert.equal(result.updated, 1);
      assert.equal(result.reviewRequired, 2);
      assert.equal(result.code, "EHELD_STATUS_OVERSIZED");
      assert.deepEqual(sizes, [3, 2, 1, 1, 1]);
      assert.equal(await json(huge.id), huge.before);
      assert.equal(await json(large.id), large.before);
      assert.equal((await native(good.id)).status, "cancelled");
      assert.equal(await receiptCount(), 1);
    });
    await test("a generic transport failure does not split or authorize a status change", async () => {
      await reset();
      const a = await seed({ id: "a-retry", bill: "A" }),
        b = await seed({ id: "b-retry", bill: "B" });
      records = [await heldRecord(a), await heldRecord(b)];
      let calls = 0;
      onCloud = async () => {
        calls++;
        throw Object.assign(Error("Temporary upstream failure"), { code: "HTTP_503" });
      };
      await assert.rejects(helper.reconcile(scope()), { code: "HTTP_503" });
      assert.equal(calls, 1);
      assert.equal(await json(a.id), a.before);
      assert.equal(await json(b.id), b.before);
      assert.equal(await receiptCount(), 0);
    });
    for (const [table, action] of [
      ["held_orders", "UPDATE"],
      ["local_operation_receipts", "INSERT"],
    ]) {
      await test(`unexpected ${table} ${action} trigger attached after the package probe cannot run`, async () => {
        await reset();
        const value = await seed();
        records = [await heldRecord(value)];
        const before = (
          await f.pool
            .request()
            .input("id", other)
            .query("SELECT name FROM dbo.stores WHERE id=@id;")
        ).recordset[0].name;
        onCloud = async () => {
          await f.pool
            .request()
            .batch(
              `CREATE TRIGGER dbo.owned_unexpected_side_effect ON dbo.[${table}] AFTER ${action} AS BEGIN SET NOCOUNT ON;UPDATE dbo.stores SET name=N'Unexpected side effect' WHERE id=N'HOLD-OWNED-B';END;`,
            );
        };
        try {
          const failure = await helper.reconcile(scope()).then(
            () => null,
            (error) => error,
          );
          const sideEffect =
            (
              await f.pool
                .request()
                .input("id", other)
                .query("SELECT name FROM dbo.stores WHERE id=@id;")
            ).recordset[0].name !== before;
          assert.equal(
            failure?.code,
            "EHELD_STATUS_SCHEMA",
            "Unexpected trigger side effect committed: " + sideEffect,
          );
          assert.equal(sideEffect, false);
          assert.equal(await json(value.id), value.before);
          assert.equal(await receiptCount(), 0);
        } finally {
          await f.pool.request().batch("DROP TRIGGER IF EXISTS dbo.owned_unexpected_side_effect;");
        }
      });
    }
    await test("unknown trigger definition is denied before network or local changes", async () => {
      await reset();
      const value = await seed();
      records = [await heldRecord(value)];
      let called = false;
      onCloud = async () => {
        called = true;
      };
      await f.pool
        .request()
        .batch(
          "ALTER TRIGGER dbo.held_orders_lifecycle ON dbo.held_orders AFTER INSERT,UPDATE AS BEGIN SET NOCOUNT ON;END;",
        );
      await assert.rejects(helper.reconcile(scope()), { code: "EHELD_STATUS_SCHEMA" });
      assert.equal(called, false);
      assert.equal(await json(value.id), value.before);
      assert.equal(await receiptCount(), 0);
    });
    console.log(
      "PASS " +
        count +
        " full-core24 owned SQL held-status recovery groups; cloud proofs are injected fixture responses, not hosted device acceptance",
    );
  } finally {
    await f.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
