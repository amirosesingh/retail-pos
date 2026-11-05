"use strict";
// Opt-in, owned ephemeral PostgreSQL only. No DB URL, POS profile or credential.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), net = require("node:net");
const { execFileSync } = require("node:child_process"), Module = require("node:module");
const hash = value => require("node:crypto").createHash("sha256").update(value).digest("hex");
assert.deepEqual(process.argv.slice(2), ["--run"]);
const bin = process.env.POSTGRES_TEST_BIN; assert(bin, "Existing portable POSTGRES_TEST_BIN required; no URL accepted");
const base = path.resolve(".tmp/refund-guard-postgres"); fs.mkdirSync(base, { recursive: true });
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
      if (type === "E") { let at = 0, message = "Owned PostgreSQL query failed", code; while (at < data.length && data[at]) { const field = String.fromCharCode(data[at++]), end = data.indexOf(0, at); if (field === "M") message = data.toString("utf8", at, end); if(field === "C") code=data.toString("utf8",at,end); at = end + 1; } error = Object.assign(Error(message),{code}); }
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

    const tests=[],before=[],each=[],after=[];
    const subset=(actual,expected)=>{for(const [k,v] of Object.entries(expected))assert.deepEqual(actual[k],v);};
    const expect=value=>({toBe:expected=>assert.equal(value,expected),toEqual:expected=>assert.deepEqual(value,expected),toMatchObject:expected=>subset(value,expected),
      rejects:{toThrow:async text=>assert.rejects(value,error=>error.message.includes(text)),toMatchObject:async expected=>assert.rejects(value,error=>{subset(error,expected);return true;})}});
    const vitest={beforeAll:fn=>before.push(fn),beforeEach:fn=>each.push(fn),afterAll:fn=>after.push(fn),describe:(_n,fn)=>fn(),it:(name,work)=>tests.push({name,work}),expect};
    const file=path.resolve('src/lib/__tests__/refund-field-trigger-sql.test.ts'),compiler=require('typescript');
    const output=compiler.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:compiler.ModuleKind.CommonJS,target:compiler.ScriptTarget.ES2022}}).outputText;
    const fixture=new Module(file+'.cjs',module);fixture.filename=file+'.cjs';fixture.paths=Module._nodeModulePaths(path.dirname(file));
    const original=fixture.require.bind(fixture);fixture.require=name=>name==='vitest'?vitest:name==='@electric-sql/pglite'?{PGlite:class{constructor(){return db;}}}:original(name);
    fixture._compile(output,file+'.cjs');
    for(const hook of before)await hook();let passed=0;
    try{for(const test of tests){for(const hook of each)await hook();await test.work();passed++;console.log('PASS native PostgreSQL: '+test.name);}}
    finally{for(const hook of after)await hook();}
    console.log('PASS '+passed+' cases on '+command('postgres',['--version']).trim()+'; no operator data or connection.');
  }finally{
    connection?.close();if(started)command('pg_ctl',['-D',directory,'-m','fast','-w','stop'],{stdio:'ignore'});
    assert(path.resolve(directory).startsWith(base+path.sep));fs.rmSync(directory,{recursive:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
