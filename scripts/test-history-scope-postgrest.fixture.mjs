// Requires the caller's owned native fixture. No external URL or credentials.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve, join, sep } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { createHmac, randomBytes } from "node:crypto";
export async function verifyHistoryScopePostgrest(db, { A, B, OPS, OTHER, MAN, id }, { legacy = false, staged = false } = {}) {
  const exe = process.env.POSTGREST_TEST_EXE;
  assert(exe);
  assert.equal(execFileSync(exe, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 10000 }).trim(), "PostgREST 16.5");
  const { port: pgPort, directory } = db.historyRest ?? {};
  assert(Number.isInteger(pgPort) && pgPort > 0 && resolve(directory).startsWith(resolve(".tmp/seven-shift-summary-tests") + sep));
  const port = await new Promise((yes, no) => { const server = createServer(); server.once("error", no); server.listen(0, "127.0.0.1", () => { const value = server.address().port; server.close(() => yes(value)); }); });
  const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
  if (!legacy && !staged) await db.exec("INSERT INTO public.change_history(id,organization_id,entity_type,entity_id,action,new_value,revision,scope_type,scope_id,source_application,server_timestamp) SELECT ('eeeeeeee-eeee-4eee-8eee-'||lpad(n::text,12,'0'))::uuid,'default','products',n::text,'insert','{\"safe\":1}',1,'BRANCH'," + quote(A) + ",'fixture',now() FROM generate_series(1,2007)n;");
  const secret = randomBytes(48).toString("hex"), encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = role => { const value = encode({ alg: "HS256", typ: "JWT" }) + "." + encode({ role, exp: Math.floor(Date.now() / 1000) + 600 }); return value + "." + createHmac("sha256", secret).update(value).digest("base64url"); };
  const config = join(directory, "history-scope-postgrest.conf");
  writeFileSync(config, [
    'db-uri = "postgresql://postgres@127.0.0.1:' + pgPort + '/postgres?sslmode=disable"',
    'db-schemas = "public"', 'db-anon-role = "anon"', "db-max-rows = 1000", "db-pool = 1", "db-channel-enabled = false",
    'server-host = "127.0.0.1"', "server-port = " + port, 'jwt-secret = "' + secret + '"', 'log-level = "error"', ""
  ].join("\n"));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^PG|^PGRST_/i.test(key) || key === "DATABASE_URL") delete env[key];
  let child, log = "", passed = 0;
  const origin = "http://127.0.0.1:" + port;
  const request = (name, body, role = "service_role") => fetch(origin + "/rpc/" + name, { method: "POST", headers: { "content-type": "application/json", "accept-encoding": "identity", ...(role ? { authorization: "Bearer " + token(role) } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const common = { p_organization_id: "default", p_branch_id: A, p_terminal_id: OPS, p_keep_commerce: false };
  const check = async (name, work) => { await work(); passed++; console.log("PASS actual PostgREST " + name); };
  try {
    child = spawn(exe, [config], { env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    child.stderr.on("data", bytes => log = (log + bytes).slice(-2000));
    let ready = false;
    for (let n = 0; n < 100; n++) { assert.equal(child.exitCode, null, log); try { const response = await fetch(origin + "/", { signal: AbortSignal.timeout(500) }); if (response.ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 50)); }
    assert(ready, "Owned PostgREST readiness timed out");
    if (legacy || staged) {
      await check((staged ? "additive stage" : "pre-upgrade") + " leaves the installed v2 handshake absent for two Operations tills while v1 is unchanged", async () => {
        for (const [branch, terminal] of [[A, OPS], [B, OTHER]]) {
          const args = { ...common, p_branch_id: branch, p_terminal_id: terminal, p_action: "begin", p_after_id: null, p_upper_id: null, p_limit: 1000 };
          const absent = await request("pos_sync_history_index_v2", args);
          assert.equal(absent.status, 404);
          const failure = await absent.json();
          assert.equal(failure.code, "PGRST202");
          assert.equal(failure.message, "Could not find the function public.pos_sync_history_index_v2(p_action, p_after_id, p_branch_id, p_keep_commerce, p_limit, p_organization_id, p_terminal_id, p_upper_id) in the schema cache");
          assert(failure.hint === null || !failure.hint.includes("public.pos_sync_history_index_v2"));
          const prior = await request("pos_sync_history_index_v1", args);
          assert.equal(prior.status, 200);
          const wire = await prior.json();
          assert.equal(wire.protocol, "history-index-v1");
          assert.equal(wire.ids.length, 13);
        }
      });
      if (staged) {
        await check("new bounded history routes preserve exact wire contracts and branch scope", async () => {
          for (const [branch, terminal, expected] of [[A,OPS,[id(1),id(9)]],[B,OTHER,[id(2)]]]) {
            const scope={...common,p_branch_id:branch,p_terminal_id:terminal};
            const index = await request("pos_sync_history_index_v3", {...scope,p_action:"begin",p_limit:1000});
            assert.equal(index.status,200,await index.clone().text());assert.equal(index.headers.get("x-pos-history-reconcile-version"),"2");
            assert.equal(index.headers.get("x-pos-history-reconcile-kind"),"index");
            assert.deepEqual((await index.json()).ids,expected);
            const exact=await request("pos_sync_history_rows_v3",{...scope,p_ids:expected,p_max_bytes:2097152});
            assert.equal(exact.status,200,await exact.clone().text());assert.equal(exact.headers.get("x-pos-history-reconcile-version"),"2");
            assert.equal(exact.headers.get("x-pos-history-reconcile-kind"),"rows");
            const exactRows=(await exact.json()).rows;
            assert.deepEqual(exactRows.map(row=>row.id),expected);assert.equal(exactRows[0].revision,"9007199254740993");
            const page=await request("pos_sync_history_page_v2",{...scope,p_after_cursor:null,p_history_days:7300,p_max_bytes:2097152});
            assert.equal(page.status,200,await page.clone().text());assert.equal(page.headers.get("x-pos-history-projection"),"1");
            const text=await page.text(),value=JSON.parse(text);
            assert.equal(Number(page.headers.get("x-pos-history-bytes")),Buffer.byteLength(text));
            assert.equal(Number(page.headers.get("x-pos-history-rows")),expected.length);
            assert.deepEqual(value.rows.map(row=>row.id),expected);assert.equal(value.cursor,null);assert(!text.includes("PRIVATE"));
            const {p_keep_commerce:keepCommerce,...countArgs}=scope;
            assert.equal(keepCommerce,false);
            const counts=await request("pos_sync_counts_history_v2",{...countArgs,p_history_days:7300});
            assert.equal(counts.status,200,await counts.clone().text());
            const values=await counts.json();
            assert.equal(values.length,70);
            assert.equal(String(values.find(row=>row.table_name==="change_history").row_count),String(expected.length));
          }
        });
        await check("staged feed attests an exact empty page and Management admits its full company only", async () => {
          const feed=await request("pos_sync_feed_page_v2",{...common,p_after_cursor:0,p_max_bytes:2097152});
          assert.equal(feed.status,200,await feed.clone().text());assert.equal(await feed.text(),"[]");
          assert.equal(feed.headers.get("x-pos-feed-projection"),"1");assert.equal(feed.headers.get("x-pos-feed-bytes"),"2");
          assert.equal(feed.headers.get("x-pos-feed-rows"),"0");assert.equal(feed.headers.get("x-pos-feed-continue"),"0");
          const management=await request("pos_sync_history_index_v3",{...common,p_branch_id:B,p_terminal_id:MAN,p_action:"begin",p_limit:1000});
          assert.equal(management.status,200);const company=await management.json();
          assert.equal(company.history_scope,"company");assert(company.ids.includes(id(3)));assert(!company.ids.includes(id(11)));
        });
        await check("staged service readers deny unauthenticated, staff and wrong-branch requests", async () => {
          const args={...common,p_action:"begin",p_limit:1000};
          for (const [role,status] of [[null,401],["authenticated",403]]) {
            const denied=await request("pos_sync_history_index_v3",args,role);assert.equal(denied.status,status,await denied.text());
            const page=await request("pos_sync_history_page_v2",{...common,p_max_bytes:2097152},role);assert.equal(page.status,status,await page.text());
          }
          const foreign=await request("pos_sync_history_index_v3",{...args,p_branch_id:B});assert.equal(foreign.status,400,await foreign.text());
        });
      }
      return passed;
    }
    await check("v2 scalar pages enumerate every own-branch UUID beyond the server 1000-row cap", async () => {
      let after = null, upper = null, seen = [];
      for (let page = 0; page < 10; page++) {
        const response = await request("pos_sync_history_index_v2", { ...common, p_action: upper === null ? "begin" : "page", p_after_id: after, p_upper_id: upper, p_limit: 1000 });
        assert.equal(response.status, 200, await response.clone().text()); assert.equal(response.headers.get("x-pos-history-reconcile-version"), "2");
        const value = await response.json(); assert.equal(value.policy, "branch-history-v1"); assert.equal(value.history_scope, "branch");
        seen.push(...value.ids); upper = value.upper_id; after = value.next_id; if (value.complete) break;
      }
      assert.equal(seen.length, 2009); assert.equal(new Set(seen).size, 2009); assert(!seen.includes(id(2))); assert(!seen.includes(id(3)));
      const finish = await request("pos_sync_history_index_v2", { ...common, p_action: "finish", p_after_id: null, p_upper_id: upper, p_limit: 1000 });
      assert.equal(finish.status, 200); assert.equal((await finish.json()).range_count, "2009");
    });
    await check("legacy v1 remains narrowed with its original envelope shape", async () => {
      const response = await request("pos_sync_history_index_v1", { ...common, p_action: "begin", p_limit: 1000 });
      assert.equal(response.status, 200); assert.equal(response.headers.get("x-pos-history-reconcile-version"), "1"); const value = await response.json();
      assert.equal(value.protocol, "history-index-v1"); assert(!Object.hasOwn(value, "policy")); assert(!Object.hasOwn(value, "history_scope")); assert(!value.ids.includes(id(2)));
    });
    await check("v2 rows preserve exact numbers, timestamp and current privacy", async () => {
      const response = await request("pos_sync_history_rows_v2", { ...common, p_ids: [id(1), id(9)], p_max_bytes: 2097152 });
      assert.equal(response.status, 200, await response.clone().text()); const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(Number(response.headers.get("x-pos-history-reconcile-bytes")), bytes.length); assert.equal(response.headers.get("x-pos-history-reconcile-rows"), "2");
      const value = JSON.parse(bytes.toString("utf8")); assert.equal(value.policy, "branch-history-v1"); assert.equal(value.history_scope, "branch");
      assert.equal(value.rows[0].revision, "9007199254740993"); assert.match(value.rows[0].new_value_json, /9007199254740993/); assert(!value.rows[0].new_value_json.includes("ecom_price")); assert(!value.rows[0].old_value_json.includes("PRIVATE"));
    });
    await check("foreign rows, mixed pages and nonexistent rows produce the same non-disclosing refusal", async () => {
      for (const ids of [[id(2)], [id(3)], [id(1), id(2)], [id(999)]]) {
        const response = await request("pos_sync_history_rows_v2", { ...common, p_ids: ids }); assert.equal(response.status, 400);
        const value = await response.json(); assert.equal(value.code, "P0001"); assert.equal(value.message, "HISTORY_INDEX_ROW_MISSING");
      }
    });
    await check("verified Management gets all company scopes and another organization stays excluded", async () => {
      const response = await request("pos_sync_history_index_v2", { ...common, p_branch_id: B, p_terminal_id: MAN, p_action: "begin", p_limit: 1000 });
      assert.equal(response.status, 200); const value = await response.json(); assert.equal(value.history_scope, "company");
      assert(value.ids.includes(id(2))); assert(value.ids.includes(id(3))); assert(value.ids.includes(id(4))); assert(!value.ids.includes(id(11)));
    });
    await check("Operations cannot choose another branch and authenticated/anonymous callers cannot reach the readers", async () => {
      const denied = await request("pos_sync_history_index_v2", { ...common, p_branch_id: B, p_action: "begin" }); assert.equal(denied.status, 400);
      for (const [role, status] of [[null, 401], ["authenticated", 403]]) { const response = await request("pos_sync_history_index_v2", { ...common, p_action: "begin" }, role); assert.equal(response.status, status, await response.text()); }
    });
    return passed;
  } finally {
    if (child && child.exitCode === null) { const closed = new Promise(resolve => child.once("exit", resolve)); child.kill(); await closed; }
  }
}
