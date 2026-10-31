// Disposable loopback PostgreSQL only. This harness creates its own cluster;
// it accepts a binaries directory, never an existing database URL or profile.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
const argument = process.argv.indexOf("--postgres-bin");
assert(argument >= 0 && process.argv[argument + 1], "Use --postgres-bin <portable PostgreSQL bin directory>");
const binaryDirectory = resolve(process.argv[argument + 1]);
const executable = name => join(binaryDirectory, `${name}${process.platform === "win32" ? ".exe" : ""}`);
const cache = join(root, "node_modules", ".cache");
await mkdir(cache, { recursive: true });
const fixture = await mkdtemp(join(cache, "transfer-dispatch-race-"));
const data = join(fixture, "data"), log = join(fixture, "postgres.log");
const environment = { ...process.env };
for (const key of Object.keys(environment)) if (/^PG/i.test(key) || key === "DATABASE_URL") delete environment[key];
const run = promisify(execFile);
const control = args => new Promise((accept, reject) => {
  // PostgreSQL outlives pg_ctl. Do not wait for inherited output pipe handles.
  const child = spawn(executable("pg_ctl"), args, { env: environment, windowsHide: true, stdio: "ignore" });
  child.once("error", reject);
  child.once("exit", code => code === 0 ? accept() : reject(new Error(`Fixture pg_ctl exited ${code}; see ${log}`)));
});
const children = new Set();
let started = false;
const port = await new Promise((accept, reject) => {
  const probe = createServer(); probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => { const selected = probe.address().port; probe.close(() => accept(selected)); });
});
const pause = () => new Promise(accept => setTimeout(accept, 20));
const quote = value => `'${String(value).replaceAll("'", "''")}'`;

function session(name = `transfer-fixture-${randomUUID()}`) {
  const child = spawn(executable("psql"), ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
    "-h", "127.0.0.1", "-p", String(port), "-U", "transfer_fixture", "-d", "postgres"], {
    windowsHide: true, env: { ...environment, PGAPPNAME: name }, stdio: ["pipe", "pipe", "pipe"],
  });
  children.add(child);
  const state = { output: "", error: "", done: false };
  child.stdout.on("data", value => { state.output += value; });
  child.stderr.on("data", value => { state.error += value; });
  child.stdin.on("error", () => {});
  const finished = new Promise(accept => {
    child.once("error", error => { state.error += error.message; state.done = true; children.delete(child); accept({ code: -1, ...state }); });
    child.once("close", code => { state.done = true; children.delete(child); accept({ code, ...state }); });
  });
  return { child, state, finished };
}

async function query(sql, name) {
  const current = session(name); current.child.stdin.end(`${sql}\n`);
  const result = await current.finished;
  if (result.code !== 0) throw new Error(result.error || `Fixture psql exited ${result.code}`);
  return result.output.trim();
}

async function holder(sql) {
  const current = session(); current.child.stdin.write(`BEGIN;\n${sql}\nSELECT 'FIXTURE_READY';\n`);
  const deadline = Date.now() + 5000;
  while (!current.state.output.includes("FIXTURE_READY")) {
    if (current.state.done || Date.now() > deadline) throw new Error(`Holder did not become ready: ${current.state.error}`);
    await pause();
  }
  return async action => {
    current.child.stdin.end(`${action};\n\\q\n`);
    const result = await current.finished; assert.equal(result.code, 0, result.error);
  };
}

