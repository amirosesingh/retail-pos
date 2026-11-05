// Isolated loopback-only graph wire/CPU acceptance. No cloud credentials or deployment.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
const root = fileURLToPath(new URL("../", import.meta.url));
const workerd = createRequire(import.meta.url)("workerd").default;
const terminal = "00000000-0000-4000-8000-000000000001",
  branch = "00000000-0000-4000-8000-00000000000a",
  foreign = "00000000-0000-4000-8000-00000000000b",
  shift = "00000000-0000-4000-8000-000000000002",
  proof = "a".repeat(64);
const operation = {
  terminalToken: terminal,
  deviceBindingProof: proof,
  sqlServerShiftGraph: { organizationId: "default", branchId: branch, shiftId: shift },
};
let payload = "",
  rpcStatus = 200,
  rpcCalls = 0,
  child,
  stderr = "";
const temporary = await mkdtemp(join(tmpdir(), "pos-exact-graph-"));
const listen = (server) =>
  new Promise((done) => server.listen(0, "127.0.0.1", () => done(server.address().port)));
const upstream = createServer((req, res) => {
  let value;
  if (req.url.startsWith("/rest/v1/terminal_tokens?"))
    value = [
      {
        id: terminal,
        platform: "pc",
        status: "used",
        location_id: branch,
        is_claimed: true,
        revoked_at: null,
        claim_proof: proof,
        claimed_proof_hash: proof,
        management_sync_enabled: false,
      },
    ];
  else if (req.url.startsWith("/rest/v1/stores?")) value = [{ id: branch }];
  else if (req.url.startsWith("/rest/v1/rpc/pos_sync_shift_graph")) {
    rpcCalls++;
    res.writeHead(rpcStatus, { "Content-Type": "application/json" });
    res.end(payload);
    return;
  } else {
    res.writeHead(500);
    res.end("Unexpected isolated upstream path");
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
});
const cpu = () =>
  process.platform === "win32"
    ? Number(
        execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `(Get-Process -Id ${child.pid} -ErrorAction Stop).TotalProcessorTime.TotalMilliseconds.ToString([Globalization.CultureInfo]::InvariantCulture)`,
          ],
          { encoding: "utf8", windowsHide: true, timeout: 10000 },
        ).trim(),
      )
    : null;
