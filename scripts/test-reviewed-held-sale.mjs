// Synthetic databases only. This harness uses no configured POS credentials.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { join, resolve, sep } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const read = file => readFile(new URL("../" + file, import.meta.url), "utf8");
const migration = await read("supabase/migrations/20261107060000_reviewed_held_sale_graph.sql");
const metadata = JSON.parse(await read("src/lib/__tests__/fixtures/history-scope-live-metadata.json"));
const registry = JSON.parse(await read("database/sqlserver/schema-registry.json"));
const postgrest = process.argv.includes("--postgrest");
const db = new PGlite(), setup = [];
const seed = async sql => { await db.exec(sql); if (postgrest) setup.push(sql); };

const id = number => "d0000000-0000-4000-8000-" + String(number).padStart(12, "0");
const branch = id(1), foreign = id(2), terminal = id(3), actor = id(4), shift = id(5), cashier = id(6), product = id(7), mobile = id(8), sibling = id(9);
const hold = bill => `D:${branch}:${bill}`;
const q = value => "'" + String(value).replaceAll("'", "''") + "'";
const signature = "public.pos_sync_held_sale_review_v1(text,text,text,uuid,text,text,uuid,boolean)";
const readGraph = (bill, overrides = {}) => {
  const values = { organization: "default", branch, terminal, actor, hold: hold(bill), bill, shift, ...overrides };
  return db.query(`SELECT public.pos_sync_held_sale_review_v1($1,$2,$3,$4::uuid,$5,$6,$7::uuid,false) value`, Object.values(values))
    .then(result => result.rows[0].value);
};
const expectNoGraph = value => { assert.equal(value.proof, null); assert.equal(value.graphJson, null); };
const check = async (label, test) => { await test(); console.log("PASS " + label); };
const count = (sale, table) => db.query(`SELECT count(*)::int value FROM public.${table} WHERE sale_id=$1::uuid`, [sale]).then(x => x.rows[0].value);
let worker, ownedPg;

