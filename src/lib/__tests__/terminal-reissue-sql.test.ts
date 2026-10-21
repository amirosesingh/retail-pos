import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, expect, it } from "vitest";
let db: PGlite;
const oldId = "11111111-1111-4111-8111-111111111111";
const newId = "22222222-2222-4222-8222-222222222222";
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE stores(id text PRIMARY KEY); INSERT INTO stores VALUES ('branch-a'),('branch-b');
    CREATE FUNCTION has_perm(text) RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(current_setting('test.manage',true),'true')='true' $$;
    CREATE TABLE app_users(user_id text PRIMARY KEY,permissions jsonb,is_active boolean,store_id text);
    CREATE TABLE terminal_tokens(id uuid PRIMARY KEY,location_id text,location_name text,device_name text,platform text,status text,
      created_at timestamptz,reissued_at timestamptz,is_claimed boolean,expires_at timestamptz,revoked_at timestamptz,replaced_by uuid,
      management_sync_enabled boolean,management_sync_proof_hash text);
    INSERT INTO app_users VALUES ('manager','{"approval_totp_enabled":true}',true,'branch-a');
    INSERT INTO terminal_tokens(id,device_name,platform,status,location_id) VALUES ('${oldId}','Phone','mobile','revoked','branch-a');`);
  await db.exec(readFileSync("supabase/migrations/20261017121938_private_approval_tokens.sql", "utf8"));
  const migration = readFileSync("supabase/migrations/20261021013221_terminal_reissue_and_mobile_tokens.sql", "utf8");
  await db.exec(migration); await db.exec(migration);
});
afterAll(async () => { await db.close(); });
it("reissues a revoked registration atomically with the selected scope and prevents duplicate replacement", async () => {
  await db.query(`SELECT terminal_token_reissue_scoped($1,$2,NULL,'Management',true,NULL)`, [oldId,newId]);
  const row = (await db.query<{status:string;replaced_by:string}>(`SELECT status,replaced_by FROM terminal_tokens WHERE id=$1`,[oldId])).rows[0];
  expect(row).toEqual({status:'revoked',replaced_by:newId});
  const replacement = (await db.query<{location_id:null;approval_token_enabled:boolean}>(`SELECT location_id,approval_token_enabled FROM terminal_tokens WHERE id=$1`,[newId])).rows[0];
  expect(replacement).toEqual({location_id:null,approval_token_enabled:true});
  await expect(db.query(`SELECT terminal_token_reissue_scoped($1,gen_random_uuid(),'branch-b','B',true,NULL)`,[oldId])).rejects.toThrow('ALREADY_REPLACED');
});
it("filters management issuer tokens by the user's authorized branch and device switch", async () => {
  await db.query(`SELECT approval_token_state('enroll','manager',$1,$2)`,[newId,'x'.repeat(60)]);
  const read = async (branch:string) => (await db.query<{v:unknown[]}>(`SELECT approval_token_state('read_branch',$1) AS v`,[branch])).rows[0].v;
  expect(await read('branch-a')).toHaveLength(1);
  expect(await read('branch-b')).toHaveLength(0);
  await db.query(`UPDATE terminal_tokens SET approval_token_enabled=false WHERE id=$1`,[newId]);
  expect(await read('branch-a')).toHaveLength(0);
});
it("requires management permission and preserves the existing row on an unsuccessful replacement", async () => {
  await db.exec(`SET test.manage='false'`);
  await expect(db.query(`SELECT terminal_token_reissue_scoped($1,gen_random_uuid(),'branch-a','A',true,NULL)`,[newId])).rejects.toThrow('FORBIDDEN');
  await db.exec(`SET test.manage='true'`);
  await expect(db.query(`SELECT terminal_token_reissue_scoped($1,gen_random_uuid(),'missing','A',true,NULL)`,[newId])).rejects.toThrow('BRANCH_UNAVAILABLE');
  expect((await db.query<{replaced_by:null}>(`SELECT replaced_by FROM terminal_tokens WHERE id=$1`,[newId])).rows[0].replaced_by).toBeNull();
});
it("runs under caller RLS and does not grant authenticated clients access to approval secrets", async () => {
  await db.exec(`ALTER TABLE terminal_tokens ENABLE ROW LEVEL SECURITY;
    CREATE POLICY branch_only ON terminal_tokens TO authenticated USING(location_id='branch-a') WITH CHECK(location_id='branch-a');
    GRANT SELECT,INSERT,UPDATE ON terminal_tokens TO authenticated; GRANT SELECT ON stores TO authenticated;
    INSERT INTO terminal_tokens(id,device_name,platform,status,location_id) VALUES ('33333333-3333-4333-8333-333333333333','PC','pc','used','branch-a');
    SET ROLE authenticated;`);
  try {
    await expect(db.query(`SELECT terminal_token_reissue_scoped('33333333-3333-4333-8333-333333333333',gen_random_uuid(),'branch-b','B',false,NULL)`)).rejects.toThrow(/row-level security/);
    await expect(db.query(`SELECT approval_token_state('read','manager')`)).rejects.toThrow(/permission denied/);
  } finally { await db.exec('RESET ROLE'); }
});

it("includes enabled Windows management issuers without granting another branch", async () => {
 const pc = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
 await db.query(`INSERT INTO terminal_tokens(id,device_name,platform,status,location_id,approval_token_enabled) VALUES($1,'Management PC','pc','used',NULL,true)`, [pc]);
 await db.query(`SELECT approval_token_state('enroll','manager',$1,$2)`, [pc,'p'.repeat(60)]);
 const read = async (branch:string) => (await db.query<{v:{terminal_id:string}[]}>(`SELECT approval_token_state('read_branch',$1) AS v`,[branch])).rows[0].v;
 expect((await read('branch-a')).some(row => row.terminal_id === pc)).toBe(true);
 expect((await read('branch-b')).some(row => row.terminal_id === pc)).toBe(false);
 await db.query(`UPDATE terminal_tokens SET approval_token_enabled=false WHERE id=$1`, [pc]);
 expect((await read('branch-a')).some(row => row.terminal_id === pc)).toBe(false);
});

it("defaults an unset cash-drawer limit to zero without changing another rule", async () => {
 await db.exec(readFileSync("supabase/migrations/20261021020900_pos_rules_drawer_default.sql", "utf8"));
 const row = (await db.query<{rules:{max_drawer_cash_limit:number;max_cashier_discount_percent:number}}>(`SELECT pos_rules_defaults() AS rules`)).rows[0];
 expect(row.rules.max_drawer_cash_limit).toBe(0);
 expect(row.rules.max_cashier_discount_percent).toBe(10);
});
