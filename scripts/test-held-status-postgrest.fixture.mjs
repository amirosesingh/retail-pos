// Caller-owned synthetic PostgreSQL fixture only. Never reads configured POS credentials.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve, join, sep } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { createHmac, randomBytes } from "node:crypto";
export async function verifyHeldStatusPostgrest(db, { A, B, OPS, MAN, SHIFT }) {
  const exe = process.env.POSTGREST_TEST_EXE;
  assert(exe); assert.equal(execFileSync(exe, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 10000 }).trim(), "PostgREST 16.5");
  const { port: pgPort, directory } = db.historyRest ?? {};
  assert(Number.isInteger(pgPort) && pgPort > 0 && resolve(directory).startsWith(resolve(".tmp/seven-shift-summary-tests") + sep));
  const port = await new Promise((yes, no) => { const server = createServer(); server.once("error", no); server.listen(0, "127.0.0.1", () => { const value = server.address().port; server.close(() => yes(value)); }); });
  const secret = randomBytes(48).toString("hex"), encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = role => { const value = encode({ alg: "HS256", typ: "JWT" }) + "." + encode({ role, exp: Math.floor(Date.now() / 1000) + 600 }); return value + "." + createHmac("sha256", secret).update(value).digest("base64url"); };
  const config = join(directory, "held-status-postgrest.conf");
  writeFileSync(config, ['db-uri = "postgresql://postgres@127.0.0.1:' + pgPort + '/postgres?sslmode=disable"', 'db-schemas = "public"', 'db-anon-role = "anon"', "db-max-rows = 1000", "db-pool = 1", "db-channel-enabled = false", 'server-host = "127.0.0.1"', "server-port = " + port, 'jwt-secret = "' + secret + '"', 'log-level = "error"', ""].join("\n"));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^PG|^PGRST_/i.test(key) || key === "DATABASE_URL") delete env[key];
  let child, log = "", passed = 0;
  const origin = "http://127.0.0.1:" + port;
  const common = { p_organization_id: "default", p_branch_id: A, p_terminal_id: OPS, p_keep_commerce: false };
  const ticket = (id, billNo = null, shiftId = null) => ({ id, billNo, shiftId });
  const request = (body, role = "service_role") => fetch(origin + "/rpc/pos_sync_held_status_v1", { method: "POST", headers: { "content-type": "application/json", "accept-encoding": "identity", ...(role ? { authorization: "Bearer " + token(role) } : {}) }, body: JSON.stringify({ ...common, ...body }), signal: AbortSignal.timeout(15000) });
  const check = async (name, work) => { await work(); passed++; console.log("PASS actual PostgREST held " + name); };
  try {
    child = spawn(exe, [config], { env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] }); child.stderr.on("data", bytes => log = (log + bytes).slice(-2000));
    let ready = false;
    for (let n = 0; n < 100; n++) { assert.equal(child.exitCode, null, log); try { const response = await fetch(origin + "/", { signal: AbortSignal.timeout(500) }); if (response.ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 50)); }
    assert(ready, "Owned held PostgREST readiness timed out");
    await check("preserves exact identity and validates byte/count headers without private values", async () => {
      const response = await request({ p_tickets: [ticket("held-A", "BILL-A", SHIFT)] }); assert.equal(response.status, 200, await response.clone().text());
      const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(response.headers.get("x-pos-held-status-version"), "1"); assert.equal(Number(response.headers.get("x-pos-held-status-bytes")), bytes.length); assert.equal(response.headers.get("x-pos-held-status-rows"), "1");
      const value = JSON.parse(bytes.toString("utf8")); assert.equal(value.records.length, 1); const row = value.records[0];
      assert.equal(row.rowVersion, "2147483647"); assert.equal(row.updatedAt, "2026-11-07T01:02:03.1234560Z"); assert.match(row.identityJson, /9007199254740993\.11/); assert.match(row.identityJson, /19\.123456789012/); assert(!row.identityJson.includes("PRIVATE")); assert(!row.identityJson.includes("cost")); assert.equal(row.proofFrom, "held");
    });
    await check("missing hold proof is explicitly accepted_parent with no invented version, time or cart", async () => {
      await db.exec("DELETE FROM sales WHERE bill_number='MISSING-A' AND id='dddddddd-dddd-4ddd-8ddd-000000000005';");
      const response = await request({ p_tickets: [ticket("missing-local", "MISSING-A", SHIFT)] }); assert.equal(response.status, 200); const row = (await response.json()).records[0];
      assert.equal(row.proofFrom, "accepted_parent"); assert.equal(row.status, "completed"); for (const key of ["identityJson", "rowVersion", "updatedAt"]) assert.equal(row[key], null);
    });
    await check("foreign, active, absent and malformed identities do not become cancellations", async () => {
      const response = await request({ p_tickets: [ticket("foreign-B"), ticket("active-A"), ticket("unknown"), ticket("bad-line"), ticket("bad-coupon")] }); assert.equal(response.status, 200); assert.deepEqual((await response.json()).records, []);
    });
    await check("booking proof has its actual booking id and no fabricated bill number", async () => {
      const response = await request({ p_tickets: [ticket("booking-A", "BOOK-BILL", SHIFT)] }); assert.equal(response.status, 200); const row = (await response.json()).records[0]; assert.equal(row.parent.kind, "booking"); assert.equal(row.parent.billNo, null);
    });
    await check("branch, Management and public-role denials remain enforced", async () => {
      for (const body of [{ p_branch_id: B }, { p_terminal_id: MAN }]) { const response = await request({ ...body, p_tickets: [ticket("held-A")] }); assert.equal(response.status, 400); assert.equal((await response.json()).message, "SYNC_TERMINAL_SCOPE_FORBIDDEN"); }
      for (const [role, status] of [[null, 401], ["authenticated", 403]]) { const response = await request({ p_tickets: [ticket("held-A")] }, role); assert.equal(response.status, status, await response.text()); }
    });
    await check("duplicates and bounded-output exhaustion fail without partial proof", async () => {
      for (const [body, status, code, message] of [
        [{ p_tickets: [ticket("held-A"), ticket("held-A")] }, 400, "P0001", "HELD_STATUS_DUPLICATE_TICKET"],
        [{ p_tickets: [ticket("cancel-A")], p_max_bytes: 1024 }, 500, "54000", "HELD_STATUS_TOO_LARGE"],
      ]) { const response = await request(body); assert.equal(response.status, status); const value = await response.json(); assert.equal(value.code, code); assert.equal(value.message, message); }
    });
    return passed;
  } finally { if (child && child.exitCode === null) { const closed = new Promise(resolve => child.once("exit", resolve)); child.kill(); await closed; } }
}
