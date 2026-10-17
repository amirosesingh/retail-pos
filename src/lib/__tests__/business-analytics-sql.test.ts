import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table pos_settings(id int primary key,integration_settings jsonb);
    insert into pos_settings values(1,'{"timeZone":"Asia/Singapore"}');
    create table sales(id text primary key,bill_number text,store_id text,cashier_name text,created_at timestamptz,
      payment_type text,is_refunded boolean,total_amount numeric,tax_amount numeric,rounding_adjustment numeric);
    create table sale_items(id text primary key,sale_id text,product_id text,product_name text,quantity numeric,unit_price numeric,
      unit_cost numeric,is_foc boolean default false,is_return boolean default false,discount_percent numeric default 0,discount_amount numeric default 0,coupon_discount numeric default 0);
    create table products(id text primary key,category text,cost_price numeric);
    insert into products values('p','Items',40),('q','Items',10),('r','Items',0);
    insert into sales values ('one','B1','a','Cashier','2026-10-16T17:00:00Z','cash',false,84.7,7.7,0),
      ('refunded','R','a','Cashier','2026-10-17T01:00:00Z','cash',true,80,0,0),
      ('foc','F','a','Cashier','2026-10-17T02:00:00Z','cash',false,0,0,0),
      ('coupon','C','a','Cashier','2026-10-17T03:00:00Z','cash',false,72.05,0,0.05),
      ('other','O','b','Cashier','2026-10-17T04:00:00Z','cash',false,30,0,0),
      ('exchange','E','a','Cashier','2026-10-17T05:00:00Z','cash',false,40,0,0),
      ('rounded','D','a','Cashier','2026-10-17T06:00:00Z','cash',false,1,0,0);
    insert into sale_items(id,sale_id,product_id,product_name,quantity,unit_price,unit_cost,discount_percent,discount_amount,coupon_discount,is_foc) values
      ('1','one','p','Item',1,100,null,20,0,0,false),
      ('2','refunded','p','Item',1,100,40,20,0,0,false),
      ('3','foc','p','Gift',1,10,2,0,10,0,true),
      ('4','coupon','p','Item',1,100,40,20,0,10,false),
      ('5','other','p','Item',1,30,10,0,0,0,false),
      ('6','exchange','p','Item',1,100,40,20,0,0,false),
      ('7','exchange','q','Returned item',-1,40,10,0,0,0,false),
      ('8','rounded','p','Item',1,1,0,0,0,0,false),
      ('9','rounded','q','Item',1,1,0,0,0,0,false),
      ('a','rounded','r','Item',1,1,0,0,0,0,false);
    grant select on sales,sale_items,products,pos_settings to authenticated;
    alter table sales enable row level security;
    create policy branch_sales on sales to authenticated using(store_id=current_setting('test.branch',true));
    alter table sale_items enable row level security;
    create policy branch_items on sale_items to authenticated using(exists(select 1 from sales where id=sale_id));
  `);
  const schema = readFileSync("supabase/schema.sql", "utf8");
  const previous = schema.slice(schema.indexOf("-- Line-level sales facts shared by every analytics surface."));
  for (const name of ["v_sale_line_facts", "v_daily_store_sales", "v_daily_item_sales"]) {
    const definition = previous.match(new RegExp(`CREATE OR REPLACE VIEW public\\.${name}[\\s\\S]+?;`))?.[0];
    if (!definition) throw new Error(`Missing previous reporting view ${name}`);
    await db.exec(definition);
  }
  const migration = readFileSync("supabase/migrations/20261017080148_reconcile_business_analytics.sql", "utf8");
  await db.exec(migration);
  await db.exec(migration); // Safe to reapply after an interrupted deployment.

}, 30_000);
afterAll(async () => { await db?.close(); });
describe("Business Overview SQL reconciliation", () => {
  it("reconciles every completed bill's line revenue to its stored pre-tax total", async () => {
    const result = await db.query(`select s.id from sales s join v_sale_line_facts f on f.sale_id=s.id
      group by s.id having sum(f.line_revenue)<>round(s.total_amount-s.tax_amount-s.rounding_adjustment,2)`);
    expect(result.rows).toEqual([]);
  });
  it("excludes refunds and buckets by the configured trading zone", async () => {
    expect((await db.query("select * from v_sale_line_facts where sale_id='refunded'")).rows).toEqual([]);
    expect((await db.query<{business_day: string}>("select sale_day::text as business_day from v_sale_line_facts where sale_id='one'")).rows[0].business_day).toBe("2026-10-17");
  });
  it("does not count coupons twice or ignore the extra bill discount", async () => {
    const result = await db.query<{line_discount: string; line_revenue: string}>("select line_discount,line_revenue from v_sale_line_facts where sale_id='coupon'");
    expect(Number(result.rows[0].line_discount)).toBe(18);
    expect(Number(result.rows[0].line_revenue)).toBe(72);
    expect(Number((await db.query<{revenue: string}>("select line_revenue revenue from v_sale_line_facts where sale_id='one'")).rows[0].revenue)).toBe(77);
  });
  it("retains free-item costs and signed exchange credits", async () => {
    const gift = (await db.query<{line_revenue: string; line_cost: string}>("select line_revenue,line_cost from v_sale_line_facts where sale_id='foc'")).rows[0];
    expect(Number(gift.line_revenue)).toBe(0); expect(Number(gift.line_cost)).toBe(2);
    expect(Number((await db.query<{cost: string}>("select sum(line_cost) cost from v_sale_line_facts where sale_id='exchange'")).rows[0].cost)).toBe(30);
  });
  it("uses catalogue cost only for missing captured costs, preserving explicit zero costs", async () => {
    expect(Number((await db.query<{cost: string}>("select line_cost cost from v_sale_line_facts where sale_id='one'")).rows[0].cost)).toBe(40);
    expect(Number((await db.query<{cost: string}>("select sum(line_cost) cost from v_sale_line_facts where sale_id='rounded'")).rows[0].cost)).toBe(0);
  });
  it("balances allocation rounding exactly to the cent", async () => {
    expect(Number((await db.query<{revenue: string}>("select sum(line_revenue) revenue from v_sale_line_facts where sale_id='rounded'")).rows[0].revenue)).toBe(1);
  });
  it("preserves underlying branch RLS on all reporting views", async () => {
    await db.exec("set role authenticated; select set_config('test.branch','a',false);");
    try {
      for (const view of ["v_sale_line_facts","v_daily_store_sales","v_daily_item_sales"]) {
        expect((await db.query(`select * from ${view} where store_id='b'`)).rows).toEqual([]);
      }
    } finally { await db.exec("reset role"); }
  });
});
