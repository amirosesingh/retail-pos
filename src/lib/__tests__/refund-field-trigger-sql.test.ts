import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const schema = readFileSync("supabase/schema.sql", "utf8");
const migration = readFileSync("supabase/migrations/20261105140417_isolate_refund_guard_table_fields.sql", "utf8");
const registry = JSON.parse(readFileSync("database/sqlserver/schema-registry.json", "utf8"));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const previousBody = "BEGIN\n  IF coalesce(current_setting('pos.refunding', true), '') = 'on' THEN\n    RETURN NEW;\n  END IF;\n  IF auth.uid() IS NULL THEN\n    RETURN NEW; -- trusted server paths (service role) do their own checks\n  END IF;\n  IF TG_TABLE_NAME = 'sale_items'\n     AND NEW.refunded_qty IS DISTINCT FROM OLD.refunded_qty THEN\n    RAISE EXCEPTION 'Refunded quantity can only be changed by processing a refund';\n  END IF;\n  IF TG_TABLE_NAME = 'sales'\n     AND coalesce(NEW.is_refunded, false) IS DISTINCT FROM coalesce(OLD.is_refunded, false) THEN\n    RAISE EXCEPTION 'A bill can only be marked refunded by processing a refund';\n  END IF;\n  RETURN NEW;\nEND;";
const previous = `CREATE OR REPLACE FUNCTION public.guard_refund_fields() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $old$${previousBody}$old$;`;
function currentFunction(name: string) {
  const start = schema.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) throw Error("Missing canonical function: " + name);
  const tail = schema.slice(start), tag = tail.match(/\bAS\s+(\$[\w]*\$)/i)?.[1];
  if (!tag) throw Error("Missing function delimiter");
  const begin = tail.indexOf(tag), end = tail.indexOf(tag + ";", begin + tag.length);
  return tail.slice(0, end + tag.length + 1);
}
let db: PGlite;
async function callSale(n: number, method = "cash", exchange: string | null = null, branch = "A") {
  const sale = { id: id(n), bill_number: "BILL-" + n, store_id: branch,
    client_transaction_id: "CLIENT-" + n, total_amount: 10, paid_amount: 10,
    payment_type: method, payments: [{ method, amount: 10 }], is_exchange: Boolean(exchange),
    original_bill_number: exchange, exchange_credit: exchange ? 10 : 0 };
  const item = { id: id(n + 1000), product_id: id(2), product_name: "Fixture", quantity: 1, unit_price: 10 };
  const payment = { id: id(n + 2000), amount: 10, method, terminal_id: "T1" };
  const movement = { id: id(n + 3000), product_id: id(2), quantity_delta: -1, activity_type: "sale" };
  return db.query("SELECT public.pos_sale_commit($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb,NULL,$5::text) AS result",
    [JSON.stringify(sale), JSON.stringify([item]), JSON.stringify([payment]), JSON.stringify([movement]), exchange]);
}
beforeAll(async () => {
  db = new PGlite(); await db.waitReady;
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE FUNCTION public.store_visible(store text) RETURNS boolean LANGUAGE sql AS $$SELECT store='A'$$;`);
  for (const name of ["sales", "sale_items", "payment_transactions", "members", "item_activity_logs", "products", "stock_delta_applied"]) {
    const table = registry.tables.find((t: { cloudTable: string }) => t.cloudTable === name);
    const columns = table.columns.map((c: { cloudColumn: string; cloudType: string; primaryKey: boolean }) =>
      `"${c.cloudColumn}" ${c.cloudType}${c.primaryKey ? " PRIMARY KEY" : ""}`);
    await db.exec(`CREATE TABLE public."${name}"(${columns.join(",")});`);
  }
  await db.exec(`ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
    CREATE POLICY fixture_branch ON public.sales TO authenticated USING(store_id='A') WITH CHECK(store_id='A');
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated,service_role;
    GRANT USAGE ON SCHEMA auth TO authenticated,service_role;`);
  for (const name of ["pos_sale_commit", "stock_apply_delta", "stock_apply_deltas"]) await db.exec(currentFunction(name));
  await db.exec(previous);
  await db.exec(`REVOKE ALL ON FUNCTION public.guard_refund_fields() FROM PUBLIC,anon,authenticated;
    GRANT EXECUTE ON FUNCTION public.guard_refund_fields() TO service_role;
    CREATE TRIGGER guard_sales_refunded BEFORE UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION public.guard_refund_fields();
    CREATE TRIGGER guard_sale_items_refunded_qty BEFORE UPDATE ON public.sale_items FOR EACH ROW EXECUTE FUNCTION public.guard_refund_fields();`);
});
beforeEach(async () => {
  await db.exec("RESET ROLE; SET request.jwt.claim.sub=''; SET pos.refunding=''; TRUNCATE sales,sale_items,payment_transactions,members,item_activity_logs,products,stock_delta_applied;");
  await db.exec(previous);
  await db.query("INSERT INTO products(id,stock_by_store,stock_quantity) VALUES($1,'{\"A\":100}',100)", [id(2)]);
  await db.query("INSERT INTO sales(id,bill_number,store_id,is_refunded) VALUES($1,'ORIGINAL','A',false)", [id(1)]);
  await db.query("INSERT INTO sale_items(id,sale_id,refunded_qty,quantity) VALUES($1,$2,0,1)", [id(3),id(1)]);
  await db.exec(`SET request.jwt.claim.sub='${id(99)}'; SET ROLE authenticated;`);
});
afterAll(async () => { await db?.close(); });

describe("shared refund trigger field isolation (actual SQL)", () => {
  it("reproduces the live 42703 through the unmodified atomic exchange checkout", async () => {
    await expect(callSale(10,"cash","ORIGINAL")).rejects.toMatchObject({ code: "42703" });
    expect((await db.query("SELECT count(*)::int n FROM sales")).rows[0]).toEqual({n:1});
    expect((await db.query("SELECT stock_quantity FROM products")).rows[0]).toMatchObject({stock_quantity:100});
  });
  for (const method of ["cash", "card", "digital", "split"]) {
    it(`commits and idempotently replays ${method} exchange payment without loosening refunds`, async () => {
      await db.exec("RESET ROLE"); await db.exec(migration); await db.exec("SET ROLE authenticated");
      await callSale(10,method,"ORIGINAL"); await callSale(10,method,"ORIGINAL");
      expect((await db.query("SELECT count(*)::int n FROM sales")).rows[0]).toEqual({n:2});
      expect((await db.query("SELECT count(*)::int n FROM payment_transactions")).rows[0]).toEqual({n:1});
      expect((await db.query("SELECT stock_quantity FROM products")).rows[0]).toMatchObject({stock_quantity:99});
      expect((await db.query("SELECT exchanged_to_bill_number FROM sales WHERE bill_number='ORIGINAL'")).rows[0]).toEqual({exchanged_to_bill_number:"BILL-10"});
      await expect(db.exec("UPDATE sales SET is_refunded=true WHERE bill_number='ORIGINAL'")).rejects.toThrow("A bill can only be marked refunded");
      await expect(db.exec("UPDATE sale_items SET refunded_qty=1")).rejects.toThrow("Refunded quantity can only be changed");
    });
  }
  it("keeps ordinary non-exchange sales and their stock accounting unchanged", async () => {
    await db.exec("RESET ROLE"); await db.exec(migration); await db.exec("SET ROLE authenticated");
    await callSale(20); await callSale(20);
    expect((await db.query("SELECT stock_quantity FROM products")).rows[0]).toMatchObject({stock_quantity:99});
    expect((await db.query("SELECT count(*)::int n FROM stock_delta_applied")).rows[0]).toEqual({n:1});
  });
  it("lets unrelated item updates run while still rejecting direct refund changes", async () => {
    await db.exec("RESET ROLE"); await db.exec(migration); await db.exec("SET ROLE authenticated");
    await db.exec("UPDATE sale_items SET product_name='Corrected'");
    await db.exec("UPDATE sales SET cashier_name='Same cashier'");
    await expect(db.exec("UPDATE sale_items SET refunded_qty=1")).rejects.toThrow("Refunded quantity can only be changed");
    await expect(db.exec("UPDATE sales SET is_refunded=true")).rejects.toThrow("A bill can only be marked refunded");
  });
  it("preserves the existing dedicated refund transaction and trusted service exits", async () => {
    await db.exec("RESET ROLE"); await db.exec(migration); await db.exec("SET ROLE authenticated");
    await db.exec("BEGIN; SET LOCAL pos.refunding='on'; UPDATE sales SET is_refunded=true; UPDATE sale_items SET refunded_qty=1; COMMIT;");
    await db.exec("SET request.jwt.claim.sub=''; SET ROLE service_role; UPDATE sales SET is_refunded=false; UPDATE sale_items SET refunded_qty=0;");
    expect((await db.query("SELECT is_refunded FROM sales")).rows[0]).toEqual({is_refunded:false});
  });
  it("does not widen the sale RPC branch authorization", async () => {
    await db.exec("RESET ROLE"); await db.exec(migration); await db.exec("SET ROLE authenticated");
    await expect(callSale(10,"cash",null,"B")).rejects.toMatchObject({code:"42501"});
    expect((await db.query("SELECT count(*)::int n FROM sales")).rows[0]).toEqual({n:1});
  });
  it("preserves function identity, trigger attachments, security configuration and execute ACL", async () => {
    await db.exec("RESET ROLE");
    const read = () => db.query("SELECT oid::text,proacl::text,prosecdef,proconfig,proowner::text FROM pg_proc WHERE oid='public.guard_refund_fields()'::regprocedure");
    const before = await read(); await db.exec(migration); await db.exec(migration);
    expect(await read()).toEqual(before);
    expect((await db.query("SELECT count(*)::int n FROM pg_trigger WHERE NOT tgisinternal AND tgfoid='public.guard_refund_fields()'::regprocedure")).rows[0]).toEqual({n:2});
    expect((await db.query("SELECT has_function_privilege('authenticated','public.guard_refund_fields()','execute') AS allowed")).rows[0]).toEqual({allowed:false});
    const proc = await db.query<{prosrc:string}>("SELECT prosrc FROM pg_proc WHERE oid='public.guard_refund_fields()'::regprocedure");
    expect(createHash("md5").update(proc.rows[0].prosrc.replace(/\r/g,"").trim()).digest("hex")).toBe("6516cdebc75f35c84b4878964913d554");
  });
  it("fails before mutation on unknown source or a disabled trigger", async () => {
    await db.exec("RESET ROLE");
    await db.exec(previous.replace("RETURN NEW; -- trusted", "RETURN NEW; -- unreviewed trusted"));
    await expect(db.exec(migration)).rejects.toThrow("REFUND_GUARD_SOURCE_REVIEW_REQUIRED"); await db.exec("ROLLBACK");
    await db.exec(previous); await db.exec("ALTER TABLE sales DISABLE TRIGGER guard_sales_refunded");
    await expect(db.exec(migration)).rejects.toThrow("REFUND_GUARD_TRIGGER_REVIEW_REQUIRED"); await db.exec("ROLLBACK");
    await db.exec("ALTER TABLE sales ENABLE TRIGGER guard_sales_refunded");
  });
  it("keeps canonical source identical to the prepared replacement", async () => {
    const a = currentFunction("guard_refund_fields").match(/AS \$\$([\s\S]*?)\$\$;/)?.[1].replace(/\r/g,"").trim();
    const b = migration.match(/AS \$guard\$([\s\S]*?)\$guard\$;/)?.[1].trim();
    expect(a).toBe(b);
  });
  it("refuses unexpected third-table attachments without changing the function", async () => {
    await db.exec("RESET ROLE; CREATE TABLE unexpected_guard_target(id integer); CREATE TRIGGER unexpected_guard BEFORE UPDATE ON unexpected_guard_target FOR EACH ROW EXECUTE FUNCTION public.guard_refund_fields();");
    await expect(db.exec(migration)).rejects.toThrow("REFUND_GUARD_TRIGGER_REVIEW_REQUIRED"); await db.exec("ROLLBACK");
    const row = await db.query<{prosrc:string}>("SELECT prosrc FROM pg_proc WHERE oid='public.guard_refund_fields()'::regprocedure");
    expect(row.rows[0].prosrc.replace(/\r/g,"").trim()).toBe(previousBody);
    await db.exec("DROP TABLE unexpected_guard_target");
  });
});
