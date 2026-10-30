// Isolated PostgreSQL + pgcrypto verification. Never connects to a live database.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const migration = await readFile(new URL('../supabase/migrations/20261030075132_typed_terminal_pin_verification.sql', import.meta.url), 'utf8');
const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
function routine(name) {
  const start = schema.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = schema.indexOf('$$;', start) + 3;
  assert(start >= 0 && end > start);
  return schema.slice(start, end);
}
const db = new PGlite({ extensions: { pgcrypto } });
let passed = 0;
try {
  await db.exec(`CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TYPE app_role AS ENUM('admin','manager','staff');
    CREATE TABLE app_users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id text,login_username text,
      email text,full_name text,role app_role,store_id text,is_active boolean DEFAULT true,
      offline_login_pin_hash text, pin_hash text, last_login_at timestamptz);
    CREATE TABLE cashiers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),username text,is_active boolean DEFAULT true,
      pin_hash text,updated_at timestamptz DEFAULT now(),last_login_at timestamptz);
    CREATE TABLE pin_attempts(key text PRIMARY KEY,attempts int NOT NULL DEFAULT 0,
      window_started_at timestamptz NOT NULL DEFAULT now(),locked_until timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
    ${routine('pin_throttle_status')} ${routine('pin_throttle_fail')} ${routine('pin_throttle_reset')}
    INSERT INTO app_users(user_id,login_username,email,full_name,role,store_id,pin_hash) VALUES
      ('cashier','alias','cashier@pos.local','Fixture','staff','A',extensions.crypt('9999',extensions.gen_salt('bf',4))),
      ('external','external-alias','external@example.test','Fixture','manager',NULL,extensions.crypt('9999',extensions.gen_salt('bf',4))),
      ('missing',NULL,'missing@pos.local','Fixture','staff','A',extensions.crypt('9999',extensions.gen_salt('bf',4))),
      ('inactive',NULL,'inactive@pos.local','Fixture','staff','A',NULL);
    UPDATE app_users SET is_active=false WHERE user_id='inactive';
    UPDATE app_users SET offline_login_pin_hash=extensions.crypt('123456',extensions.gen_salt('bf',4)) WHERE user_id='external';
    INSERT INTO cashiers(username,pin_hash) VALUES('cashier',extensions.crypt('1234',extensions.gen_salt('bf',4))),
      ('external',extensions.crypt('7777',extensions.gen_salt('bf',4)));`);
  await db.exec(migration);
  const verify = async (name, pin) => (await db.query('SELECT public.verify_terminal_pin_result($1,$2) result', [name,pin])).rows[0].result;
  const attempts = async name => (await db.query('SELECT * FROM pin_attempts WHERE key=$1', [`terminal-pin:${name}`])).rows[0];
  const check = async (name, run) => { await run(); passed++; console.log(`PASS ${name}`); };
  await check('correct terminal PIN accepts canonical username, alias and case', async () => {
    for (const name of ['cashier','ALIAS','cashier@pos.local']) {
      const result = await verify(name,'1234');
      assert.equal(result.status,'verified'); assert.equal(result.account.user_id,'cashier');
      assert(!('pin_hash' in result.account)); assert.equal(result.account.store_id,'A');
    }
  });
  await check('real email uses offline sign-in hash, never approval or legacy cashier hash', async () => {
    assert.equal((await verify('external','123456')).status,'verified');
    assert.equal((await verify('external','9999')).status,'invalid');
    assert.equal((await verify('external','7777')).status,'invalid');
    assert.equal((await verify('external-alias','123456')).status,'verified');
    assert.equal(await attempts('external'),undefined);
  });
  await check('missing sign-in hash does not count or clear prior attempts', async () => {
    await db.exec("INSERT INTO pin_attempts(key,attempts) VALUES('terminal-pin:missing',2)");
    assert.equal((await verify('missing','9999')).status,'credential_unavailable');
    assert.equal((await attempts('missing')).attempts,2);
  });
  await check('inactive accounts report inactive without PIN comparison', async () => {
    assert.equal((await verify('inactive','1234')).status,'account_inactive');
    assert.equal(await attempts('inactive'),undefined);
  });
  await check('wrong PIN shares canonical lock across aliases and lock blocks correct PIN', async () => {
    for (let i=0;i<5;i++) assert.equal((await verify(i%2?'alias':'cashier','0000')).status,'invalid');
    const before = await attempts('cashier'); assert(before.locked_until);
    const result = await verify('alias','1234'); assert.equal(result.status,'locked');
    assert.equal((await attempts('cashier')).attempts,before.attempts);
    assert.equal(new Date((await attempts('cashier')).locked_until).getTime(),new Date(before.locked_until).getTime());
  });
  await check('expired lock permits valid PIN and clears failures', async () => {
    await db.exec("UPDATE pin_attempts SET locked_until=now()-interval '1 second' WHERE key='terminal-pin:cashier'");
    assert.equal((await verify('cashier','1234')).status,'verified');
    assert.equal(await attempts('cashier'),undefined);
  });
  await check('unknown identifiers are denied and retain durable guessing protection', async () => {
    assert.equal((await verify('unknown','1234')).status,'invalid');
    assert.equal((await attempts('unknown')).attempts,1);
  });
  await check('malformed stored verifier is unavailable, not an incorrect attempt', async () => {
    await db.exec("INSERT INTO cashiers(username,pin_hash) VALUES('missing','not-a-bcrypt-hash')");
    assert.equal((await verify('missing','1234')).status,'credential_unavailable');
    assert.equal((await attempts('missing')).attempts,2);
  });
  await check('unsupported bcrypt prefixes do not become wrong-PIN attempts', async () => {
    const original = (await db.query("SELECT pin_hash FROM cashiers WHERE username='cashier'")).rows[0].pin_hash;
    for (const prefix of ['$2b$','$2y$']) {
      await db.query("UPDATE cashiers SET pin_hash=$1 WHERE username='cashier'", [prefix+original.slice(4)]);
      assert.equal((await verify('cashier','1234')).status,'credential_unavailable',prefix);
      assert.equal(await attempts('cashier'),undefined);
    }
    await db.query("UPDATE cashiers SET pin_hash=$1 WHERE username='cashier'", [original]);
    assert.equal((await verify('cashier','1234')).status,'verified');
  });
  await check('invalid input does not consume a PIN comparison attempt', async () => {
    assert.equal((await verify('cashier','1')).status,'invalid_input');
    assert.equal(await attempts('cashier'),undefined);
  });
  await check('anon and authenticated cannot execute private verifier; service role can', async () => {
    for (const role of ['anon','authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(verify('cashier','1234'), /permission denied/);
      await db.exec('RESET ROLE');
    }
    await db.exec('SET ROLE service_role');
    assert.equal((await verify('cashier','1234')).status,'verified');
    await db.exec('RESET ROLE');
  });
  console.log(`${passed} isolated terminal PIN result scenarios passed`);
} finally { await db.close(); }