async function blocked(name) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const waiting = await query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(name)} AND cardinality(pg_blocking_pids(pid))>0);`);
    if (waiting === "t") return;
    await pause();
  }
  throw new Error("Expected independent PostgreSQL session to wait for the competing transaction");
}


import {fixtureSql,migration,ids,seedSql,dispatchSql,webIdentity,nativeIdentity,lineSql,liveOverlaySql} from './fixtures/transfer-dispatch-fixture.mjs';

let passed=0;
const jsonSql=sql=>sql.replace(/;\s*$/,'');
const scalar=async sql=>JSON.parse(await query(sql));
const stock=()=>scalar(`SELECT stock_by_store FROM products WHERE id='${ids.product}';`);
async function test(name,work,seed={}){await query(seedSql(seed));await work();passed++;console.log('PASS '+name);}
async function waitThenRelease(command,finish,action='COMMIT'){
 const name=`transfer-wait-${randomUUID()}`;
 const pending=query(command,name).then(value=>({value}),error=>({error}));
 await blocked(name);await finish(action);return pending;
}
const cloneChild=`INSERT INTO stock_transfers(id,ref,kind,status,from_store_id,to_store_id,source_request_id,created_by,approved_by,approved_at) SELECT '${ids.child2}','ST-SECOND',kind,status,from_store_id,to_store_id,source_request_id,created_by,approved_by,approved_at FROM stock_transfers WHERE id='${ids.child}';INSERT INTO stock_transfer_items(transfer_id,product_id,quantity,quantity_approved) VALUES('${ids.child2}','${ids.product}',3,3);`;
try{
 await run(executable('initdb'),['-D',data,'--auth=trust','--username=transfer_fixture','--no-locale','--encoding=UTF8'],{env:environment,windowsHide:true});
 await control(['-D',data,'-l',log,'-o',`-h 127.0.0.1 -p ${port} -F -c max_connections=10 -c shared_buffers=16MB`,'-w','start']);started=true;
 await query(fixtureSql);
 const live=process.argv.indexOf('--live-definitions');
 if(live>=0){const overlay=await liveOverlaySql(process.argv[live+1],process.argv[live+2]);await query(overlay.sql);}
 await query('BEGIN;'+migration+'COMMIT;');
 for(const action of ['COMMIT','ROLLBACK'])await test('same-transfer waiting retry after '+action,async()=>{
  const finish=await holder(webIdentity+dispatchSql());
  const result=await waitThenRelease(webIdentity+dispatchSql(),finish,action);assert.equal(result.error,undefined);
  const lines=result.value.trim().split('\n'),p=JSON.parse(lines.at(-1));assert.equal(p.replayed,action==='COMMIT');
  assert.equal((await stock()).A,8);assert.equal(await query('SELECT count(*) FROM item_activity_logs;'),'1');
 });
 await test('two children for one request serialize; only the first sends',async()=>{
  const finish=await holder(webIdentity+dispatchSql());
  const result=await waitThenRelease(webIdentity+dispatchSql(2,ids.child2),finish);assert.match(result.error?.message??'Unexpected success',/TRANSFER_REQUEST_INVALID/);
  assert.equal((await stock()).A,8);assert.equal(await query(`SELECT status FROM stock_transfers WHERE id='${ids.child2}'`),'approved');
 },{extra:cloneChild});
 await test('different direct transfers cannot both consume the same last units',async()=>{
  const finish=await holder(webIdentity+dispatchSql());
  const result=await waitThenRelease(webIdentity+dispatchSql(2,ids.child2),finish);assert.match(result.error?.message??'Unexpected success',/Short by 1/);
  assert.equal((await stock()).A,1);assert.equal(await query('SELECT count(*) FROM item_activity_logs;'),'1');
 },{request:false,stock:3,extra:cloneChild});
 for(const native of [false,true])await test((native?'native':'browser')+' rechecks source branch after a concurrent header change',async()=>{
  const finish=await holder(`UPDATE stock_transfers SET from_store_id='C' WHERE id='${ids.child}';`);
  const result=await waitThenRelease((native?nativeIdentity:webIdentity)+dispatchSql(2,ids.child,native),finish);
  assert.match(result.error?.message??'Unexpected success',/sending location/);assert.equal((await stock()).A,10);assert.equal(await query('SELECT count(*) FROM item_activity_logs;'),'0');
 },{request:false});
 await test('a concurrent item product replacement is locked and revalidated before picking',async()=>{
  const finish=await holder(`UPDATE stock_transfer_items SET product_id='${ids.product2}' WHERE transfer_id='${ids.child}';`);
  const result=await waitThenRelease(webIdentity+dispatchSql(),finish);assert.match(result.error?.message??'Unexpected success',/TRANSFER_DISPATCH_CONFLICT/);
  assert.equal((await stock()).A,10);assert.equal(await query('SELECT count(*) FROM item_activity_logs;'),'0');
 },{request:false});
 await test('new item insertion waits for the dispatch header lock through the real parent FK',async()=>{
  const finish=await holder(webIdentity+dispatchSql());
  const result=await waitThenRelease(`INSERT INTO stock_transfer_items(transfer_id,product_id,quantity,quantity_approved) VALUES('${ids.child}','${ids.product2}',1,1);`,finish);
  assert.equal(result.error,undefined);assert.equal((await stock()).A,8);assert.equal(await query('SELECT count(*) FROM item_activity_logs;'),'1');
 },{request:false});
 console.log(`${passed} passed real independent-session PostgreSQL transfer dispatch races; no existing database used.`);
} finally {
  for (const child of children) { child.stdin.destroy(); child.kill(); }
  if (started) await control(["-D", data, "-m", "immediate", "-w", "stop"]);
  assert.equal(dirname(resolve(fixture)), resolve(cache)); assert(basename(fixture).startsWith("transfer-dispatch-race-"));
  await rm(fixture, { recursive: true, force: true });
}