try {
  await seed(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA private; CREATE TYPE public.app_role AS ENUM('admin','staff');
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT COALESCE(NULLIF(current_setting('request.jwt.claims',true),'')::jsonb->>'role','service_role')$$;
    CREATE TABLE public.terminal_tokens(id uuid PRIMARY KEY,location_id text,status text,revoked_at timestamptz,platform text,is_claimed boolean,claimed_at timestamptz,claimed_platform text);
    CREATE TABLE private.completed_hold_tombstones(held_id text PRIMARY KEY,store_id text NOT NULL,bill_no text NOT NULL,sale_id uuid NOT NULL,deleted_at timestamptz NOT NULL DEFAULT now());
    REVOKE ALL ON SCHEMA private FROM PUBLIC;
    INSERT INTO public.terminal_tokens VALUES(${q(terminal)},${q(branch)},'used',NULL,'pc',true,NULL,'electron'),(${q(mobile)},${q(branch)},'used',NULL,'mobile',true,NULL,'android'),
      (${q(sibling)},${q(branch)},'used',NULL,'pc',true,NULL,'electron');`);
  for (const name of ["app_users", "shifts", "held_orders", "sales", "sale_items", "payment_transactions"]) {
    const table = registry.tables.find(entry => entry.cloudTable === name);
    await seed(`CREATE TABLE public."${name}"(${table.columns.map(c => `"${c.cloudColumn}" ${c.cloudType}${c.cloudColumn === "id" ? " PRIMARY KEY" : ""}`).join(",")});`);
  }
  for (const name of ["pos_sync_validate_scope(text,text,text)", "pos_sync_history_project_v1(jsonb,text,boolean)"]) {
    const definition = metadata.functions.find(entry => entry.signature === name)?.definition;
    assert(definition);
    await seed(definition);
  }
  await seed(`INSERT INTO app_users(id,role,is_active,store_id) VALUES(${q(actor)},'admin',true,${q(branch)}),(${q(cashier)},'staff',true,${q(branch)});
    INSERT INTO shifts(id,store_id,terminal_id) VALUES(${q(shift)},${q(branch)},${q(terminal)});`);
  const fixture = async (bill, number, proof, zero = false) => {
    const sale = id(number), item = id(number + 1000), payment = id(number + 2000);
    await seed(`INSERT INTO sales(id,store_id,shift_id,bill_number,total_amount,paid_amount,change_amount,is_refunded,is_exchange,payments,created_at)
      VALUES(${q(sale)},${q(branch)},${q(shift.toUpperCase())},${q(bill)},${zero ? 0 : 20},${zero ? 0 : 100},${zero ? 0 : 80},false,${zero},${q(`[{"method":"cash","amount":${zero ? 0 : 20}}]`)}::jsonb,'2026-11-07 04:05:06.123456+00');
      INSERT INTO sale_items(id,sale_id,branch_id,product_id,quantity,unit_price) VALUES(${q(item)},${q(sale)},${q(branch)},${q(product)},1,9007199254740993.123456789012);`);
    if (!zero) await seed(`INSERT INTO payment_transactions(id,sale_id,store_id,shift_id,amount,method,kind,status,source_type,metadata)
      VALUES(${q(payment)},${q(sale)},${q(branch)},${q(shift)},20,'cash','payment','completed','sale','{"ecommerceEnabled":true,"keep":1}');`);
    if (proof === "cleaned_hold") await seed(`INSERT INTO private.completed_hold_tombstones(held_id,store_id,bill_no,sale_id) VALUES(${q(hold(bill))},${q(branch)},${q(bill)},${q(sale)});`);
    if (proof === "completed_hold") await seed(`INSERT INTO held_orders(id,store_id,shift_id,bill_no,status,lines) VALUES(${q(hold(bill))},${q(branch)},${q(shift)},${q(bill)},'completed',${q(JSON.stringify([{ productId: product, qty: 1 }]))}::jsonb);`);
    return { sale, item, payment };
  };
  const accepted = await fixture("BILL-CLEAN", 10, "cleaned_hold");
  await fixture("BILL-ZERO", 11, "completed_hold", true);
  await fixture("BILL-NO-PROOF", 12, null);
  await check("migration and replay preserve records and expose only service execution", async () => {
    await seed(migration); await seed(migration);
    const result = await db.query(`SELECT p.provolatile,p.prosecdef,has_function_privilege('anon',$1,'EXECUTE') anonymous,
      has_function_privilege('authenticated',$1,'EXECUTE') person,has_function_privilege('service_role',$1,'EXECUTE') service,
      has_table_privilege('service_role','private.completed_hold_tombstones','SELECT') direct FROM pg_proc p WHERE p.oid=$1::regprocedure`, [signature]);
    assert.deepEqual(result.rows[0], { provolatile: "s", prosecdef: true, anonymous: false, person: false, service: true, direct: false });
    assert.equal(await count(accepted.sale, "sale_items"), 1);
    assert.equal(await count(accepted.sale, "payment_transactions"), 1);
  });
  await check("cleaned hold supplies exact cloud values and cash change uses saved net tender", async () => {
    const value = await readGraph("BILL-CLEAN");
    assert.equal(value.proof, "cleaned_hold"); assert.equal(value.actorId, actor); assert.equal(value.terminalId, terminal);
    assert.match(value.graphJson, /9007199254740993\.123456789012/);
    assert.match(value.graphJson, /04:05:06\.123456/);
    const graph = JSON.parse(value.graphJson);
    assert.equal(graph.sale.id, accepted.sale); assert.equal(graph.sale.paid_amount, 100); assert.equal(graph.payments[0].amount, 20);
    assert.deepEqual(graph.payments[0].metadata, { keep: 1 });
    for (const [table, row] of [["sales", graph.sale], ["sale_items", graph.items[0]], ["payment_transactions", graph.payments[0]]])
      assert.deepEqual(Object.keys(row).sort(), registry.tables.find(entry => entry.cloudTable === table).columns.map(c => c.cloudColumn).sort());
  });
  await check("the completed cloud hold permits a paymentless exchange", async () => {
    const value = await readGraph("BILL-ZERO"); assert.equal(value.proof, "completed_hold"); assert.deepEqual(JSON.parse(value.graphJson).payments, []);
  });
  await check("an arbitrary known receipt has no review graph", async () => expectNoGraph(await readGraph("BILL-NO-PROOF")));
  await check("denies a non-admin, other branch, wrong platform and malformed hold", async () => {
    await assert.rejects(readGraph("BILL-CLEAN", { actor: cashier }), /HELD_SALE_REVIEW_FORBIDDEN/);
    await assert.rejects(readGraph("BILL-CLEAN", { terminal: mobile }), /HELD_SALE_REVIEW_FORBIDDEN/);
    await assert.rejects(readGraph("BILL-CLEAN", { branch: foreign, hold: `D:${foreign}:BILL-CLEAN` }), /SYNC_TERMINAL_SCOPE_FORBIDDEN/);
    await assert.rejects(readGraph("BILL-CLEAN", { hold: "fake" }), /HELD_SALE_REVIEW_REQUEST/);
  });
  await check("wrong shift and contradictory aliases cannot return a graph", async () => {
    await assert.rejects(readGraph("BILL-CLEAN", { shift: id(999) }), /HELD_SALE_REVIEW_CONFLICT/);
    await assert.rejects(readGraph("BILL-CLEAN", { terminal: sibling }), /HELD_SALE_REVIEW_CONFLICT/);
    await db.exec(`BEGIN; INSERT INTO held_orders(id,store_id,bill_no,status) VALUES('alias',${q(branch)},'BILL-CLEAN','held');`);
    try { await assert.rejects(readGraph("BILL-CLEAN"), /HELD_SALE_REVIEW_CONFLICT/); } finally { await db.exec("ROLLBACK;"); }
  });
  await check("incomplete, foreign and over-limit children remain pending", async () => {
    for (const sql of [
      `DELETE FROM payment_transactions WHERE id=${q(accepted.payment)}`,
      `UPDATE sale_items SET branch_id=${q(foreign)} WHERE id=${q(accepted.item)}`,
      `UPDATE payment_transactions SET metadata=jsonb_build_object('large',repeat('x',262145)) WHERE id=${q(accepted.payment)}`,
      `INSERT INTO sale_items(id,sale_id) SELECT gen_random_uuid(),${q(accepted.sale)} FROM generate_series(1,256)`,
    ]) {
      await db.exec("BEGIN;" + sql + ";");
      try { expectNoGraph(await readGraph("BILL-CLEAN")); } finally { await db.exec("ROLLBACK;"); }
    }
  });

  if (postgrest) {
    const exe = process.env.POSTGREST_TEST_EXE, bin = process.env.POSTGRES_TEST_BIN; assert(exe && bin);
    const freePort = () => new Promise((yes, no) => {
      const server = createServer(); server.once("error", no); server.listen(0, "127.0.0.1", () => { const value = server.address().port; server.close(() => yes(value)); });
    });
    const pgPort = await freePort(), port = await freePort();
    const env = { ...process.env }; for (const key of Object.keys(env)) if (/^PG/i.test(key) || key === "DATABASE_URL") delete env[key];
    const base = resolve(".tmp/reviewed-held-sale-postgrest"); await mkdir(base, { recursive: true });
    const directory = await mkdtemp(join(base, "owned-"));
    const command = (name, args, options = {}) => execFileSync(join(bin, name + ".exe"), args, { env, encoding: "utf8", windowsHide: true, timeout: 60000, ...options });
    ownedPg = { directory, base, command, started: false };
    command("initdb", ["-D", directory, "-A", "trust", "-U", "postgres", "--encoding=UTF8", "--locale=C", "--no-instructions"]);
    command("pg_ctl", ["-D", directory, "-l", join(directory, "fixture.log"), "-o", `-h 127.0.0.1 -p ${pgPort} -c max_connections=5 -c shared_buffers=32MB`, "-w", "start"], { stdio: "ignore" });
    ownedPg.started = true;
    const sql = join(directory, "fixture.sql"); await writeFile(sql, setup.map(text => text.trimEnd().replace(/;?$/, ";")).join("\n"));
    command("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(pgPort), "-U", "postgres", "-d", "postgres", "-f", sql]);
    const secret = randomBytes(48).toString("hex"), encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
    const token = role => { const value = encode({ alg: "HS256", typ: "JWT" }) + "." + encode({ role, exp: Math.floor(Date.now() / 1000) + 300 }); return value + "." + createHmac("sha256", secret).update(value).digest("base64url"); };
    const config = join(directory, "reviewed-held-sale.conf");
    await writeFile(config, [`db-uri = "postgresql://postgres@127.0.0.1:${pgPort}/postgres?sslmode=disable"`, 'db-schemas = "public"', 'db-anon-role = "anon"',
      "db-pool = 1", "db-channel-enabled = false", 'server-host = "127.0.0.1"', `server-port = ${port}`, `jwt-secret = "${secret}"`, 'log-level = "error"'].join("\n"));
    worker = spawn(exe, [config], { env, windowsHide: true, stdio: "ignore" });
    const origin = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      assert.equal(worker.exitCode, null);
      try { if ((await fetch(origin, { signal: AbortSignal.timeout(400) })).ok) { ready = true; break; } } catch { /* start in progress */ }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert(ready);
    const call = (role, actorId = actor) => fetch(`${origin}/rpc/pos_sync_held_sale_review_v1`, { method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + token(role) },
      body: JSON.stringify({ p_organization_id: "default", p_branch_id: branch, p_terminal_id: terminal, p_actor_id: actorId,
        p_ticket_id: hold("BILL-CLEAN"), p_bill_no: "BILL-CLEAN", p_shift_id: shift, p_keep_commerce: false }), signal: AbortSignal.timeout(5000) });
    await check("actual PostgREST keeps the exact graph text and denies public or non-admin requests", async () => {
      const response = await call("service_role"); assert.equal(response.status, 200, await response.clone().text());
      assert.match((await response.json()).graphJson, /9007199254740993\.123456789012/);
      assert.equal((await call("authenticated")).status, 403);
      assert.equal((await call("service_role", cashier)).status, 403);
    });
  }
} finally {
  if (worker && worker.exitCode === null) { const closed = new Promise(resolve => worker.once("exit", resolve)); worker.kill(); await closed; }
  if (ownedPg) {
    const { directory, base, command, started } = ownedPg;
    assert(resolve(directory).startsWith(base + sep));
    if (started) command("pg_ctl", ["-D", directory, "-m", "fast", "-w", "stop"], { stdio: "ignore" });
    await rm(directory, { recursive: true });
  }
  await db.close();
}
