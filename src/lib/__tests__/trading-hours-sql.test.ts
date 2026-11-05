import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const migration = readFileSync("supabase/migrations/20261105170645_bounded_shop_hourly_report.sql", "utf8");
const schema = readFileSync("supabase/schema.sql", "utf8");
let db: PGlite;
const envelope = async (from = "2026-11-01", to = from, stores: (string | null)[] | null = ["A"]) =>
  (await db.query<{ envelope: { rows: Record<string, unknown>[]; row_count: number; complete: boolean; from: string; to: string; store_ids: string[] } }>("SELECT public.pos_report_store_hours($1::date,$2::date,$3::text[]) AS envelope", [from, to, stores])).rows[0]!.envelope;
const call = async (from = "2026-11-01", to = from, stores: (string | null)[] | null = ["A"]) =>
  (await envelope(from, to, stores)).rows.map(row => ({ ...row, bills: Number(row.bills), revenue: Number(row.revenue), cost: Number(row.cost), profit: Number(row.profit) }));
beforeAll(async () => {
  db = new PGlite(); await db.waitReady;
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE public.stores(id text PRIMARY KEY); INSERT INTO stores VALUES('A'),('B');
    CREATE TABLE public.pos_settings(id integer PRIMARY KEY,integration_settings jsonb);
    CREATE TABLE public.products(id text PRIMARY KEY,cost_price numeric);
    CREATE TABLE public.sales(id text PRIMARY KEY,store_id text,created_at timestamptz,total_amount numeric,tax_amount numeric,rounding_adjustment numeric,is_refunded boolean);
    CREATE TABLE public.sale_items(id text PRIMARY KEY,sale_id text,product_id text,quantity numeric,unit_cost numeric);
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;`);
  await db.exec(migration);
});
beforeEach(async () => {
  await db.exec(`RESET ROLE; TRUNCATE pos_settings,products,sales,sale_items;
    INSERT INTO pos_settings VALUES(1,'{"timeZone":"Asia/Brunei"}');
    INSERT INTO products VALUES('p',40); SET ROLE service_role;`);
});
afterAll(async () => { await db?.close(); });
describe("service-only bounded hourly report (actual PostgreSQL SQL)", () => {
  it("uses the same canonical source and never adds financial writes or replacement grants", async () => {
    const body = migration.slice(migration.indexOf("CREATE FUNCTION public.pos_report_store_hours"));
    expect(schema.replaceAll("\r\n", "\n")).toContain(body.trim());
    expect(migration).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE POLICY|SECURITY DEFINER)\b/i);
    expect(await call()).toEqual([]);
  });
  for (const zone of ["Asia/Brunei", "UTC", "America/New_York", "Invalid/Zone"]) {
    it(`uses the saved business timezone and exact date window (${zone})`, async () => {
      await db.exec(`RESET ROLE; UPDATE pos_settings SET integration_settings=jsonb_build_object('timeZone','${zone}');
        INSERT INTO sales VALUES('s','A','2026-11-01T00:30:00Z',98.95,9,-0.05,false);
        INSERT INTO sale_items VALUES('i','s','p',1,40); SET ROLE service_role;`);
      const rows = await call("2026-10-31", "2026-11-01");
      const hour = zone === "Asia/Brunei" ? 8 : zone === "America/New_York" ? 20 : 0;
      expect(rows).toEqual([{ store_id: "A", hour, bills: 1, revenue: 90.00, cost: 40.00, profit: 50.00 }]);
      if (zone === "America/New_York") expect(await call()).toEqual([]);
    });
  }
  it("preserves signed exchange/FOC/captured-zero costs, excludes refunded bills and foreign branches", async () => {
    await db.exec(`RESET ROLE;
      INSERT INTO sales VALUES('normal','A','2026-11-01T00:01Z',90,0,0,false),('return','A','2026-11-01T00:02Z',-20,0,0,false),
      ('free','A','2026-11-01T00:03Z',0,0,0,false),('zero','A','2026-11-01T00:04Z',10,0,0,false),
      ('refunded','A','2026-11-01T00:05Z',999,0,0,true),('foreign','B','2026-11-01T00:05Z',999,0,0,false),
      ('before','A','2026-10-31T15:59:59.999999Z',999,0,0,false),('after','A','2026-11-01T16:00Z',999,0,0,false);
      INSERT INTO sale_items VALUES('i1','normal','p',1,40),('i2','return','p',-1,10),('i3','free','p',1,5),('i4','zero','p',1,0),
      ('i5','refunded','p',1,1),('i6','foreign','p',1,1); SET ROLE service_role;`);
    expect(await call()).toEqual([{ store_id: "A", hour: 8, bills: 4, revenue: 80.00, cost: 35.00, profit: 45.00 }]);
    expect(await call("2026-11-01", "2026-11-01", ["A", "A"])).toHaveLength(1);
    expect(await call("2026-11-01", "2026-11-01", ["A", "B"])).toHaveLength(2);
  });
  it("keeps captured cost precedence and the existing line-level two-decimal cost rounding", async () => {
    await db.exec(`RESET ROLE; INSERT INTO sales VALUES('s','A','2026-11-01T00:00Z',10.01,0,0,false);
      INSERT INTO sale_items VALUES('i1','s','p',1,1.005),('i2','s','p',-1,0.005),('i3','s','p',1,NULL); SET ROLE service_role;`);
    expect(await call()).toEqual([{ store_id: "A", hour: 8, bills: 1, revenue: 10.01, cost: 41.00, profit: -30.99 }]);
  });
  it("keeps zero-line bills as actual transactions with zero known cost", async () => {
    await db.exec(`RESET ROLE; INSERT INTO sales VALUES('s','A','2026-11-01T00:00Z',10,0,0,false); SET ROLE service_role;`);
    expect(await call()).toEqual([{ store_id: "A", hour: 8, bills: 1, revenue: 10.00, cost: 0.00, profit: 10.00 }]);
  });
  for (const stores of [[], ["missing"], [null], [""], Array(101).fill("A"), null]) {
    it(`rejects invalid branch bounds ${JSON.stringify(stores)}`, async () => {
      await expect(call("2026-11-01", "2026-11-01", stores)).rejects.toThrow("bounded date range");
    });
  }
  for (const dates of [["2026-11-02", "2026-11-01"], ["2000-01-01", "2026-11-01"], ["-infinity", "2026-11-01"], ["2026-11-01", "infinity"]]) {
    it(`rejects invalid/unbounded date interval ${dates.join("/")}`, async () => {
      await expect(call(dates[0], dates[1])).rejects.toThrow("bounded date range");
    });
  }
  for (const role of ["anon", "authenticated"]) {
    it(`denies direct ${role} access even with a guessed branch`, async () => {
      await db.exec(`RESET ROLE; SET ROLE ${role};`);
      await expect(call()).rejects.toThrow("permission denied");
    });
  }
  it("returns one complete scalar envelope for 1008 hourly groups, beyond the REST row cap", async () => {
    await db.exec(`RESET ROLE; INSERT INTO stores SELECT 'shop-'||n FROM generate_series(0,41) n ON CONFLICT DO NOTHING;
      INSERT INTO sales SELECT 'bulk-'||n||'-'||h,'shop-'||n,'2026-10-31T16:00Z'::timestamptz+h*interval '1 hour',10,0,0,false
        FROM generate_series(0,41) n CROSS JOIN generate_series(0,23) h; SET ROLE service_role;`);
    const stores = Array.from({ length: 42 }, (_, n) => `shop-${n}`), result = await envelope("2026-11-01", "2026-11-01", stores);
    expect(result.row_count).toBe(1008); expect(result.rows).toHaveLength(1008); expect(result.complete).toBe(true);
    expect(result.store_ids).toEqual(stores); expect(result.from).toBe("2026-11-01"); expect(result.to).toBe("2026-11-01");
  });
  it("aborts an unknown existing-routine collision rather than replacing it", async () => {
    await db.exec("RESET ROLE");
    await expect(db.exec(migration)).rejects.toThrow("already exists");
  });
});
