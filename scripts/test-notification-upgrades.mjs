// Disposable in-memory PostgreSQL only; no profiles, credentials or network calls.
import { PGlite } from "@electric-sql/pglite";
import { readFile, mkdtemp, mkdir, copyFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const schema = await read("supabase/schema.sql");
const personal = await read("supabase/migrations/20261025141638_personal_notification_acknowledgements.sql");
const correctionName = "20261030234813_guard_activity_acknowledgement_branch_ownership.sql";
const correction = await read(`supabase/migrations/${correctionName}`);
const baselineOnly = process.argv.includes("--baseline");
const token = await read("supabase/migrations/20261025133911_soft_token_owner_admin_notification_rule.sql");
const bases = await Promise.all([
  "20261023141539_soft_token_approval_notifications.sql",
  "20261024095724_notification_rule_table.sql",
  "20261024110442_notification_legacy_mode_guard.sql",
  "20261024113812_notification_rule_activation_compatibility.sql",
].map(name => read(`supabase/migrations/${name}`)));
const fn = name => {
  const start = schema.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert(start >= 0, name);
  const delimiter = schema.slice(start).match(/\bAS\s+(\$[\w]*\$)/i)?.[1];
  assert(delimiter, name);
  const begin = schema.indexOf(delimiter, start);
  const end = schema.indexOf(`${delimiter};`, begin + delimiter.length);
  assert(end > begin, name);
  return schema.slice(start, end + delimiter.length + 1);
};
const table = name => {
  const start = schema.indexOf(`CREATE TABLE IF NOT EXISTS public.${name} (`);
  assert(start >= 0, name);
  return schema.slice(start, schema.indexOf("\n);", start) + 3);
};
const db = new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.auth_role',true) $$;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
  CREATE TABLE pos_settings(id int PRIMARY KEY,notification_settings jsonb);
  CREATE TABLE app_users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id text,role text,role_slug text,
    store_id text,is_active boolean DEFAULT true,permissions jsonb DEFAULT '{}',auth_user_id uuid);
  INSERT INTO app_users(user_id,role,role_slug,store_id,is_active) VALUES
    ('manager-a','staff','supervisor','a',true),('manager-b','staff','supervisor','b',true),
    ('admin-a','admin','admin',NULL,true),('admin-custom','admin','owner','b',true),
    ('disabled-admin','admin','admin',NULL,false),('other-manager','staff','supervisor','a',true),
    ('cashier','staff','cashier','a',true),('terminal-a','staff','cashier','a',true);
  CREATE TABLE stores(id text PRIMARY KEY,name text); INSERT INTO stores VALUES('a','Branch A'),('b','Branch B');
  ${table("activity_events")}
  ALTER TABLE activity_events ADD PRIMARY KEY(id),ADD UNIQUE(client_event_id),
    ADD COLUMN cleared_by text[] DEFAULT '{}',ADD COLUMN previous_state jsonb,ADD COLUMN new_state jsonb,ADD COLUMN branch_id text;
  ${fn("activity_events_immutable")}
  CREATE TRIGGER activity_events_no_update BEFORE UPDATE OR DELETE ON activity_events FOR EACH ROW EXECUTE FUNCTION activity_events_immutable();
  CREATE TABLE authorization_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),action_key text,outcome text,
    authorized_by text,requested_by text,authorizer_role text,terminal_id text,store_id text,detail jsonb,created_at timestamptz DEFAULT now());
  CREATE TABLE shift_notifications(shift_id uuid,summary text,closed_by text,store_id text,total_sales numeric);
  CREATE TABLE terminal_tokens(id text PRIMARY KEY,location_id text,status text,revoked_at timestamptz);
  INSERT INTO terminal_tokens VALUES('t-a','a','active',NULL),('t-b','b','active',NULL),('management',NULL,'active',NULL);
  CREATE TABLE sync_idempotency_receipts(batch_id uuid PRIMARY KEY,organization_id text,branch_id text,
    table_name text,payload_hash text,applied_count int);
  ${table("shifts")}
  ALTER TABLE shifts ADD COLUMN IF NOT EXISTS state text,ADD COLUMN IF NOT EXISTS close_reason text,
    ADD COLUMN IF NOT EXISTS closing_started_at timestamptz,ADD COLUMN IF NOT EXISTS closing_started_by text,
    ADD COLUMN IF NOT EXISTS final_counted_cash numeric,ADD COLUMN IF NOT EXISTS variance_status text;
  ${fn("pos_sync_assert_shift_ownership")}
  ${fn("pos_sync_shift_closure_ack")}
  ${fn("pos_sync_validate_scope")}
  ${fn("sync_delete_activity_events")}
  ${fn("pos_sync_push_batch")}
  ${fn("pos_sync_push_aggregate")}
  REVOKE ALL ON FUNCTION public.pos_sync_push_batch(uuid,text,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
  GRANT EXECUTE ON FUNCTION public.pos_sync_push_batch(uuid,text,text,text,text,jsonb,jsonb) TO service_role;
  REVOKE ALL ON FUNCTION public.pos_sync_push_aggregate(uuid,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
  GRANT EXECUTE ON FUNCTION public.pos_sync_push_aggregate(uuid,text,text,text,jsonb) TO service_role;
  SELECT set_config('test.auth_role','service_role',false);`);
for (const base of bases) await db.exec(base);
await db.exec(personal);
if (!baselineOnly) await db.exec(correction);
await db.exec(token);

const rule = patch => ({ id: "rule-token", name: "Token owner and administrators", enabled: true,
  event: "soft_token_approval", branches: [], actorUsers: [], actorRoles: [], severities: [], minAmount: null,
  maxAmount: null, audience: "original", users: [], roles: [], channels: ["app","push","whatsapp"],
  phones: ["6731234567"], phoneUsers: { "6731234567": "manager-a" }, template: "{{title}}\n{{message}}\n{{branch}}",
  quietFrom: "", quietTo: "", timeZone: "UTC", ...patch });
const rules = async value => {
  const prior = (await db.query("SELECT notification_settings->'rules' rules FROM pos_settings WHERE id=1")).rows[0].rules;
  return db.query("SELECT save_notification_rule_table($1::jsonb,$2::jsonb)", [JSON.stringify(value), JSON.stringify(prior)]);
};
const approve = async (patch = {}) => {
  const value = { id: randomUUID(), action: "price_override", outcome: "approved", owner: "manager-a", requester: "cashier",
    terminal: "t-a", branch: "a", detail: { credential_method: "totp", approved_by_name: "Manager A", requested_by_name: "Cashier",
      ticket_reference: "BILL-42", token: "fixture-token-never-copy", secret: "fixture-secret-never-copy" }, ...patch };
  await db.query(`INSERT INTO authorization_log(id,action_key,outcome,authorized_by,requested_by,authorizer_role,terminal_id,store_id,detail)
    VALUES($1::uuid,$2,$3,$4,$5,'supervisor',$6,$7,$8::jsonb)`, [value.id,value.action,value.outcome,value.owner,value.requester,value.terminal,value.branch,JSON.stringify(value.detail)]);
  return (await db.query("SELECT * FROM activity_events WHERE client_event_id=$1", [`soft-token-approval:${value.id}`])).rows[0];
};
const event = async (patch = {}) => {
  const payload = { id: randomUUID(), event_type: "approval_requested", severity: "info", title: "Original event", message: "Original immutable content",
    store_id: "a", branch_id: "a", actor_id: "cashier", meta: { audience_user_ids: ["manager-a"] }, client_event_id: randomUUID(),
    created_at: "2026-10-30T10:00:00Z", cleared_by: [], whatsapp_status: "skipped", ...patch };
  await db.query("INSERT INTO activity_events SELECT * FROM jsonb_populate_record(NULL::activity_events,$1::jsonb)", [JSON.stringify(payload)]);
  return (await db.query("SELECT * FROM activity_events WHERE id=$1::uuid", [payload.id])).rows[0];
};
const sync = (rows, branch = "a", terminal = "t-a", batchId = randomUUID()) => db.query(
  "SELECT pos_sync_push_batch($1::uuid,'default',$2,$3,'activity_events',$4::jsonb,'[]'::jsonb) result",
  [batchId, branch, terminal, JSON.stringify(rows)]);
const snapshot = async id => (await db.query("SELECT * FROM activity_events WHERE id=$1::uuid", [id])).rows[0];
let passed = 0;
let failed = 0;
async function test(name, work) {
  await db.exec(`TRUNCATE notification_deliveries,activity_events,authorization_log,pos_settings,sync_idempotency_receipts;
    INSERT INTO pos_settings VALUES(1,'{"enabled":false,"shiftAlerts":{"whatsapp":false}}');`);
  try { await work(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
}

try {
  await test("personal clears union through actual native batch, stale retry and immutable audit trigger", async () => {
    const original = await event();
    const id = original.id;
    for (const cleared_by of [["manager-a"],["admin-a"],[],["manager-a"]])
      await sync([{ ...original, title: "Rejected replacement", store_id: "a", cleared_by }]);
    const current = await snapshot(id);
    assert.deepEqual(current.cleared_by.sort(), ["admin-a","manager-a"]);
    for (const key of Object.keys(original).filter(key => key !== "cleared_by")) assert.deepEqual(current[key], original[key], key);
    assert.equal((await db.query("SELECT count(*)::int n FROM activity_events")).rows[0].n, 1);
  });
  await test("personal clear preserves system resolution, native UUID identity and repeated batch receipts", async () => {
    const original = await event({ cleared_by: ["system:approval-resolved"] });
    const userId = (await db.query("SELECT id FROM app_users WHERE user_id='manager-a'")).rows[0].id;
    const payload = [{ ...original, cleared_by: [userId] }];
    const batchId = randomUUID(); await sync(payload, "a", "t-a", batchId);
    const replay = await sync(payload, "a", "t-a", batchId);
    assert.equal(replay.rows[0].result.replayed, true);
    assert.deepEqual((await snapshot(original.id)).cleared_by.sort(), ["system:approval-resolved",userId].sort());
  });
  await test("normal native registration and row branch scope still reject cross-branch uploads", async () => {
    const original = await event();
    await assert.rejects(sync([{ ...original, store_id: "b", branch_id: "b" }]), /SYNC_BRANCH_FORBIDDEN/);
    await assert.rejects(sync([original], "b", "t-a"), /SYNC_TERMINAL_SCOPE_FORBIDDEN/);
    await assert.rejects(sync([original], "a", "management"), /SYNC_TERMINAL_SCOPE_FORBIDDEN/);
    assert.deepEqual(await snapshot(original.id), original);
  });
  await test("a normal till cannot acknowledge an existing other-branch event by relabeling its upload", async () => {
    const foreign = await event({ store_id: "b", branch_id: "b", meta: { audience_user_ids: ["manager-b"] } });
    let rejection;
    try { await sync([{ ...foreign, store_id: "a", branch_id: "a", cleared_by: ["manager-b"] }]); }
    catch (error) { rejection = error; }
    assert.deepEqual(await snapshot(foreign.id), foreign);
    assert.match(rejection?.message ?? "Upload unexpectedly succeeded", /SYNC_BRANCH_FORBIDDEN/);
  });
  await test("new same-branch events insert and existing case-equivalent ownership keeps immutable contents", async () => {
    const original = await event({ store_id: " A " });
    const pending = { ...original, id: randomUUID(), store_id: "a", client_event_id: randomUUID(), cleared_by: ["manager-a"] };
    const inserted = await sync([pending]);
    assert.equal(inserted.rows[0].result.applied, 1);
    assert.equal((await snapshot(pending.id)).store_id, "a");
    await sync([{ ...original, store_id: "a", cleared_by: ["manager-a"] }]);
    const current = await snapshot(original.id);
    assert.equal(current.store_id, " A ");
    assert.deepEqual(current.cleared_by, ["manager-a"]);
    for (const key of Object.keys(original).filter(key => key !== "cleared_by")) assert.deepEqual(current[key], original[key], key);
  });
  await test("existing global and blank-owned events retain shared clears without branch reassignment", async () => {
    for (const store_id of [null, "", "   "]) {
      const original = await event({ store_id, branch_id: null, cleared_by: ["system:approval-resolved"] });
      for (const branch of ["a", "b"]) await sync([{ ...original, cleared_by: [branch === "a" ? "manager-a" : "manager-b"] }], branch, `t-${branch}`);
      const current = await snapshot(original.id);
      assert.equal(current.store_id, store_id); assert.equal(current.branch_id, null);
      assert.deepEqual(current.cleared_by.sort(), ["manager-a", "manager-b", "system:approval-resolved"].sort());
      for (const key of Object.keys(original).filter(key => key !== "cleared_by")) assert.deepEqual(current[key], original[key], key);
    }
    const marker = await event({ store_id: "global", branch_id: null });
    await assert.rejects(sync([{ ...marker, store_id: "a", cleared_by: ["manager-a"] }]), /SYNC_BRANCH_FORBIDDEN/);
    assert.deepEqual(await snapshot(marker.id), marker);
  });
  await test("raw activity application requires verified native batch context, not incoming branch labels", async () => {
    const original = await event();
    await assert.rejects(db.query("SELECT sync_apply_activity_events($1::jsonb)", [JSON.stringify([original])]), /SYNC_TERMINAL_REQUIRED/);
    await assert.rejects(db.transaction(async tx => {
      await tx.exec("SELECT set_config('pos.sync_branch','a',true),set_config('pos.sync_terminal','t-b',true)");
      await tx.query("SELECT sync_apply_activity_events($1::jsonb)", [JSON.stringify([original])]);
    }), /SYNC_TERMINAL_SCOPE_FORBIDDEN/);
    await assert.rejects(db.transaction(async tx => {
      await tx.exec("SELECT set_config('pos.sync_branch','a',true),set_config('pos.sync_terminal','t-a',true)");
      await tx.query("SELECT sync_apply_activity_events($1::jsonb)", [JSON.stringify([{ ...original, store_id: "b" }])]);
    }), /SYNC_BRANCH_FORBIDDEN/);
    assert.deepEqual(await snapshot(original.id), original);
  });
  await test("a foreign-ID conflict rolls back earlier inserts, clears, delivery effects and the whole batch receipt", async () => {
    await rules([rule({ event: "approval_requested", channels: ["app"] })]);
    const own = await event(), foreign = await event({ store_id: "b", branch_id: "b" });
    const pending = { ...own, id: randomUUID(), client_event_id: randomUUID() };
    const deliveries = (await db.query("SELECT * FROM notification_deliveries ORDER BY id")).rows;
    const batchId = randomUUID();
    await assert.rejects(sync([pending, { ...own, cleared_by: ["manager-a"] }, { ...foreign, store_id: "a", cleared_by: ["manager-a"] }], "a", "t-a", batchId), /SYNC_BRANCH_FORBIDDEN/);
    assert.equal(await snapshot(pending.id), undefined);
    assert.deepEqual(await snapshot(own.id), own); assert.deepEqual(await snapshot(foreign.id), foreign);
    assert.deepEqual((await db.query("SELECT * FROM notification_deliveries ORDER BY id")).rows, deliveries);
    assert.equal((await db.query("SELECT count(*)::int n FROM sync_idempotency_receipts WHERE batch_id=$1", [batchId])).rows[0].n, 0);
    const corrected = await sync([{ ...own, cleared_by: ["manager-a"] }], "a", "t-a", batchId);
    assert.equal(corrected.rows[0].result.replayed, undefined); assert.equal(corrected.rows[0].result.applied, 1);
  });
  await test("a later foreign-ID operation rolls back the actual multi-operation aggregate", async () => {
    const own = await event(), foreign = await event({ store_id: "b", branch_id: "b" });
    const batchId = randomUUID();
    await assert.rejects(db.query("SELECT pos_sync_push_aggregate($1::uuid,'default','a','t-a',$2::jsonb)", [batchId, JSON.stringify([
      { table: "activity_events", rows: [{ ...own, cleared_by: ["manager-a"] }], changes: [] },
      { table: "activity_events", rows: [{ ...foreign, store_id: "a", cleared_by: ["manager-a"] }], changes: [] },
    ])]), /SYNC_BRANCH_FORBIDDEN/);
    assert.deepEqual(await snapshot(own.id), own); assert.deepEqual(await snapshot(foreign.id), foreign);
    assert.equal((await db.query("SELECT count(*)::int n FROM sync_idempotency_receipts WHERE batch_id=$1", [batchId])).rows[0].n, 0);
  });
  await test("duplicate IDs and secondary event-key conflicts cannot produce a partial successful acknowledgement", async () => {
    const own = await event(), foreign = await event({ store_id: "b", branch_id: "b" });
    await assert.rejects(sync([{ ...own, cleared_by: ["manager-a"] }, { ...own, cleared_by: ["admin-a"] }]), /cannot affect row a second time/);
    await assert.rejects(sync([{ ...own, cleared_by: ["manager-a"] }, { ...foreign, id: randomUUID(), store_id: "a" }]), /duplicate key|unique constraint/);
    assert.deepEqual(await snapshot(own.id), own); assert.deepEqual(await snapshot(foreign.id), foreign);
    assert.equal((await db.query("SELECT count(*)::int n FROM sync_idempotency_receipts")).rows[0].n, 0);
  });
  await test("a trigger-time competing insertion is refused atomically rather than partially acknowledged", async () => {
    const source = await event();
    await db.exec(`CREATE FUNCTION fixture_activity_ack_conflict() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF pg_trigger_depth()=1 AND NEW.id::text=current_setting('test.race_id',true) THEN
          INSERT INTO activity_events(id,event_type,severity,title,message,store_id,branch_id,client_event_id,created_at,cleared_by)
            VALUES(NEW.id,'approval_requested','info','Competing immutable event','Competing owner',
              current_setting('test.race_branch',true),current_setting('test.race_branch',true),NEW.client_event_id,now(),'{}');
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER fixture_activity_ack_conflict BEFORE INSERT ON activity_events FOR EACH ROW EXECUTE FUNCTION fixture_activity_ack_conflict();`);
    try {
      for (const branch of ["b", "a"]) {
        const pending = { ...source, id: randomUUID(), client_event_id: randomUUID(), cleared_by: ["manager-a"] };
        await db.query("SELECT set_config('test.race_id',$1,false),set_config('test.race_branch',$2,false)", [pending.id, branch]);
        // Same-command trigger insertion uses PostgreSQL's cardinality guard;
        // it is not a substitute for independent-session concurrency testing.
        await assert.rejects(sync([pending]), /cannot affect row a second time/);
        assert.equal(await snapshot(pending.id), undefined);
      }
      assert.equal((await db.query("SELECT count(*)::int n FROM sync_idempotency_receipts")).rows[0].n, 0);
    } finally {
      await db.exec("DROP TRIGGER fixture_activity_ack_conflict ON activity_events; DROP FUNCTION fixture_activity_ack_conflict()");
    }
  });
  await test("duplicate ack uploads cannot reroute, duplicate delivery or change event contents", async () => {
    await rules([rule({ event: "approval_requested", channels: ["app"] })]);
    const original = await event();
    const deliveries = (await db.query("SELECT * FROM notification_deliveries ORDER BY id")).rows;
    await sync([{ ...original, meta: { audience_user_ids: ["cashier"] }, cleared_by: ["manager-a"] }]);
    assert.deepEqual((await snapshot(original.id)).meta, original.meta);
    assert.deepEqual((await db.query("SELECT * FROM notification_deliveries ORDER BY id")).rows, deliveries);
  });
  await test("unactivated legacy settings and historical events remain unchanged on both upgrades", async () => {
    const original = await event();
    const before = (await db.query("SELECT notification_settings FROM pos_settings")).rows[0].notification_settings;
    await db.exec(personal); if (!baselineOnly) { await db.exec(correction); await db.exec(correction); }
    await db.exec(token); await db.exec(token);
    assert.deepEqual((await db.query("SELECT notification_settings FROM pos_settings")).rows[0].notification_settings, before);
    assert.deepEqual(await snapshot(original.id), original);
  });
  await test("only a missing token rule in an activated array is appended once", async () => {
    const saleRule = rule({ id: "sale-rule", event: "sale_complete", channels: ["app"], audience: "selected", users: ["cashier"] });
    await rules([saleRule]); await db.exec(token);
    const first = (await db.query("SELECT notification_settings->'rules' rules FROM pos_settings")).rows[0].rules;
    assert.equal(first.length, 2); assert.deepEqual(first[0], saleRule); assert.equal(first[1].event, "soft_token_approval");
    await db.exec(token);
    assert.deepEqual((await db.query("SELECT notification_settings->'rules' rules FROM pos_settings")).rows[0].rules, first);
  });
  await test("existing disabled token rule is preserved rather than enabled or replaced", async () => {
    const saved = rule({ enabled: false, users: ["manager-a"], audience: "selected" });
    await rules([saved]); await db.exec(token);
    assert.deepEqual((await db.query("SELECT notification_settings->'rules' rules FROM pos_settings")).rows[0].rules, [saved]);
    const row = await approve(); assert.deepEqual(row.meta.notification_routes.app, []);
    assert.equal((await db.query("SELECT count(*)::int n FROM authorization_log")).rows[0].n, 1);
  });
  await test("original rule delivers only to the verified owner and active administrators", async () => {
    await rules([rule()]); const row = await approve();
    assert.deepEqual(row.meta.notification_routes.app.sort(), ["admin-a","admin-custom","manager-a"]);
    assert.deepEqual(row.meta.notification_routes.push.sort(), ["admin-a","admin-custom","manager-a"]);
    assert.deepEqual(row.meta.notification_routes.terminalApp, []);
    assert.equal(row.actor_id, "manager-a"); assert.equal(row.terminal_id, "t-a"); assert.equal(row.store_id, "a");
    assert.equal(row.meta.notification_original.ticket_reference, "BILL-42");
    const delivered = (await db.query("SELECT channel,recipient FROM notification_deliveries WHERE recipient<>'' ORDER BY channel,recipient")).rows;
    assert.equal(delivered.length, 6); assert(delivered.every(d => d.channel !== "whatsapp"));
    assert(!JSON.stringify(row).includes("fixture-token-never-copy")); assert(!JSON.stringify(row).includes("fixture-secret-never-copy"));
  });
  await test("selected users and roles narrow the owner/admin ceiling, never broaden it", async () => {
    for (const selection of [{ audience: "selected", users: ["manager-a","cashier","other-manager","terminal-a"], roles: [] },
      { audience: "selected", users: [], roles: ["supervisor"] }]) {
      await rules([rule(selection)]); const row = await approve();
      assert.deepEqual(row.meta.notification_routes.app, ["manager-a"]);
    }
  });
  await test("branch/actor filters and disabled rules suppress delivery without suppressing audit", async () => {
    for (const patch of [{ branches: ["b"] }, { actorUsers: ["cashier"] }, { enabled: false }]) {
      await rules([rule(patch)]); const row = await approve();
      assert.deepEqual(row.meta.notification_routes.app, []); assert.deepEqual(row.meta.notification_routes.push, []);
    }
    assert.equal((await db.query("SELECT count(*)::int n FROM authorization_log")).rows[0].n, 3);
  });
  await test("unrelated staff/branch owners and terminal identities receive no private approval", async () => {
    await rules([rule()]); const row = await approve({ owner: "manager-b" });
    assert.deepEqual(row.meta.notification_routes.app.sort(), ["admin-a","admin-custom"]);
    assert(!row.meta.notification_routes.app.includes("terminal-a"));
    assert(!row.meta.notification_routes.app.includes("cashier"));
  });
  await test("PIN failures and non-token approvals never create a token notification", async () => {
    await rules([rule()]);
    assert.equal(await approve({ outcome: "failed_pin" }), undefined);
    assert.equal(await approve({ detail: { credential_method: "pin" } }), undefined);
    assert.equal(await approve({ owner: "" }), undefined);
    assert.equal((await db.query("SELECT count(*)::int n FROM authorization_log")).rows[0].n, 3);
  });
  await test("revoked rules are rechecked before external push delivery", async () => {
    const saved = rule(); await rules([saved]); const row = await approve();
    await rules([{ ...saved, enabled: false }]);
    assert.deepEqual((await db.query("SELECT * FROM authorized_notification_push_users($1::uuid)", [row.id])).rows, []);
  });
  await test("ordinary database roles cannot execute either privileged synchronization path", async () => {
    for (const role of ["anon","authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(db.query("SELECT sync_apply_activity_events('[]'::jsonb)"), /permission denied/);
      await assert.rejects(sync([]), /permission denied/);
      await db.exec("RESET ROLE");
    }
    const privileges = (await db.query(`SELECT
      has_function_privilege('service_role','sync_apply_activity_events(jsonb)','EXECUTE') service_sync,
      has_function_privilege('authenticated','notify_soft_token_approval()','EXECUTE') client_trigger,
      has_table_privilege('authenticated','notification_deliveries','SELECT') client_delivery`)).rows[0];
    assert.deepEqual(privileges, { service_sync: true, client_trigger: false, client_delivery: false });
  });
  await test("migration, every canonical definition and real generator output keep the same ownership contract", async () => {
    const pattern = /CREATE OR REPLACE FUNCTION public\.sync_apply_activity_events\(p_rows jsonb\)[\s\S]*?END \$fn\$;/g;
    const expected = correction.match(pattern)?.[0]; assert(expected);
    for (const definition of schema.match(pattern) ?? []) assert.equal(definition.replaceAll("\r\n", "\n"), expected);
    const fixture = await mkdtemp(join(tmpdir(), "pos-notification-parity-"));
    const root = fileURLToPath(new URL("../", import.meta.url));
    try {
      for (const path of ["scripts/generate-supabase-sync-contract.cjs", "scripts/sqlserver-sync-policy.cjs",
        "database/sqlserver/schema-registry.json", "supabase/schema.sql", `supabase/migrations/${correctionName}`,
        "supabase/migrations/20261030153259_confirm_shift_closure_sync_acknowledgement.sql",
        "supabase/migrations/20261030164829_bind_shift_closure_proof_to_requested_revision.sql"]) {
        await mkdir(dirname(join(fixture, path)), { recursive: true });
        await copyFile(join(root, path), join(fixture, path));
      }
      const generated = spawnSync(process.execPath, [join(fixture, "scripts/generate-supabase-sync-contract.cjs")], { encoding: "utf8" });
      assert.equal(generated.status, 0, generated.stderr);
      const output = await readFile(join(fixture, "supabase/schema.sql"), "utf8");
      const definitions = output.match(pattern) ?? []; assert.equal(definitions.length, 2);
      for (const definition of definitions) assert.equal(definition.replaceAll("\r\n", "\n"), expected);
      await db.exec(definitions[0]); await db.exec(definitions[1]);
      const foreign = await event({ store_id: "b", branch_id: "b" });
      await assert.rejects(sync([{ ...foreign, store_id: "a", cleared_by: ["manager-a"] }]), /SYNC_BRANCH_FORBIDDEN/);
      assert.deepEqual(await snapshot(foreign.id), foreign);
    } finally {
      assert.equal(dirname(resolve(fixture)), resolve(tmpdir())); assert(basename(fixture).startsWith("pos-notification-parity-"));
      await rm(fixture, { recursive: true, force: true });
    }
  });
  console.log(`${passed} passed; ${failed} failed isolated notification upgrade scenarios; no live connection used.`);
  if (failed) process.exitCode = 1;
} finally { await db.close(); }
