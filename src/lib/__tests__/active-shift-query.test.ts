import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
const migration = readFileSync("supabase/migrations/20261025003332_optimize_active_shift_lookup.sql", "utf8").replace(/\r\n/g, "\n");
const original = readFileSync("supabase/migrations/20261023110839_optimize_shift_permission_checks.sql", "utf8");
it("preserves every original financial mask and authority check before applying the open-shift predicate", () => {
  const body = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION"), migration.indexOf("$$;") + 3)
    .replace("private.shift_active_secure_impl(p_store_id text)", "private.shift_list_secure_impl(\n  p_store_id text DEFAULT NULL,\n  p_limit integer DEFAULT 300\n)")
    .replace("RETURNS jsonb", "RETURNS SETOF jsonb")
    .replace("    AND s.status = 'OPEN' AND s.closed_at IS NULL\n", "")
    .replace("  LIMIT 1;", "  LIMIT LEAST(GREATEST(COALESCE(p_limit, 300), 1), 1000);");
  expect(body.trim()).toBe(original.slice(original.indexOf("CREATE OR REPLACE FUNCTION")).trim().replace(/\r\n/g, "\n"));
});
it("finds an old open shift without projecting history and preserves masking, branch and active-account checks", async () => {
  const db = new PGlite();
  try {
    const financial = [...new Set([...migration.matchAll(/THEN s\.([a-z_]+)/g)].map(match => match[1]))];
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA private; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-0000-0000-000000000001'::uuid $$;
      CREATE FUNCTION public.is_staff(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('test.staff')::boolean $$;
      CREATE FUNCTION public.is_terminal_active() RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('test.active')::boolean $$;
      CREATE FUNCTION public.store_visible(text) RETURNS boolean LANGUAGE sql AS $$ SELECT $1 = current_setting('test.branch') $$;
      CREATE FUNCTION public.has_perm(text) RETURNS boolean LANGUAGE sql AS $$ SELECT $1 = ANY(string_to_array(current_setting('test.permissions'),',')) $$;
      CREATE TABLE public.shifts(id text PRIMARY KEY, store_id text, status text, opened_at timestamptz, closed_at timestamptz,
        ${financial.map(field => `${field} ${field === 'variance_status' ? 'text' : 'numeric'}`).join(',')});
      INSERT INTO public.shifts(id,store_id,status,opened_at,closed_at)
        SELECT 'closed-'||g,'a','CLOSED',now()-g*interval '1 minute',now() FROM generate_series(1,1200) g;
      INSERT INTO public.shifts(id,store_id,status,opened_at,opening_float,counted_cash,variance_cash)
        VALUES ('old-open','a','OPEN',now()-interval '2 days',100,90,-10),('other-branch','b','OPEN',now(),100,90,-10);
      SET test.staff='true'; SET test.active='true'; SET test.branch='a'; SET test.permissions='';`);
    await db.exec(migration);
    let row = (await db.query<{ row: Record<string, unknown> }>("SELECT public.shift_active_secure('a') AS row")).rows[0].row;
    expect(row.id).toBe("old-open");
    expect(row.opening_float).toBeNull(); expect(row.counted_cash).toBeNull(); expect(row.variance_cash).toBeNull();
    await db.exec("INSERT INTO public.shifts(id,store_id,status,opened_at) VALUES ('latest-open','a','OPEN',now())");
    expect((await db.query<{ row: Record<string, unknown> }>("SELECT public.shift_active_secure('a') AS row")).rows[0].row.id).toBe("latest-open");
    await db.exec("UPDATE public.shifts SET closed_at=now() WHERE id='latest-open'");
    expect((await db.query<{ row: Record<string, unknown> }>("SELECT public.shift_active_secure('a') AS row")).rows[0].row.id).toBe("old-open");
    await db.exec("SET test.permissions='can_shift_counted_cash_view'");
    row = (await db.query<{ row: Record<string, unknown> }>("SELECT public.shift_active_secure('a') AS row")).rows[0].row;
    expect(Number(row.counted_cash)).toBe(90); expect(row.opening_float).toBeNull(); expect(row.variance_cash).toBeNull();
    expect((await db.query<{ row: unknown }>("SELECT public.shift_active_secure('b') AS row")).rows[0].row).toBeNull();
    await db.exec("SET test.active='false'");
    expect((await db.query<{ row: unknown }>("SELECT public.shift_active_secure('a') AS row")).rows[0].row).toBeNull();
    await db.exec("SET test.active='true'; SET test.staff='false'");
    expect((await db.query<{ row: unknown }>("SELECT public.shift_active_secure('a') AS row")).rows[0].row).toBeNull();
    await db.exec("SET ROLE anon");
    await expect(db.query("SELECT public.shift_active_secure('a')")).rejects.toThrow(/permission denied/);
  } finally { await db.close(); }
});
