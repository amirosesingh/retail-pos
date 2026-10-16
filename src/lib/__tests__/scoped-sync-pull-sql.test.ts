import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("preserves ordered paging, tombstones and terminal/branch isolation in PostgreSQL", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT null::uuid$$;
      CREATE TABLE public.app_users(id uuid,auth_user_id uuid,is_active boolean,role text,permissions jsonb,store_id text);
      CREATE TABLE public.terminal_tokens(id uuid,location_id text,status text,revoked_at timestamptz);
      INSERT INTO public.terminal_tokens VALUES ('11111111-1111-4111-8111-111111111111','B1','active',null),('22222222-2222-4222-8222-222222222222','B2','active',null);
      CREATE FUNCTION public.pos_sync_validate_scope(p_organization_id text,p_branch_id text,p_terminal_id text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
       IF p_organization_id <> 'default' OR NOT EXISTS(SELECT 1 FROM public.terminal_tokens WHERE id::text=p_terminal_id AND location_id=p_branch_id AND status='active' AND revoked_at IS NULL) THEN RAISE EXCEPTION 'SYNC_TERMINAL_SCOPE_FORBIDDEN';END IF;END$$;
      CREATE TABLE public.sync_change_feed(cursor bigint PRIMARY KEY,organization_id text,branch_id text,terminal_id text,table_name text,entity_id text,operation text,row_version bigint,tombstone boolean);
      SET request.jwt.claim.role='service_role';`);
    const registry = JSON.parse(
      readFileSync("database/sqlserver/schema-registry.json", "utf8"),
    ) as {
      tables: Array<{
        cloudTable: string;
        columns: Array<{ primaryKey: boolean; cloudColumn: string; cloudType: string }>;
      }>;
    };
    for (const table of registry.tables) {
      if (["app_users", "terminal_tokens"].includes(table.cloudTable)) continue;
      const fields = table.columns
        .filter((column) => column.primaryKey)
        .map((column) => `"${column.cloudColumn}" ${column.cloudType}`);
      if (table.cloudTable === "products")
        fields.push("stock_by_store jsonb", "stock_quantity numeric", "owner_store_id text");
      await db.exec(`CREATE TABLE public."${table.cloudTable}" (${fields.join(",")})`);
    }
    const canonical = readFileSync(
      "supabase/migrations/20261002200000_canonicalize_branch_identity.sql",
      "utf8",
    ).split(/update public.products\s+set/i)[0];
    await db.exec(canonical);
    await db.exec(
      `GRANT USAGE ON SCHEMA public TO authenticated; GRANT INSERT,SELECT ON public.products TO authenticated; SET ROLE authenticated;`,
    );
    await expect(
      db.exec(
        `INSERT INTO public.products(id,stock_by_store) VALUES ('11111111-1111-4111-8111-111111111111','{}')`,
      ),
    ).rejects.toThrow(/permission denied for function canonical_stock_by_store/);
    await db.exec("RESET ROLE");
    const migration = readFileSync(
      "supabase/migrations/20261016030607_repair_stock_helper_and_scoped_sync_pull.sql",
      "utf8",
    );
    await db.exec(migration);
    await db.exec(migration);
    await db.exec(
      `SET ROLE authenticated;INSERT INTO public.products(id,stock_by_store) VALUES ('11111111-1111-4111-8111-111111111111','{"A1234567-1234-4234-8234-123456789ABC":2,"a1234567-1234-4234-8234-123456789abc":3}');RESET ROLE;`,
    );
    expect(
      (
        await db.query<{ stock_quantity: number }>(
          "SELECT stock_quantity::int FROM public.products",
        )
      ).rows[0].stock_quantity,
    ).toBe(5);
    // Many other-terminal rows must not starve the visible page.
    await db.exec(`INSERT INTO public.sync_change_feed SELECT n,'default','B1','OTHER','products','{}','delete',1,true FROM generate_series(1,30000) n;
      INSERT INTO public.sync_change_feed VALUES
      (30001,'default','B1',null,'products','{}','delete',1,true),
      (30002,'default','global',null,'products','{}','delete',1,true),
      (30003,'default','B1','11111111-1111-4111-8111-111111111111','products','{}','delete',1,true),
      (30004,'default','global','11111111-1111-4111-8111-111111111111','products','{}','delete',1,true),
      (30005,'default','B2',null,'products','{}','delete',1,true),
      (30006,'foreign','B1',null,'products','{}','delete',1,true);
      INSERT INTO public.sync_change_feed SELECT n,'default','B1',null,'products','{}','delete',1,true FROM generate_series(30007,30030) n;`);
    const pull = async (after: number) =>
      (
        await db.query<{ cursor: number; tombstone: boolean }>(
          "SELECT cursor::int,tombstone FROM public.pos_sync_pull('default','B1','11111111-1111-4111-8111-111111111111',$1,10)",
          [after],
        )
      ).rows;
    const first = await pull(0);
    expect(first.map((row) => row.cursor)).toEqual([
      30001, 30002, 30003, 30004, 30007, 30008, 30009, 30010, 30011, 30012,
    ]);
    const second = await pull(first.at(-1)!.cursor);
    expect(second[0].cursor).toBe(30013);
    expect(first.every((row) => row.tombstone)).toBe(true);
    await expect(
      db.query(
        "SELECT * FROM public.pos_sync_pull('default','B2','11111111-1111-4111-8111-111111111111',0,10)",
      ),
    ).rejects.toThrow("SYNC_TERMINAL_SCOPE_FORBIDDEN");
    await db.exec("SET ROLE authenticated");
    await expect(
      db.query(
        "SELECT * FROM public.pos_sync_pull('default','B1','11111111-1111-4111-8111-111111111111',0,10)",
      ),
    ).rejects.toThrow(/permission denied/);
    await db.exec("SET ROLE anon");
    await expect(db.query("SELECT public.canonical_stock_by_store('{}')")).rejects.toThrow(
      /permission denied/,
    );
  } finally {
    await db.close();
  }
}, 30000);
