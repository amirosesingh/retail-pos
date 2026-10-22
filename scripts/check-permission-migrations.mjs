// Isolated test setup: npm install --prefix .tmp/permission-db --no-save --ignore-scripts @electric-sql/pglite@0.5.11
// Run: node scripts/check-permission-migrations.mjs
import { PGlite } from "../.tmp/permission-db/node_modules/@electric-sql/pglite/dist/index.js";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
const admin = "00000000-0000-0000-0000-000000000001";
const manager = "00000000-0000-0000-0000-000000000002";
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    CREATE TABLE public.app_users(id uuid PRIMARY KEY, auth_user_id uuid, user_id text, email text,
      role text, role_slug text, is_active boolean, store_id text, permissions jsonb, updated_at timestamptz);
    INSERT INTO public.app_users VALUES
      ('${admin}','${admin}','admin','admin@example.test','admin','admin',true,null,'{}',now()),
      ('${manager}','${manager}','supervisor','supervisor@example.test','manager','supervisor',true,'branch-a',
        '{"can_manage_staff":true,"can_view_inventory":true,"can_adjust_stock":true}',now());`);
  for (const file of ["20261022043000_enforce_staff_permission_denials.sql", "20261022050000_global_permission_restrictions.sql"])
    await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
  const as = id => db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id]);
  const has = async flag => (await db.query("SELECT public.has_perm($1) ok", [flag])).rows[0].ok;
  const policy = keys => db.query("SELECT public.set_global_permission_restrictions($1::text[])", [keys]);
  await as(manager);
  assert.equal(await has("can_manage_staff"), true);
  assert.equal(await has("can_manage_terminals"), false, "supervisor must not bypass missing permission");
  await assert.rejects(policy(["can_manage_staff"]), /Administrator/);
  await as(admin);
  await assert.rejects(policy(["made_up_permission"]), /Invalid restriction/);
  await policy(["can_manage_staff", "page:inventory"]);
  assert.equal(await has("can_manage_staff"), true, "administrator recovery access preserved");
  await as(manager);
  assert.equal(await has("can_manage_staff"), false);
  assert.equal(await has("can_view_inventory"), false);
  await db.query("UPDATE public.app_users SET permissions=permissions || $2::jsonb WHERE id=$1", [manager, JSON.stringify({can_manage_staff:true,can_adjust_stock:false})]);
  assert.equal(await has("can_manage_staff"), false, "user grant cannot override global denial");
  const row = (await db.query("SELECT permissions,store_id FROM public.app_users WHERE id=$1",[manager])).rows[0];
  assert.equal(row.permissions.can_manage_staff, false, "replicated matrix contains the enforced denial");
  assert.equal(row.store_id, "branch-a");
  await as(admin); await policy([]); await as(manager);
  assert.equal(await has("can_manage_staff"), true, "prior grant restored after global restriction removal");
  assert.equal(await has("can_adjust_stock"), false, "individual denial retained");
  assert.equal(await has("can_view_inventory"), true);
  await db.query("UPDATE public.app_users SET is_active=false WHERE id=$1",[manager]);
  assert.equal(await has("can_manage_staff"), false, "inactive user denied");
  await db.query("UPDATE public.app_users SET is_active=true WHERE id=$1",[manager]);
  await db.exec(`ALTER TABLE public.app_users ADD COLUMN pin_hash text DEFAULT 'secret-hash';
    ALTER TABLE public.app_users ADD COLUMN offline_login_pin_hash text DEFAULT 'offline-secret';
    CREATE TABLE public.products(id integer, store_id text);
    ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
    CREATE POLICY branch_read ON public.products FOR SELECT TO authenticated USING (store_id = 'branch-a');
    INSERT INTO public.products VALUES (1,'branch-a'),(2,'branch-b');
    GRANT USAGE ON SCHEMA public,auth TO authenticated;
    GRANT SELECT ON public.products, public.app_users TO authenticated;`);
  await db.exec(await readFile(new URL("../supabase/migrations/20261022051000_restrict_business_data_reads.sql", import.meta.url),"utf8"));
  await as(manager); await db.exec("SET ROLE authenticated");
  assert.deepEqual((await db.query("SELECT id FROM public.products")).rows, [{id:1}], "existing branch restriction remains");
  await assert.rejects(db.query("SELECT pin_hash FROM public.app_users"), /permission denied/);
  await assert.rejects(db.query("SELECT offline_login_pin_hash FROM public.app_users"), /permission denied/);
  await db.query("SELECT user_id FROM public.app_users LIMIT 1");
  await db.exec("RESET ROLE"); await as(admin);
  const flags = JSON.parse(await readFile(new URL("../electron/read-permissions.json", import.meta.url), "utf8")).products;
  await policy(flags); await as(manager); await db.exec("SET ROLE authenticated");
  assert.deepEqual((await db.query("SELECT id FROM public.products")).rows, [], "unauthorized records never leave database");
  await db.exec("RESET ROLE");
  console.log("PASS: PostgreSQL global restrictions, administrator exception, supervisor limits, override rejection, restoration, branch preservation and inactive account checks");
} finally { await db.close(); }