try {
  const upstreamPort = await listen(upstream);
  // Committed fixture keeps shallow CI checkouts independent of Git history.
  const baselineRedactor = (
    await readFile(resolve(root, "scripts/fixtures/shift-graph-redaction-4590d63b.ts.txt"), "utf8")
  )
    .replaceAll("redactOwnedParsedSyncDownload", "baselineRedact")
    .replaceAll("export function", "function");
  const result = await build({
    stdin: {
      contents: `import{handleSyncRequest}from${JSON.stringify(resolve(root, "src/lib/sync-endpoint.server.ts").replaceAll("\\", "/"))};import {parseExactJson,stringifyExactJson,isExactNumber} from ${JSON.stringify(resolve(root, "electron/sync/shift-recovery-exact.mjs").replaceAll("\\", "/"))};import{redactOwnedParsedSyncDownload as redact}from ${JSON.stringify(resolve(root, "src/lib/sync-download-redaction.ts").replaceAll("\\", "/"))};
${baselineRedactor}
const baselineProject=value=>{const{tables,...envelope}=value;return{...baselineRedact(envelope,"",false),tables:tables.map(part=>baselineRedact(part,part.table,false))}};
const project=value=>{const{tables,...envelope}=value;return{...redact(envelope,"",false),tables:tables.map(part=>redact(part,part.table,false))}};
export default{async fetch(request){const path=new URL(request.url).pathname;if(path==="/health")return new Response("ready");if(path==="/profile"){const text=await request.text();const timings={oldJsonMs:0,currentOrdinaryMs:0,nativeStringifyBenchmarkMs:0,exactParseMs:0,exactRedactMs:0,exactStringifyMs:0};for(let i=0;i<10;i++){let start=performance.now();JSON.stringify(baselineProject(JSON.parse(text)));timings.oldJsonMs+=performance.now()-start;start=performance.now();JSON.stringify(project(JSON.parse(text)));timings.currentOrdinaryMs+=performance.now()-start;start=performance.now();let value=parseExactJson(text);timings.exactParseMs+=performance.now()-start;start=performance.now();value=project(value);timings.exactRedactMs+=performance.now()-start;start=performance.now();stringifyExactJson(value);timings.exactStringifyMs+=performance.now()-start;start=performance.now();const native=JSON.stringify(value,(_key,item)=>isExactNumber(item)?JSON.rawJSON(item.raw):item);timings.nativeStringifyBenchmarkMs+=performance.now()-start;if(native!==stringifyExactJson(value))throw Error("Native benchmark changed exact output");}let source=false;JSON.parse("1",(_key,value,context)=>{source=context?.source==="1";return value;});return Response.json({...Object.fromEntries(Object.entries(timings).map(([key,value])=>[key,value/10])),nativeSource:source,nativeRawJson:typeof JSON.rawJSON==="function"});}return handleSyncRequest(request)}};`,
      resolveDir: root,
      sourcefile: "exact-graph-entry.ts",
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    logLevel: "silent",
    external: ["node:*"],
    plugins: [
      {
        name: "isolated-runtime",
        setup(b) {
          b.onResolve({ filter: /external-supabase-config$/ }, () => ({
            path: "config",
            namespace: "fixture",
          }));
          b.onResolve({ filter: /commerce-sync-readiness\.server$/ }, () => ({
            path: "readiness",
            namespace: "fixture",
          }));
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents:
              args.path === "config"
                ? `export const supabaseConfig=()=>({url:"http://127.0.0.1:${upstreamPort}",key:"isolated-public"});export const runtimeEnvValue=(name)=>name.includes("SERVICE")?"isolated-service":undefined;`
                : "export const commerceSyncIsolationReady=async()=>true;",
            loader: "js",
          }));
        },
      },
    ],
  });
  await writeFile(join(temporary, "worker.mjs"), result.outputFiles[0].text);
  const probe = createServer();
  const port = await listen(probe);
  await new Promise((done) => probe.close(done));
  await writeFile(
    join(temporary, "config.capnp"),
    `using Workerd=import "/workerd.capnp";const config:Workerd.Config=(services=[(name="main",worker=(modules=[(name="worker.mjs",esModule=embed "worker.mjs")],compatibilityDate="2026-01-01",compatibilityFlags=["nodejs_compat"])),(name="internet",network=(allow=["local"]))],sockets=[(name="http",address="127.0.0.1:${port}",http=(),service="main")]);`,
  );
  child = spawn(
    workerd,
    ["serve", "-I", resolve(root, "node_modules/workerd"), join(temporary, "config.capnp")],
    { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
  );
  child.stderr.on("data", (chunk) => (stderr += chunk));
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    if (child.exitCode !== null) break;
    await new Promise((done) => setTimeout(done, 50));
  }
  assert(ready, stderr);
  const request = (body = operation) =>
    fetch(`http://127.0.0.1:${port}/api/public/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  const row =
    '{"amount":648.00000000000000000001,"integer":900719925474099312345,"detail":{"nested":[1.0000000000000000001,0,1e-20],"raw":"__RAW_NUMBER_0__","product":{"table_name":"products","ecom_price":1.123456789,"price":3.00000000000000001},"token":{"table_name":"terminal_tokens","claim_proof":"never-download","status":"used"}}}';
  const graph = (rows) =>
    ' {"ok":true,"shiftGraphVersion":1,"graphToken":"opaque","tables":[{"table":"shift_close_events","rows":[' +
    rows +
    "]}]}";
  const results = [];
  for (const count of [1, 100, 2000]) {
    payload = graph(Array(count).fill(row).join(","));
    const perform = async () => {
      const response = await request();
      const text = await response.text();
      assert.equal(response.status, 200, text);
      assert.equal(
        response.headers.get("X-POS-Shift-Graph-Exact"),
        Buffer.byteLength(payload) <= 32 * 1024 ? "1" : null,
      );
      assert.equal(
        text.includes("648.00000000000000000001"),
        Buffer.byteLength(payload) <= 32 * 1024,
      );
      assert.equal(text.includes("900719925474099312345"), Buffer.byteLength(payload) <= 32 * 1024);
      assert(text.includes('"raw":"__RAW_NUMBER_0__"'));
      assert(!text.includes("never-download"));
      assert(!text.includes("ecom_price"));
      assert.equal(JSON.parse(text).tables[0].rows.length, count);
    };
    await perform();
    const before = cpu(),
      started = performance.now(),
      repetitions = count === 2000 ? 10 : 30;
    for (let n = 0; n < repetitions; n++) await perform();
    const after = cpu();
    const phases = await (
      await fetch(`http://127.0.0.1:${port}/profile`, { method: "POST", body: payload })
    ).json();
    results.push({
      strategy:
        Buffer.byteLength(payload) <= 32 * 1024 ? "bounded-exact-proof" : "ordinary-no-proof",
      phases,
      rows: count,
      bytes: Buffer.byteLength(payload),
      requests: repetitions,
      processCpuMeanMs: before === null ? null : (after - before) / repetitions,
      wallMeanMs: (performance.now() - started) / repetitions,
    });
  }
  for (const bad of [
    '{"a":1,"a":2}',
    graph('{"amount":01}'),
    graph('{"nested":' + "[".repeat(129) + "1" + "]".repeat(129) + "}"),
    graph(Array(2001).fill("{}").join(",")),
  ]) {
    payload = bad;
    const response = await request();
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("X-POS-Shift-Graph-Exact"), null);
    assert.equal((await response.json()).code, "ESHIFT_GRAPH_PROTOCOL");
  }
  payload = graph(row);
  const calls = rpcCalls;
  assert.equal(
    (
      await request({
        ...operation,
        sqlServerShiftGraph: { ...operation.sqlServerShiftGraph, branchId: foreign },
      })
    ).status,
    403,
  );
  assert.equal(rpcCalls, calls);
  rpcStatus = 503;
  payload = '{"code":"upstream-error"}';
  const failed = await request();
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get("X-POS-Shift-Graph-Exact"), null);
  assert.equal(await failed.text(), payload);
  console.log(
    JSON.stringify({
      runtime: execFileSync(workerd, ["--version"], { encoding: "utf8", windowsHide: true }).trim(),
      wireChecks: {
        exactNumbers: true,
        privacy: true,
        malformed: 4,
        foreignBranchDenied: true,
        errorContract: true,
      },
      measurement:
        "Loopback workerd process CPU averages including background/GC; not Cloudflare billed CPU, cold-start or deployment acceptance",
      results,
    }),
  );
} finally {
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise((done) => child.once("exit", done));
  }
  await new Promise((done) => upstream.close(done));
  assert(temporary.startsWith(join(tmpdir(), "pos-exact-graph-")));
  await rm(temporary, { recursive: true, force: true });
}
