import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { stableUuid } = require("../../electron/db/repositories/aggregates.cjs");

export async function verifyNativeRefundGateway({ db, read, scalar, liveSale, branch, epoch, terminal, author, product }) {
  await db.exec(`ALTER TABLE public.terminal_tokens ALTER COLUMN id TYPE uuid USING id::uuid;
    ALTER TABLE public.terminal_tokens ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
      ADD COLUMN IF NOT EXISTS claimed_platform text, ADD COLUMN IF NOT EXISTS claim_proof text,
      ADD COLUMN IF NOT EXISTS claimed_proof_hash text;`);
  const bridge = await read("scripts/preparation/pos-sync-cash-bridge-v1.sql");
  await db.exec(bridge.slice(0, bridge.indexOf("CREATE FUNCTION pos_sync_cash_v1.apply_checkout(")));
  await db.exec(await read("scripts/preparation/pos-sync-refund-native-gateway-v1.sql"));
  const key = randomUUID(), generation = randomUUID(), databaseGuid = randomUUID();
  const binding = "a".repeat(64), project = "https://refund-fixture.supabase.co";
  const subject = await scalar("SELECT user_id FROM public.app_users WHERE id=$1", [author]);
  await db.query("UPDATE public.terminal_tokens SET claim_proof=$1 WHERE id=$2", [binding, terminal]);
  await db.query(`INSERT INTO pos_sync_cash_v1.installation_enrollments
    VALUES('default',$1,$2,$3,$4)`, [terminal, branch, generation, databaseGuid]);
  await db.query(`INSERT INTO pos_sync_private.shift_author_keys
    (key_id,author_id,terminal_id,project_origin,subject,public_key)
    VALUES($1,$2,$3,$4,$5,$6)`, [key, author, terminal, project, subject, "a".repeat(59)]);
  const sale = await liveSale(true);
  const item = await scalar("SELECT to_jsonb(i) FROM public.sale_items i WHERE sale_id=$1", [sale.id]);
  const refundKey = "refund:" + sale.id, operationId = stableUuid({ refundId: refundKey });
  const args = [author, branch, terminal, operationId, refundKey, sale.id, 1,
    JSON.stringify([{ item_id: item.id, qty: item.quantity, expected_refunded_qty: 0, expected_row_version: item.row_version }]),
    "native refund fixture", null, binding, generation, databaseGuid, epoch, key, subject, project,
    JSON.stringify([{ item_id: item.id, product_id: product }])];
  const send = values => scalar(`SELECT public.pos_sync_refund_attested_v1(
    $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)`, values);
  for (const invalidIndex of [12, 13, 14]) {
    const bad = [...args];
    bad[invalidIndex] = randomUUID();
    await assert.rejects(send(bad), /POS_REFUND_V1_(SCOPE|AUTHOR)_FORBIDDEN/);
  }
  const preflight = await send(args);
  assert.equal(preflight.status, "APPROVAL_CHECK_REQUIRED");
  assert.equal(await scalar("SELECT is_refunded FROM public.sales WHERE id=$1", [sale.id]), false);
  const confirmed = [...args];
  confirmed[9] = JSON.stringify(preflight.basis);
  const wrongProduct = [...confirmed];
  wrongProduct[17] = JSON.stringify([{ item_id: item.id, product_id: randomUUID() }]);
  await assert.rejects(send(wrongProduct), /POS_REFUND_V1_STALE_COMMAND/);
  assert.equal(await scalar("SELECT is_refunded FROM public.sales WHERE id=$1", [sale.id]), false);
  const receipt = await send(confirmed);
  assert.equal(receipt.status, "APPLIED");
  assert.equal(receipt.fully_refunded, true);
  assert.equal(receipt.effects[0].product_id, product);
  assert.equal(receipt.feed_epoch, epoch);
  assert.equal(receipt.feed_seq, await scalar(
    "SELECT seq::text FROM pos_sync_feed_v1.extended_publications WHERE operation_id=$1", [operationId]));
  assert.deepEqual(await send(args), receipt);
  await db.query("UPDATE pos_sync_private.shift_author_keys SET revoked_at=now() WHERE key_id=$1", [key]);
  await assert.rejects(send(args), /POS_REFUND_V1_AUTHOR_FORBIDDEN/);
}

