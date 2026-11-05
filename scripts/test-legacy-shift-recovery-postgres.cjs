"use strict";
// Opt-in, owned ephemeral PostgreSQL only. No DB URL, POS profile or credential.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), net = require("node:net");
const { execFileSync } = require("node:child_process"), { pathToFileURL } = require("node:url"), Module = require("node:module");
const hash = value => require("node:crypto").createHash("sha256").update(value).digest("hex");
assert.deepEqual(process.argv.slice(2), ["--run"]);
const bin = process.env.POSTGRES_TEST_BIN; assert(bin, "Existing portable POSTGRES_TEST_BIN required; no URL accepted");
const base = path.resolve(".tmp/legacy-recovery-postgres"); fs.mkdirSync(base, { recursive: true });
const directory = fs.mkdtempSync(path.join(base, "owned-"));
const environment = { ...process.env }; for (const key of Object.keys(environment)) if (/^PG/i.test(key) || key === "DATABASE_URL") delete environment[key];
const command = (name, args, options = {}) => execFileSync(path.join(bin, name + ".exe"), args, { env: environment, windowsHide: true, encoding: "utf8", timeout: 30000, ...options });
const freePort = () => new Promise((accept, reject) => { const s = net.createServer(); s.once("error", reject); s.listen(0, "127.0.0.1", () => { const port = s.address().port; s.close(() => accept(port)); }); });
function pgConnection(port) {
  const socket = net.createConnection({ host: "127.0.0.1", port }), queue = [];
  let input = Buffer.alloc(0), current = null, columns = [], rows = [], error = null;
  const int32 = n => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
  const ready = new Promise((accept, reject) => {
    current = { accept, reject };
    socket.once("connect", () => { const body = Buffer.concat([int32(196608), Buffer.from("user\0postgres\0database\0postgres\0client_encoding\0UTF8\0\0")]); socket.write(Buffer.concat([int32(body.length + 4), body])); });
  });
  socket.on("error", err => { current?.reject(err); for (const q of queue) q.reject(err); });
  const dispatch = () => { if (current || !queue.length) return; current = queue.shift(); rows = []; columns = []; error = null;
    const body = Buffer.from(current.text + "\0"); socket.write(Buffer.concat([Buffer.from("Q"), int32(body.length + 4), body])); };
  socket.on("data", chunk => {
    input = Buffer.concat([input, chunk]);
    while (input.length >= 5) {
      const length = input.readInt32BE(1); if (length < 4 || length > 16 * 1024 * 1024) { socket.destroy(Error("Invalid bounded test frame")); return; }
      if (input.length < length + 1) return;
      const type = String.fromCharCode(input[0]), data = input.subarray(5, length + 1); input = input.subarray(length + 1);
      if (type === "T") { columns = []; let at = 2; const count = data.readInt16BE(0); for (let i = 0; i < count; i++) { const end = data.indexOf(0, at); columns.push(data.toString("utf8", at, end)); at = end + 19; } }
      if (type === "D") { const row = {}; let at = 2; for (const name of columns) { const size = data.readInt32BE(at); at += 4; row[name] = size < 0 ? null : data.toString("utf8", at, at + size); if (size >= 0) at += size; } rows.push(row); }
      if (type === "E") { let at = 0, message = "Owned PostgreSQL query failed"; while (at < data.length && data[at]) { const field = String.fromCharCode(data[at++]), end = data.indexOf(0, at); if (field === "M") message = data.toString("utf8", at, end); at = end + 1; } error = Error(message); }
      if (type === "Z") { const done = current; current = null; if (done) { if (error) done.reject(error); else done.accept(rows); } dispatch(); }
    }
  });
  return { ready, query: text => new Promise((accept, reject) => { queue.push({ text, accept, reject }); dispatch(); }), close: () => socket.end() };
}
const quote = value => value === null ? "NULL" : "'" + String(value).replaceAll("'", "''") + "'";
let started = false, connection;
async function main() {
  const port = await freePort();
  try {
    command("initdb", ["-D", directory, "-A", "trust", "-U", "postgres", "--encoding=UTF8", "--locale=C", "--no-instructions"]);
    command("pg_ctl", ["-D", directory, "-l", path.join(directory, "fixture.log"), "-o", `-h 127.0.0.1 -p ${port} -c max_connections=5 -c shared_buffers=32MB`, "-w", "start"], { stdio: "ignore" }); started = true;
    connection = pgConnection(port); await connection.ready;
    const db = { waitReady: Promise.resolve(), exec: text => connection.query(text), close: async () => {},
      query: async (text, params = []) => { text = text.replace(/\$(\d+)/g, (_, n) => quote(params[Number(n) - 1])).trim().replace(/;$/, "");
        if (!/^(SELECT|WITH)\b/i.test(text)) { await connection.query(text); return { rows: [] }; }
        const result = await connection.query(`SELECT coalesce(json_agg(r),'[]') value FROM (${text}) r;`); return { rows: JSON.parse(result[0].value) }; } };
    const tests = [], before = [], each = [], after = [];
    const it = (name, work) => tests.push({ name, work }); it.each = values => (name, work) => values.forEach(value => it(name.replace("%s", value), () => work(value)));
    const expect = value => ({ toBe: expected => assert.equal(value, expected), toContain: text => assert(value.includes(text)), toHaveLength: length => assert.equal(value.length, length),
      rejects: { toThrow: async text => assert.rejects(value, text ? error => error.message.includes(text) : undefined) } });
    const vitest = { beforeAll: fn => before.push(fn), beforeEach: fn => each.push(fn), afterAll: fn => after.push(fn), describe: (_name, fn) => fn(), it, expect };
    const file = path.resolve("src/lib/__tests__/legacy-shift-recovery-sql.test.ts"), compiler = require("typescript");
    const source = fs.readFileSync(file, "utf8").replaceAll("import.meta.url", JSON.stringify(pathToFileURL(file).href));
    const output = compiler.transpileModule(source, { compilerOptions: { module: compiler.ModuleKind.CommonJS, target: compiler.ScriptTarget.ES2022 } }).outputText;
    const fixture = new Module(file + ".cjs", module); fixture.filename = file + ".cjs"; fixture.paths = Module._nodeModulePaths(path.dirname(file));
    const original = fixture.require.bind(fixture); fixture.require = name => name === "vitest" ? vitest : name === "@electric-sql/pglite" ? { PGlite: class { constructor() { return db; } } } : original(name);
    fixture._compile(output.replace("const require =", "const fixtureRequire =").replace(/\brequire\("\.\.\/\.\.\/\.\.\/electron\/db\/schema-registry\.cjs"\)/, 'fixtureRequire("../../../electron/db/schema-registry.cjs")') + "\nmodule.exports.nativeFixture={request,apply,graph};", file + ".cjs");
    for (const hook of before) await hook();
    let passed = 0;
    try {
      for (const t of tests) { for (const hook of each) await hook(); await t.work(); passed++; console.log("PASS native PostgreSQL: " + t.name); }
      const peer = pgConnection(port); await peer.ready;
      try {
        const f = fixture.exports.nativeFixture, reset = async () => { for (const hook of each) await hook(); };
        const delay = () => new Promise(accept => setTimeout(accept, 30));
        const peerCall = r => `SELECT public.pos_sync_recover_legacy_closing('fixture-org','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',${quote(r.raw)},${quote(JSON.stringify(r.proof))}::jsonb,${quote(JSON.stringify(r.authority))}::jsonb) result;`;
        await peer.query("SET request.jwt.claim.role='service_role';SET statement_timeout='3s';");
        await reset(); let r = await f.request();
        await peer.query("BEGIN;INSERT INTO fin62_rollout_preparation.approvals VALUES('00000000-0000-4000-8000-000000000099');");
        await assert.rejects(f.apply(r), error => /lock/.test(error.message)); await peer.query("ROLLBACK;");
        assert.equal((await f.graph())[0].rows[0].status, "OPEN"); passed++; console.log("PASS native concurrency: busy rollout metadata holds recovery without deadlock or write");
        await reset(); r = await f.request();
        await peer.query("BEGIN;INSERT INTO fin62_history_preparation.protected_shifts VALUES('00000000-0000-4000-8000-000000000099','other');");
        await assert.rejects(f.apply(r), error => /lock/.test(error.message)); await peer.query("ROLLBACK;");
        assert.equal((await f.graph())[0].rows[0].status, "OPEN"); passed++; console.log("PASS native concurrency: busy protection metadata holds recovery without deadlock or write");
        await reset(); r = await f.request();
        await connection.query("BEGIN;"); const accepted = await f.apply(r); let finished = false;
        const replay = peer.query(peerCall(r)).then(value => { finished = true; return value; });
        await delay(); assert.equal(finished, false); await connection.query("COMMIT;");
        const reply = JSON.parse((await replay)[0].result); assert.equal(reply.accepted_token, accepted.accepted_token);
        assert.equal((await db.query("SELECT count(*) n FROM pos_sync_private.legacy_shift_recovery_receipts")).rows[0].n, 1);
        passed++; console.log("PASS native concurrency: simultaneous retry waits for actual acceptance and does not duplicate");
        assert.equal(hash(accepted.accepted_graph_text), accepted.accepted_graph_hash);
        const acceptedGraph = JSON.parse(accepted.accepted_graph_text);
        assert.match(acceptedGraph[0].rows[0].closed_at, /\.123457/);
        assert(r.raw.includes(".1234567Z"));
        const covered = accepted.coverage.tables.reduce((n, table) => n + table.rows.length, 0);
        assert.equal(covered, acceptedGraph.reduce((n, part) => n + part.rows.length, 0));
        passed++; console.log("PASS native precision: immutable raw7digit claim, hashed typed6digit graph and complete accepted coverage");
        await reset(); r = await f.request();
        await peer.query("BEGIN;SELECT pg_advisory_xact_lock(hashtextextended('pos-sync-shift:00000000-0000-4000-8000-000000000003',0));SET pos.shift_fn='on';UPDATE shifts SET status='CLOSED',state='CLOSED',closed_at=now();SET pos.shift_fn='';");
        const conflict = f.apply(r).then(() => { throw Error("stale review accepted"); }, error => error); await delay(); await peer.query("COMMIT;");
        assert.match((await conflict).message, /LEGACY_RECOVERY_CLOUD_CHANGED/);
        passed++; console.log("PASS native concurrency: web closure winning the shift lock invalidates the reviewed OPEN witness");
      } finally { peer.close(); }
    }
    finally { for (const hook of after) await hook(); }
    console.log(`PASS ${passed} cases on ${command("postgres", ["--version"]).trim()}; same SQL cases plus native concurrency/precision, real canonical shift triggers enabled; no operator data.`);
  } finally {
    connection?.close();
    if (started) command("pg_ctl", ["-D", directory, "-m", "fast", "-w", "stop"], { stdio: "ignore" });
    assert(path.resolve(directory).startsWith(base + path.sep)); fs.rmSync(directory, { recursive: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
