import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("reserves cloud numbers against existing documents and denies branch and client-role access", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS
      $$SELECT current_setting('request.jwt.claim.role',true)$$;
      CREATE TABLE public.stores(id text PRIMARY KEY);
      INSERT INTO public.stores VALUES ('B1'),('B2'),('A1234567-1234-4234-8234-123456789ABC');
      CREATE TABLE public.stock_count_drafts(reference text);
      CREATE TABLE public.purchase_orders(reference text);
      CREATE TABLE public.stock_transfers(ref text);
      INSERT INTO public.stock_count_drafts VALUES ('SC-B1-0001');
      INSERT INTO public.purchase_orders VALUES ('SC-B1-0041');
      INSERT INTO public.stock_transfers VALUES ('SC-B1-0060');
      SET request.jwt.claim.role='service_role';`);
    const migration = readFileSync(
      "supabase/migrations/20261015120141_reserve_cloud_stock_document_numbers.sql",
      "utf8",
    );
    await db.exec(migration);
    await db.exec(migration);
    const reserve = async (prefix = "SC-B1", branch = "B1", minimum = 1) => {
      const result = await db.query<{ n: number }>(
        "SELECT public.reserve_stock_document_number($1,$2,$3)::int AS n",
        [prefix, minimum, branch],
      );
      return result.rows[0].n;
    };
    expect(await reserve("SC-UUID", "a1234567-1234-4234-8234-123456789abc")).toBe(1);
    expect(await reserve("SC-UUID", "A1234567-1234-4234-8234-123456789ABC")).toBe(2);
    await expect(reserve("SC-BAD", "b1")).rejects.toThrow("STOCK_NUMBER_REQUEST_INVALID");
    expect(await reserve()).toBe(61);
    expect(await reserve()).toBe(62);
    await expect(reserve("SC-B1", "B2")).rejects.toThrow("STOCK_NUMBER_BRANCH_FORBIDDEN");
    expect(await reserve()).toBe(63);
    expect(await reserve("SC-B2", "B2", 500)).toBe(500);
    expect(await reserve("SC-B2", "B2")).toBe(501);
    expect(new Set(await Promise.all(Array.from({ length: 10 }, () => reserve()))).size).toBe(10);
    await db.exec("SET request.jwt.claim.role='anon'");
    await expect(reserve()).rejects.toThrow("STOCK_NUMBER_SERVICE_REQUIRED");
    await db.exec("SET request.jwt.claim.role='service_role'; SET ROLE authenticated");
    await expect(reserve()).rejects.toThrow(/permission denied/);
    await expect(db.query("SELECT * FROM private.stock_document_counters")).rejects.toThrow(
      /permission denied/,
    );
  } finally {
    await db.close();
  }
}, 30000);