export async function verifyRefundSync({ db, author, admin, manager, terminal, product, sale, submit, scalar, test }) {
  const seed = async (options = {}) => {
    const original = sale();
    const item = randomUUID();
    await submit(original, {
      items: [{ id: item, product_id: product, product_name: "Fixture", quantity: 3, unit_price: "2.00" }],
      movements: [{ id: randomUUID(), product_id: product, activity_type: "sale", quantity_delta: -3 }],
    });
    const refundKey = options.key ?? `refund:${original.id}`;
    const command = {
      saleId: original.id,
      itemId: item,
      operationId: stableUuid({ refundId: refundKey }),
      refundKey,
      lines: [{ item_id: item, qty: options.qty ?? 1, expected_refunded_qty: 0, expected_row_version: 1 }],
      basis: { bill_number: original.bill_number, total: original.total_amount, row_version: 1 },
    };
    return command;
  };
  const send = (command, options = {}) => scalar(
    "SELECT public.pos_sync_refund_v1($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb)",
    [
      options.author ?? author, options.branch ?? "A", terminal, options.operationId ?? command.operationId,
      command.refundKey, command.saleId, options.saleVersion ?? 1, JSON.stringify(options.lines ?? command.lines),
      options.reason ?? "verified refund",
      options.preflight ? null : JSON.stringify(options.basis ?? command.basis),
    ],
  );
  const legacy = (command, qty = command.lines[0].qty, refundKey = command.refundKey) => scalar(
    "SELECT public.sale_refund($1,$2::jsonb,$3,'legacy refund','A')",
    [command.saleId, JSON.stringify([{ item_id: command.itemId, qty }]), refundKey],
  );
  const windowsMovement = (command, upper = true) => stableUuid({
    refundId: command.refundKey, itemId: upper ? command.itemId.toUpperCase() : command.itemId,
  });
  const oldNativeStock = (id, qty) => scalar("SELECT public.sync_apply_stock_delta_applied($1::jsonb)", [
    JSON.stringify([{ movement_id: id, product_id: product, store_id: "A", delta: qty }]),
  ]);
  const cloudMovement = command => createHash("md5").update(`${command.refundKey}:${command.itemId}`).digest("hex");
  const facts = async command => (await db.query(
    `SELECT (SELECT refunded_qty FROM sale_items WHERE id=$1) AS refunded,
      (SELECT (stock_by_store->>'A')::int FROM products WHERE id=$2) AS stock,
      (SELECT count(*)::int FROM stock_delta_applied WHERE product_id=$2) AS movements,
      (SELECT count(*)::int FROM pos_sync_refund_v1.receipts WHERE operation_id=$3) AS receipts,
      (SELECT count(*)::int FROM pos_sync_refund_v1.movement_aliases WHERE operation_id=$3) AS aliases`,
    [command.itemId, product, command.operationId],
  )).rows[0];

  await test("actual Windows IDs match the PostgreSQL alias derivation for each SQL UUID spelling", async () => {
    const command = await seed({ key: 'réfund-"fixture"-🧾' });
    for (const upper of [false, true]) {
      const item = upper ? command.itemId.toUpperCase() : command.itemId;
      assert.equal(await scalar("SELECT pos_sync_refund_v1.native_movement_id($1,$2)::text", [command.refundKey, item]),
        windowsMovement(command, upper));
    }
    assert.equal(await scalar("SELECT pos_sync_refund_v1.native_id($1)::text", [
      JSON.stringify({ refundId: command.refundKey }),
    ]), command.operationId);
  });

  await test("verified refund records exact line, ledger and stock effects, with replay before stale checks", async () => {
    const command = await seed();
    const before = await facts(command);
    assert.deepEqual(await send(command, { preflight: true }), {
      status: "APPROVAL_CHECK_REQUIRED", operation_id: command.operationId, sale_id: command.saleId, basis: command.basis,
    });
    assert.deepEqual(await facts(command), before);
    await assert.rejects(send(command, { basis: { ...command.basis, total: "1" } }), /POS_REFUND_V1_STALE_COMMAND/);
    assert.deepEqual(await facts(command), before);
    const accepted = await send(command);
    const after = await facts(command);
    assert.equal(accepted.status, "APPLIED");
    assert.equal(accepted.operation_id, command.operationId);
    assert.equal(accepted.effects[0].movement_id.replaceAll("-", ""), cloudMovement(command));
    assert.deepEqual(accepted.effects[0], {
      item_id: command.itemId, product_id: product, branch_id: "A", delta: 1,
      movement_id: accepted.effects[0].movement_id, refunded_qty: 1, row_version: 2,
    });
    assert.deepEqual(accepted.stock, [{ product_id: product, branch_id: "A", balance: before.stock + 1 }]);
    assert.equal(accepted.fully_refunded, false);
    assert.equal(accepted.sale_row_version, 1);
    assert.equal(after.refunded, 1);
    assert.equal(after.stock, before.stock + 1);
    assert.equal(after.movements, before.movements + 1);
    assert.equal(after.receipts, 1);
    assert.deepEqual(await send(command), accepted);
    assert.deepEqual(await send(command, { preflight: true }), accepted);
    await assert.rejects(send(command, { reason: "changed reason" }), /POS_REFUND_V1_REPLAY_MISMATCH/);
    assert.deepEqual(await facts(command), after);
  });

  await test("full verified refund preserves the actual sale update and increments its revision once", async () => {
    const command = await seed({ qty: 3 });
    const result = await send(command);
    assert.equal(result.fully_refunded, true);
    assert.equal(result.sale_row_version, 2);
    assert.equal(await scalar("SELECT is_refunded FROM public.sales WHERE id=$1", [command.saleId]), true);
    assert.deepEqual(await send(command, { preflight: true }), result);
  });

  await test("legacy cloud and Windows replays after acceptance roll back, while an independent old refund still works", async () => {
    const command = await seed();
    await send(command);
    const accepted = await facts(command);
    await assert.rejects(legacy(command), /POS_REFUND_V1_MOVEMENT_OWNED/);
    await assert.rejects(oldNativeStock(windowsMovement(command), 1), /POS_REFUND_V1_MOVEMENT_OWNED/);
    await assert.rejects(oldNativeStock(windowsMovement(command, false), 2), /POS_REFUND_V1_MOVEMENT_OWNED/);
    assert.deepEqual(await facts(command), accepted);
    await legacy(command, 1, randomUUID());
    const after = await facts(command);
    assert.equal(after.refunded, accepted.refunded + 1);
    assert.equal(after.stock, accepted.stock + 1);
  });

  await test("cloud or Windows history without an authoritative receipt stays held without changing stock or lines", async () => {
    for (const route of ["cloud", "windows", "windows collision"]) {
      const command = await seed();
      if (route === "cloud") await legacy(command);
      else await oldNativeStock(windowsMovement(command), route === "windows" ? 1 : 2);
      const before = await facts(command);
      const result = await send(command);
      assert.equal(result.status, "REVIEW_REQUIRED");
      assert.equal(result.code, route === "windows collision" ? "REFUND_MOVEMENT_COLLISION" : "LEGACY_REFUND_MOVEMENT");
      const held = await facts(command);
      assert.ok(held.aliases > before.aliases);
      assert.deepEqual(held, { ...before, receipts: 1, aliases: held.aliases });
      assert.deepEqual(await send(command), result);
      await assert.rejects(send(command, { lines: [{ ...command.lines[0], qty: 2 }] }), /POS_REFUND_V1_REPLAY_MISMATCH/);
      await assert.rejects(legacy(command), /POS_REFUND_V1_MOVEMENT_OWNED/);
      await assert.rejects(oldNativeStock(windowsMovement(command), 1), /POS_REFUND_V1_MOVEMENT_OWNED/);
      assert.deepEqual(await facts(command), held);
    }
  });

  await test("stale or out-of-scope commands and unauthorized roles leave no pending aliases or effects", async () => {
    const command = await seed();
    const before = await facts(command);
    await assert.rejects(send(command, { author: manager }), /FIN62_LIVE_PERMISSION_DENIED/);
    await assert.rejects(send(command, { branch: "B", author: admin }), /BRANCH_DENIED/);
    await assert.rejects(send(command, { saleVersion: 2 }), /POS_REFUND_V1_STALE_COMMAND/);
    await assert.rejects(send(command, { lines: [{ ...command.lines[0], expected_refunded_qty: 1 }] }), /POS_REFUND_V1_STALE_COMMAND/);
    await assert.rejects(send(command, { operationId: randomUUID() }), /POS_REFUND_V1_INVALID_COMMAND/);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role};`);
      try { await assert.rejects(send(command), /permission denied/); }
      finally { await db.exec("RESET ROLE;"); }
    }
    await db.exec("SET ROLE service_role;");
    try { await assert.rejects(db.exec("SELECT * FROM pos_sync_refund_v1.receipts;"), /permission denied/); }
    finally { await db.exec("RESET ROLE;"); }
    assert.deepEqual(await facts(command), before);
  });

  await test("late effect verification failure rolls back line, balance, aliases and both receipts", async () => {
    const command = await seed();
    const before = await facts(command);
    await db.exec(`CREATE FUNCTION public.refund_fixture_break_balance() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.id = '${product}'::uuid THEN NEW.stock_by_store := OLD.stock_by_store; END IF; RETURN NEW; END $$;
      CREATE TRIGGER refund_fixture_break_balance BEFORE UPDATE ON public.products
        FOR EACH ROW EXECUTE FUNCTION public.refund_fixture_break_balance();`);
    try { await assert.rejects(send(command), /POS_REFUND_V1_EFFECT_UNVERIFIED/); }
    finally { await db.exec("DROP TRIGGER refund_fixture_break_balance ON public.products; DROP FUNCTION public.refund_fixture_break_balance();"); }
    assert.deepEqual(await facts(command), before);
    assert.equal(await scalar("SELECT count(*)::int FROM fin62_live_preparation.receipts WHERE sale_id=$1 AND action='REFUND'",
      [command.saleId]), 0);
    assert.equal((await send(command)).status, "APPLIED");
  });
}
