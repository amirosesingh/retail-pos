// Isolated PostgreSQL execution only. Never opens a live database connection.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const schema = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20261029073121_add_missed_bill_historical_entry.sql", import.meta.url), "utf8");
const table = name => {
  const start = schema.indexOf(`CREATE TABLE IF NOT EXISTS public.${name} (`);
  assert(start >= 0, name);
  return schema.slice(start, schema.indexOf("\n);", start) + 3);
};
const productId = "11111111-1111-4111-8111-111111111111";
const shiftId = "22222222-2222-4222-8222-222222222222";
const key = "33333333-3333-4333-8333-333333333333";
const now = new Date(); const occurred = new Date(now.getTime() - 86400000).toISOString();
const entry = overrides => ({ storeId: "a", clientKey: key, originalReference: "paper-12", occurredAt: occurred,
  cashierId: "cashier", originalShiftId: shiftId, reason: "Original paper sale omitted", stockHandling: "already_corrected",
  stockReason: "Count already corrected", items: [{ productId, quantity: 2, unitPrice: 10, unitCost: 4, discountAmount: 2, taxAmount: 1.08 }],
  payments: [{ method: "cash", amount: 10 }, { method: "card", amount: 9.08 }], ...overrides });
let passed = 0;
async function fixture() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TYPE public.app_role AS ENUM('admin','staff','manager');
    ${table("app_users")}${table("stores")}${table("shifts")}${table("sales")}${table("sale_items")}${table("payment_transactions")}
    ALTER TABLE sales ADD PRIMARY KEY(id); ALTER TABLE stores ADD PRIMARY KEY(id); ALTER TABLE shifts ADD PRIMARY KEY(id);
    ALTER TABLE stores ADD COLUMN IF NOT EXISTS deleted_at timestamptz; ALTER TABLE stores ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
    ALTER TABLE sale_items ADD COLUMN branch_id text;
    CREATE TABLE products(id uuid PRIMARY KEY,name text,owner_store_id text,deleted_at timestamptz,stock_by_store jsonb,stock_quantity numeric);
    CREATE TABLE terminal_tokens(id uuid,location_id text,status text,revoked_at timestamptz);
    CREATE TABLE pos_store_settings(store_id text PRIMARY KEY,prevent_negative_stock_sale boolean);
    CREATE TABLE stock_delta_applied(movement_id uuid PRIMARY KEY,product_id uuid,store_id text,delta int);
    CREATE TABLE item_activity_logs(id uuid PRIMARY KEY,product_id uuid,store_id text,activity_type text,reference text,quantity_delta int,staff_name text,note text);
    ${table("record_edits")}
    CREATE FUNCTION product_available_in_catalogue(pid uuid,branch text) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT EXISTS(SELECT 1 FROM products WHERE id=pid AND owner_store_id=branch AND deleted_at IS NULL) $$;
    CREATE FUNCTION stock_apply_delta(mid uuid,pid uuid,branch text,change int) RETURNS integer LANGUAGE plpgsql AS $$
    BEGIN INSERT INTO stock_delta_applied VALUES(mid,pid,branch,change) ON CONFLICT DO NOTHING;
      IF FOUND THEN UPDATE products SET stock_by_store=jsonb_set(stock_by_store,ARRAY[branch],to_jsonb((stock_by_store->>branch)::int+change)),stock_quantity=stock_quantity+change WHERE id=pid; END IF;
      RETURN (SELECT (stock_by_store->>branch)::int FROM products WHERE id=pid); END $$;
    CREATE FUNCTION guard_fixture_shift() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.shift_id IS NOT NULL THEN RAISE EXCEPTION 'Historical entry must not post to any drawer'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER guard_fixture_shift BEFORE INSERT ON sales FOR EACH ROW EXECUTE FUNCTION guard_fixture_shift();
    INSERT INTO app_users(user_id,full_name,email,role,role_slug,store_id) VALUES
      ('admin','Admin','admin@example.test','admin','admin',NULL),('cashier','Cashier','cashier@example.test','staff','cashier','a'),('staff','Staff','staff@example.test','staff','cashier','a');
    INSERT INTO stores(id,code,name) VALUES('a','A','Branch A'),('b','B','Branch B');
    INSERT INTO shifts(id,store_id,opened_at,closed_at,status) VALUES('${shiftId}','a','2000-01-01Z',now(),'CLOSED');
    INSERT INTO products VALUES('${productId}','Product','a',NULL,'{"a":5,"b":9}',14);
    INSERT INTO pos_store_settings VALUES('',false),('a',true);`);
  await db.exec(migration);
  return db;
}
const save = (db, payload, actor = "admin", terminal = null) => db.query("SELECT pos_admin_add_missed_bill($1::jsonb,$2,$3) result", [JSON.stringify(payload), actor, terminal]);
async function test(name, run) { const db = await fixture(); try { await run(db); passed++; console.log(`PASS ${name}`); } finally { await db.close(); } }

await test("already-corrected stock, original payment date, no drawer and exact line totals", async db => {
  const { rows } = await save(db, entry()); const result = rows[0].result;
  assert.equal(result.receiptNo, `MB-${key}`); assert.equal(result.items.length, 1);
  const sale = (await db.query("select * from sales")).rows[0];
  assert.equal(sale.shift_id, null); assert.equal(sale.total_amount, "19.08"); assert.equal(sale.discount_amount, "2"); assert.equal(sale.tax_amount, "1.08");
  assert.equal(new Date(sale.created_at).toISOString(), occurred);
  assert.equal((await db.query("select stock_by_store from products")).rows[0].stock_by_store.a, 5);
  assert.equal((await db.query("select count(*)::int count from stock_delta_applied")).rows[0].count, 0);
  const payments = (await db.query("select * from payment_transactions")).rows;
  assert.equal(payments.length, 2); assert(payments.every(p => p.shift_id === null && new Date(p.paid_at).toISOString() === occurred && new Date(p.created_at).toISOString() === occurred));
  const item = result.items[0]; assert.equal(Number(item.discount_amount), 1); assert.equal(Number(item.tax_rate), 0.06);
  assert.equal((await db.query("select original_shift_id::text id from missed_bill_entries")).rows[0].id, shiftId);
  assert.equal((await db.query("select count(*)::int count from record_edits")).rows[0].count, 1);
});
await test("deduct once and exact retry returns same persisted bill", async db => {
  const payload = entry({ stockHandling: "deduct" }); await save(db, payload); await save(db, payload);
  assert.deepEqual((await db.query("select stock_by_store from products")).rows[0].stock_by_store, { a: 3, b: 9 });
  for (const table of ["sales","missed_bill_entries","record_edits","stock_delta_applied"]) assert.equal((await db.query(`select count(*)::int count from ${table}`)).rows[0].count, 1);
  await assert.rejects(save(db, entry({ stockHandling: "deduct", reason: "Different reason" })), /retry key/);
});
await test("fractional per-unit discount keeps the full three-unit historical line totals", async db => {
  const payload = entry({ items: [{ productId, quantity: 3, unitPrice: 10, unitCost: 4, discountAmount: 1, taxAmount: 1.74 }], payments: [{method:"cash",amount:30.74}] });
  const result = (await save(db,payload)).rows[0].result;
  assert.equal(Number(result.sale.total_amount),30.74);
  assert.equal(Number(result.sale.discount_amount),1);
  const line = result.items[0];
  assert.equal(Math.round(Number(line.discount_amount)*line.quantity*100)/100,1);
  assert.equal(Math.round((Number(line.unit_price)*line.quantity-Number(line.discount_amount)*line.quantity)*Number(line.tax_rate)*100)/100,1.74);
});
await test("failure after header and stock work rolls the whole operation back", async db => {
  await db.exec(`CREATE FUNCTION reject_missed_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture ledger unavailable'; END $$;
    CREATE TRIGGER reject_missed_ledger BEFORE INSERT ON payment_transactions FOR EACH ROW EXECUTE FUNCTION reject_missed_ledger();`);
  await assert.rejects(save(db,entry({stockHandling:"deduct"})),/ledger unavailable/);
  for (const table of ["sales","sale_items","missed_bill_entries","record_edits","stock_delta_applied","item_activity_logs"]) assert.equal((await db.query(`select count(*)::int count from ${table}`)).rows[0].count,0);
  assert.deepEqual((await db.query("select stock_by_store from products")).rows[0].stock_by_store,{a:5,b:9});
});
await test("nonadmin cannot use service endpoint and branch-bound admin cannot widen scope", async db => {
  await assert.rejects(save(db, entry(), "staff"), /administrator/);
  await db.query("update app_users set store_id='b' where user_id='admin'");
  await assert.rejects(save(db, entry()), /another branch/);
  assert.equal((await db.query("select count(*)::int count from sales")).rows[0].count,0);
});
await test("normal terminal branch restriction is checked independently", async db => {
  const terminal = "44444444-4444-4444-8444-444444444444";
  await db.query("insert into terminal_tokens values($1,'b','active',NULL)",[terminal]);
  await assert.rejects(save(db, entry(),"admin",terminal), /Terminal branch/);
});
await test("stock prevention and foreign catalogue product fail atomically", async db => {
  await assert.rejects(save(db,entry({stockHandling:"deduct",items:[{productId,quantity:6,unitPrice:1,unitCost:1,discountAmount:0,taxAmount:0}],payments:[{method:"cash",amount:6}]})),/Insufficient branch stock/);
  await db.query("update products set owner_store_id='b'"); await assert.rejects(save(db,entry()),/cluster catalogue/);
  assert.equal((await db.query("select count(*)::int count from sales")).rows[0].count,0);
});
await test("negative stock policy off permits explicit once-only deduction", async db => {
  await db.query("update pos_store_settings set prevent_negative_stock_sale=false where store_id='a'");
  await save(db,entry({stockHandling:"deduct",items:[{productId,quantity:6,unitPrice:1,unitCost:1,discountAmount:0,taxAmount:0}],payments:[{method:"cash",amount:6}]}));
  assert.equal((await db.query("select stock_by_store from products")).rows[0].stock_by_store.a,-1);
});
await test("received tender mismatch, future dates and wrong original shifts rejected", async db => {
  await assert.rejects(save(db,entry({payments:[{method:"cash",amount:19}]})),/must equal/);
  await assert.rejects(save(db,entry({occurredAt:"2100-01-01T00:00:00Z"})),/past sale date/);
  await assert.rejects(save(db,entry({originalShiftId:"55555555-5555-4555-8555-555555555555"})),/Original shift/);
  await assert.rejects(save(db,entry({items:[{productId,quantity:1,unitPrice:10,unitCost:4,discountAmount:10,taxAmount:1}],payments:[{method:"cash",amount:1}]})),/Check historical/);
});
await test("duplicate paper references cannot create a second sale", async db => {
  await save(db,entry());
  await assert.rejects(save(db,entry({clientKey:"66666666-6666-4666-8666-666666666666"})),/already recorded/);
  assert.equal((await db.query("select count(*)::int count from sales")).rows[0].count,1);
});
await test("direct authenticated SQL has no access to privileged write routine", async db => {
  await db.exec("SET ROLE authenticated");
  await assert.rejects(save(db,entry()),/permission denied/);
  await db.exec("RESET ROLE");
});
console.log(`${passed} isolated missed-bill cases passed. No live database accessed.`);
