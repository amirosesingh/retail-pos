import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const read = async relative => (await readFile(new URL(relative, import.meta.url), "utf8")).replaceAll("\r\n", "\n");
const sqlText = value => `'${value.replaceAll("'", "''")}'`;
const digest = value => createHash("sha256").update(value, "utf8").digest("hex");
const proof = "a".repeat(64);
const at = "2026-11-07T09:00:00Z";
const serviceClaims = `SET request.jwt.claims = '{"role":"service_role"}';`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function verifyCashBridge({ sql, denySql, wire }) {
  const saved = wire ? JSON.parse(wire.checkoutJson) : null;
  const branch = wire?.scope.branchId ?? "A";
  const otherBranch = branch === "B" ? "A" : "B";
  const epoch = wire?.scope.feedEpoch ?? randomUUID();
  const terminal = wire?.scope.terminalId ?? randomUUID();
  const installationGeneration = wire?.scope.installationGeneration ?? randomUUID();
  const databaseGuid = wire?.scope.databaseGuid ?? randomUUID();
  const shift = saved?.sale.shift_id ?? randomUUID();
  const product = saved?.item.product_id ?? randomUUID();
  const productName = saved?.item.product_name ?? "Fixture café";
  const price = saved?.item.unit_price ?? "3.10";
  const cost = saved?.item.unit_cost ?? "0";
  assert([epoch, terminal, installationGeneration, databaseGuid, shift, product].every(value => uuid.test(value)));
  if (wire) {
    assert(uuid.test(wire.operationId) && wire.saleId === saved.sale.id);
    assert.equal(saved.sale.store_id, branch);
    assert.equal(saved.tender.terminal_id, terminal);
  }

  const source = await read("../../supabase/schema.sql");
  const definition = name => {
    const begin = source.lastIndexOf(`\nCREATE OR REPLACE FUNCTION public.${name}(`);
    assert(begin >= 0, `Missing repository function ${name}`);
    const tail = source.slice(begin);
    const opening = tail.match(/\bAS\s+(\$[\w]*\$)/i);
    assert(opening, `Missing function body for ${name}`);
    const delimiter = opening[1];
    const end = tail.indexOf(`${delimiter};`, opening.index + opening[0].length);
    assert(end >= 0, `Unclosed function ${name}`);
    return tail.slice(0, end + delimiter.length + 1);
  };
  const table = name => {
    const start = source.indexOf(`CREATE TABLE IF NOT EXISTS public.${name} (`);
    assert(start >= 0, `Missing repository table ${name}`);
    const end = source.indexOf(");", start);
    assert(end >= 0);
    const additions = source.match(new RegExp(`ALTER TABLE public\\.${name}\\s+ADD COLUMN IF NOT EXISTS [^;]+;`, "gi")) ?? [];
    const key = name === "stock_delta_applied" ? "movement_id" : "id";
    const primaryKey = name === "sync_idempotency_receipts" ? "" : `ALTER TABLE public.${name} ADD PRIMARY KEY(${key});`;
    return [source.slice(start, end + 2), primaryKey, ...additions].join("\n");
  };
  const tables = ["stores", "app_users", "user_roles", "terminal_tokens", "shifts", "products", "sales", "sale_items", "payment_transactions",
    "item_activity_logs", "stock_delta_applied", "sync_idempotency_receipts"];
  const routines = ["pos_sync_validate_scope", "has_role", "is_app_supervisor", "is_supervisor_now", "user_store_id",
    "store_visible", "stock_apply_delta", "sync_apply_sales", "sync_delete_sales", "sync_apply_sale_items",
    "sync_delete_sale_items", "sync_apply_payment_transactions", "sync_delete_payment_transactions",
    "sync_apply_item_activity_logs", "sync_delete_item_activity_logs", "sales_block_closing_shift", "pos_sync_push_aggregate"];
  sql(`SET client_min_messages = warning;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
    $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT auth.jwt()->>'role'$$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT (auth.jwt()->>'sub')::uuid$$;
    CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'staff');
    ${tables.map(table).join("\n")}
    CREATE UNIQUE INDEX fixture_sales_bill ON public.sales (bill_number);
    CREATE UNIQUE INDEX fixture_sales_client ON public.sales (client_transaction_id) WHERE client_transaction_id IS NOT NULL;
    ${routines.map(definition).join("\n")}
    CREATE TRIGGER sales_block_closing_shift BEFORE INSERT ON public.sales
      FOR EACH ROW EXECUTE FUNCTION public.sales_block_closing_shift();`);

  const preparation = [await read("../preparation/pos-sync-inbox-v1.sql"), await read("../preparation/pos-sync-cash-bridge-v1.sql")];
  sql(`BEGIN;\n${preparation.join("\n")}\nCOMMIT;`);
  sql(`INSERT INTO public.stores (id, code, name) VALUES (${sqlText(branch)}, ${sqlText(branch)}, 'Fixture branch');
    INSERT INTO public.terminal_tokens (id, location_id, device_name, is_claimed, claim_proof, claimed_platform)
    VALUES ('${terminal}', ${sqlText(branch)}, 'Fixture till', true, '${proof}', 'electron');
    INSERT INTO public.products (id, barcode, name, owner_store_id, selling_price, cost_price, stock_quantity, stock_by_store)
    VALUES ('${product}', 'fixture', ${sqlText(productName)}, ${sqlText(branch)}, ${sqlText(String(price))}::numeric,
      ${sqlText(String(cost))}::numeric, 14, ${sqlText(JSON.stringify({ [branch]: 10, [otherBranch]: 4 }))}::jsonb);
    INSERT INTO pos_sync_feed_v1.feed_heads (organization_id, scope_id, epoch) VALUES ('default',${sqlText(branch)},'${epoch}');`);

  const checkout = () => {
    const sale = randomUUID();
    const tender = randomUUID();
    const bill = `fixture-${sale}`;
    return {
      sale: { id: sale, bill_number: bill, client_transaction_id: sale, shift_id: shift, store_id: branch, branch_id: branch,
        subtotal_amount: "3.10", total_amount: "3.10", discount_amount: 0, tax_amount: 0, payment_type: "cash",
        points_earned: 0, points_redeemed: 0, is_exchange: false, is_refunded: false, created_at: at, paid_amount: "3.10",
        change_amount: 0, exchange_credit: 0, coupon_discount: 0, payments: [{ id: tender, method: "cash", amount: "3.10" }],
        rounding_adjustment: 0, row_version: 1 },
      item: { id: randomUUID(), sale_id: sale, product_id: product, product_name: productName, branch_id: branch,
        unit_price: "3.10", quantity: 1, discount_percent: 0, discount_amount: 0, is_return: false, created_at: at,
        tax_rate: 0, is_foc: false, coupon_discount: 0, unit_cost: 0, row_version: 1, refunded_qty: 0 },
      tender: { id: tender, source_type: "sale", sale_id: sale, store_id: branch, shift_id: shift, terminal_id: terminal,
        amount: "3.10", method: "cash", kind: "payment", note: "", paid_at: at, created_at: at, updated_at: at,
        row_version: 1, status: "completed", metadata: {} },
      movement: { id: randomUUID(), product_id: product, store_id: branch, terminal_id: terminal,
        activity_type: "sale", reference: bill, quantity_delta: -1, unit_cost: 0, note: "", created_at: at, row_version: 1 },
    };
  };
  const apply = (operation, payload, overrides = {}) => {
    const checkoutJson = overrides.checkoutJson ?? JSON.stringify(payload);
    return `SELECT pos_sync_cash_v1.apply_checkout(
      'default', ${sqlText(overrides.branch ?? branch)}, '${terminal}', ${sqlText(overrides.proof ?? proof)},
      '${overrides.installationGeneration ?? installationGeneration}', '${overrides.databaseGuid ?? databaseGuid}',
      '${operation}', '${overrides.epoch ?? epoch}', ${sqlText(checkoutJson)},
      '${overrides.checkoutSha256 ?? digest(checkoutJson)}');`;
  };
  const counts = () => sql(`SELECT (SELECT count(*) FROM sales), (SELECT count(*) FROM sale_items),
    (SELECT count(*) FROM payment_transactions), (SELECT count(*) FROM item_activity_logs),
    (SELECT count(*) FROM stock_delta_applied), (SELECT head_seq FROM pos_sync_feed_v1.feed_heads),
    (SELECT stock_by_store->>${sqlText(branch)} FROM products), (SELECT stock_by_store->>${sqlText(otherBranch)} FROM products);`);

  const first = saved ?? checkout();
  const operation = wire?.operationId ?? randomUUID();
  const checkoutJson = wire?.checkoutJson ?? JSON.stringify(first);
  if (wire) assert.equal(wire.checkoutSha256, digest(checkoutJson));
  const checkoutSha256 = wire?.checkoutSha256 ?? digest(checkoutJson);
  const firstApply = apply(operation, first, { checkoutJson, checkoutSha256 });
  const differentBytes = ` ${checkoutJson}\n`;
  const remaining = 10 - Number(first.item.quantity);
  denySql(serviceClaims + firstApply, /POS_CASH_V1_INSTALLATION_FORBIDDEN/);
  sql(`INSERT INTO pos_sync_cash_v1.installation_enrollments
    (organization_id, terminal_id, branch_id, installation_generation, database_guid)
    VALUES ('default', '${terminal}', ${sqlText(branch)}, '${installationGeneration}', '${databaseGuid}');`);
  denySql(serviceClaims + apply(operation, first, { checkoutJson, installationGeneration: randomUUID() }), /POS_CASH_V1_INSTALLATION_FORBIDDEN/);
  denySql(serviceClaims + apply(operation, first, { checkoutJson, databaseGuid: randomUUID() }), /POS_CASH_V1_INSTALLATION_FORBIDDEN/);
  denySql(serviceClaims + apply(operation, first, { checkoutJson: differentBytes, checkoutSha256 }), /POS_CASH_V1_CHECKOUT_DIGEST_MISMATCH/);
  denySql(serviceClaims + apply(operation, first, { checkoutJson, epoch: randomUUID() }), /POS_FEED_V1_SCOPE_OR_EPOCH_MISMATCH/);
  assert.equal(sql(`SELECT count(*) FROM pos_sync_inbox_v1.operation_receipts;`), "0");
  assert.equal(JSON.parse(sql(serviceClaims + firstApply)).status, "WAITING_DEPENDENCY");
  assert.equal(sql(`SELECT origin_installation_id FROM pos_sync_inbox_v1.operation_receipts WHERE operation_id = '${operation}';`), installationGeneration);
  assert.deepEqual(JSON.parse(sql(serviceClaims + apply(operation, first, { checkoutJson: differentBytes }))), { status: "INTEGRITY_CONFLICT" });
  assert.equal(counts(), "0|0|0|0|0|0|10|4");
  sql(`INSERT INTO public.shifts (id, store_id, terminal_id, status, state) VALUES ('${shift}', ${sqlText(branch)}, '${terminal}', 'OPEN','ACTIVE');`);
  const applied = JSON.parse(sql(serviceClaims + firstApply));
  assert.deepEqual(applied, { status: "APPLIED", result: { sale_id: first.sale.id, scope_id: branch, epoch, seq: "1",
    operation_id: operation, terminal_id: terminal, installation_generation: installationGeneration,
    database_guid: databaseGuid, checkout_sha256: checkoutSha256 } });
  assert.equal(counts(), `1|1|1|1|1|1|${remaining}|4`);
  assert.deepEqual(JSON.parse(sql(serviceClaims + firstApply)), { status: "ALREADY_APPLIED", result: applied.result });
  assert.deepEqual(JSON.parse(sql(serviceClaims + apply(operation, first, { checkoutJson: differentBytes }))), { status: "INTEGRITY_CONFLICT" });
  assert.deepEqual(JSON.parse(sql(serviceClaims + apply(operation, first, { checkoutJson, epoch: randomUUID() }))), { status: "INTEGRITY_CONFLICT" });
  const feed = JSON.parse(sql(`SELECT pos_sync_feed_v1.pull_groups('default',${sqlText(branch)},'${epoch}','0');`));
  assert.equal(feed.groups.length, 1);
  assert.equal(feed.groups[0].operation_id, operation);
  assert.deepEqual(feed.groups[0].changes.map(entry => entry.type), ["cash_sale", "sale_item", "cash_tender", "stock_delta"]);
  assert.equal(feed.groups[0].changes[3].row.branch_balance, remaining);

  const verifyReenrollment = () => {
    const nextGeneration = randomUUID();
    sql(`UPDATE pos_sync_cash_v1.installation_enrollments SET installation_generation = '${nextGeneration}'
      WHERE organization_id = 'default' AND terminal_id = '${terminal}';`);
    denySql(serviceClaims + firstApply, /POS_CASH_V1_INSTALLATION_FORBIDDEN/);
    assert.deepEqual(JSON.parse(sql(serviceClaims + apply(operation, first, { checkoutJson, installationGeneration: nextGeneration }))),
      { status: "INTEGRITY_CONFLICT" });
    assert.equal(counts(), `1|1|1|1|1|1|${remaining}|4`);
  };
  if (wire) {
    assert.equal(feed.groups[0].changes[2].row.id, first.tender.id);
    verifyReenrollment();
    console.log("PASS exact SQL Server cash outbox to PostgreSQL checkout, generation-bound receipt and single-effect replay");
    return;
  }
  const changed = { ...first, sale: { ...first.sale, created_at: "2026-11-07T09:01:00Z" } };
  assert.equal(JSON.parse(sql(serviceClaims + apply(operation, changed))).status, "INTEGRITY_CONFLICT");
  assert.equal(JSON.parse(sql(serviceClaims + apply(randomUUID(), first))).status, "REVIEW_REQUIRED");
  assert.equal(counts(), "1|1|1|1|1|1|9|4");

  const next = checkout();
  const nextOperation = randomUUID();
  const extraSaleField = { ...next, sale: { ...next.sale, created_by: "unsupported" } };
  const extraPaymentField = { ...next, sale: { ...next.sale, payments: [{ ...next.sale.payments[0], reference: "unsupported" }] } };
  denySql(serviceClaims + apply(nextOperation, next, { checkoutJson: "{" }), /POS_CASH_V1_INVALID_CHECKOUT/);
  denySql(serviceClaims + apply(nextOperation, extraSaleField), /POS_CASH_V1_INVALID_CHECKOUT/);
  denySql(serviceClaims + apply(nextOperation, extraPaymentField), /POS_CASH_V1_INVALID_CHECKOUT/);
  denySql(serviceClaims + apply(nextOperation, next, { proof: "b".repeat(64) }), /POS_CASH_V1_SCOPE_FORBIDDEN/);
  denySql(serviceClaims + apply(nextOperation, next, { branch: "B" }), /SYNC_TERMINAL_SCOPE_FORBIDDEN/);
  for (const role of ["anon", "authenticated", "service_role"]) {
    denySql(`SET ROLE ${role}; ${serviceClaims}${apply(nextOperation, next)}`, /permission denied/);
    denySql(`SET ROLE ${role}; SELECT * FROM pos_sync_cash_v1.installation_enrollments;`, /permission denied/);
  }
  denySql(serviceClaims + apply(nextOperation, next, { epoch: randomUUID() }), /POS_FEED_V1_SCOPE_OR_EPOCH_MISMATCH/);
  assert.equal(counts(), "1|1|1|1|1|1|9|4");
  assert.equal(sql(`SELECT count(*) FROM pos_sync_inbox_v1.operation_receipts WHERE operation_id='${nextOperation}';`), "0");
  assert.equal(sql(`SELECT count(*) FROM public.sync_idempotency_receipts WHERE batch_id='${nextOperation}';`), "0");
  sql(`CREATE SCHEMA fin62_history_preparation;
    CREATE TABLE fin62_history_preparation.streams (shift_id uuid PRIMARY KEY);
    INSERT INTO fin62_history_preparation.streams VALUES ('${shift}');`);
  denySql(serviceClaims + apply(nextOperation, next), /POS_CASH_V1_PROTECTED_SHIFT/);
  assert.equal(counts(), "1|1|1|1|1|1|9|4");
  verifyReenrollment();
  console.log("PASS isolated authoritative cash bridge (enrollment, exact digest, dependency, replay, single inventory delta and atomic rollback)");
}
