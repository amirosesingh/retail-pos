// Opt-in held-sale acceptance: uniquely owned LocalDB + PostgreSQL + PostgREST.
// No POS profile, saved URL, credential, existing database or real sale is used.
// The small HTTPS-to-local HTTP relay below is a TEST ADAPTER, not a claim that
// the hosted POS relay/device proof, Main IPC wrapper or TLS was exercised.
const assert = require("node:assert/strict");
const { readFileSync, mkdtempSync, rmSync, realpathSync, lstatSync } = require("node:fs");
const { join, resolve, sep, dirname } = require("node:path");
const { tmpdir } = require("node:os");
const { randomUUID, randomBytes, createHmac } = require("node:crypto");
const { execFileSync, spawn } = require("node:child_process");
const { createServer } = require("node:http");
const { createServer: netServer } = require("node:net");
const Module = require("node:module");
const { createLocal } = require("./lib/shift-protocol-integration-fixture.cjs");
const { AggregateRepository } = require("../electron/db/repositories/aggregates.cjs");
const { aggregatePolicy } = require("../electron/db/write-policy.cjs");
const { ChangeReader } = require("../electron/sync/change-reader.cjs");
const { CloudClient } = require("../electron/sync/cloud-client.cjs");
const { PushWorker } = require("../electron/sync/push-worker.cjs");
const { PullWorker } = require("../electron/sync/pull-worker.cjs");
const { CheckpointRepository } = require("../electron/sync/checkpoints.cjs");
const { SyncCoordinator } = require("../electron/sync/coordinator.cjs");
const root = resolve(__dirname, ".."),
  read = (name) => readFileSync(join(root, name), "utf8").replaceAll("\r\n", "\n");
const branch = "A",
  foreign = "B",
  terminal = randomUUID(),
  author = randomUUID(),
  other = randomUUID(),
  admin = randomUUID();
const proof = "a".repeat(64),
  origin = "https://owned-held-sync.invalid";
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const freePort = () =>
  new Promise((yes, no) => {
    const server = netServer();
    server.once("error", no);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => (error ? no(error) : yes(port)));
    });
  });
function sourceFunction(schema, name) {
  const start = schema.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert(start >= 0, name);
  const tail = schema.slice(start),
    tag = tail.match(/\bAS\s+(\$[\w]*\$)/i)?.[1];
  assert(tag, name);
  const first = tail.indexOf(tag),
    end = tail.indexOf(tag + ";", first + tag.length);
  assert(end > first, name);
  return tail.slice(0, end + tag.length + 1);
}
async function createPostgres(directory) {
  const bin = process.env.POSTGRES_TEST_BIN;
  assert(bin, "Provide existing POSTGRES_TEST_BIN; this fixture downloads nothing");
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (/^PG/i.test(key) || key === "DATABASE_URL") delete env[key];
  const command = (name, args, options = {}) =>
    execFileSync(join(bin, name + ".exe"), args, {
      env,
      windowsHide: true,
      encoding: "utf8",
      timeout: 30000,
      ...options,
    });
  const port = await freePort();
  let started = false,
    psql;
  try {
    command("initdb", [
      "-D",
      directory,
      "-A",
      "trust",
      "-U",
      "postgres",
      "--encoding=UTF8",
      "--locale=C",
      "--no-instructions",
    ]);
    command(
      "pg_ctl",
      [
        "-D",
        directory,
        "-l",
        join(directory, "fixture.log"),
        "-o",
        `-h 127.0.0.1 -p ${port} -c max_connections=8 -c shared_buffers=32MB`,
        "-w",
        "start",
      ],
      { stdio: "ignore" },
    );
    started = true;
    psql = spawn(
      join(bin, "psql.exe"),
      [
        "-X",
        "-q",
        "-t",
        "-A",
        "-h",
        "127.0.0.1",
        "-p",
        String(port),
        "-U",
        "postgres",
        "-d",
        "postgres",
      ],
      { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "",
      errors = "",
      pending,
      sequence = 0,
      queue = Promise.resolve();
    psql.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/__HELD_END_([0-9]+)__ ([A-Z0-9]+)\r?\n/);
      if (!match || !pending) return;
      const result = output.slice(0, match.index).trim();
      output = output.slice(match.index + match[0].length);
      const current = pending;
      pending = null;
      setTimeout(() => {
        const error = errors;
        errors = "";
        if (match[2] !== "00000") current.reject(Error(error || match[2]));
        else current.accept(result);
      }, 10);
    });
    psql.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    psql.once("error", (error) => pending?.reject(error));
    psql.once("exit", (code) => pending?.reject(Error("Owned psql exited " + code)));
    const execute = (sql) => {
      const next = queue.then(
        () =>
          new Promise((accept, reject) => {
            assert(!pending);
            pending = { accept, reject };
            psql.stdin.write(
              sql.trimEnd() +
                (sql.trimEnd().endsWith(";") ? "" : ";") +
                "\n\\echo __HELD_END_" +
                ++sequence +
                "__ :SQLSTATE\n",
            );
          }),
      );
      queue = next.catch(() => {});
      return next;
    };
    const quote = (value) =>
      value === null ? "NULL" : "'" + String(value).replaceAll("'", "''") + "'";
    return {
      port,
      exec: execute,
      query: async (sql, values = []) => {
        sql = sql
          .replace(/\$(\d+)/g, (_, index) => quote(values[Number(index) - 1]))
          .trim()
          .replace(/;$/, "");
        if (!/^(SELECT|WITH)\b/i.test(sql)) {
          await execute(sql);
          return { rows: [] };
        }
        return {
          rows: JSON.parse(
            await execute(`SELECT COALESCE(json_agg(f),'[]'::json)::text FROM (${sql}) f;`),
          ),
        };
      },
      close: async () => {
        if (psql && psql.exitCode === null) {
          const exited = new Promise((done) => psql.once("exit", done));
          psql.stdin.end("\\q\n");
          await exited;
        }
        if (started) {
          command("pg_ctl", ["-D", directory, "-m", "fast", "-w", "stop"], { stdio: "ignore" });
          started = false;
        }
      },
    };
  } catch (error) {
    if (psql && psql.exitCode === null) psql.kill();
    if (started)
      command("pg_ctl", ["-D", directory, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
    throw error;
  }
}
async function createCloud(db, registry) {
  const helper = require.resolve("./lib/shift-protocol-integration-fixture.cjs"),
    module = new Module(helper),
    anchor = "const db = new PGlite(), schema = read('supabase/schema.sql');";
  const source = read("scripts/lib/shift-protocol-integration-fixture.cjs");
  assert(source.includes(anchor));
  module.filename = helper;
  module.paths = Module._nodeModulePaths(dirname(helper));
  module.__heldDb = db;
  module._compile(
    source.replace(anchor, "const db = module.__heldDb, schema = read('supabase/schema.sql');"),
    helper,
  );
  await module.exports.createCloud(branch, terminal);
  const schema = read("supabase/schema.sql"),
    held = registry.tables.find((table) => table.cloudTable === "held_orders"),
    fn = (name) => sourceFunction(schema, name);
  const heldStart = schema.indexOf("CREATE TABLE IF NOT EXISTS public.held_orders (");
  assert(heldStart >= 0);
  const heldDefinition = schema.slice(heldStart, schema.indexOf("\n);", heldStart) + 3),
    heldColumns =
      schema.match(/ALTER TABLE public\.held_orders\s+ADD COLUMN IF NOT EXISTS [^;]+;/gi) ?? [];
  await db.exec(
    "DROP TABLE held_orders;" +
      heldDefinition +
      ";" +
      heldColumns.join("\n") +
      "ALTER TABLE held_orders ADD PRIMARY KEY(id);",
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::integer n FROM information_schema.columns WHERE table_schema='public' AND table_name='held_orders'",
      )
    ).rows[0].n,
    held.columns.length,
  );
  for (const name of ["sales", "sale_items", "payment_transactions"])
    await db.exec(
      (
        schema.match(
          new RegExp("ALTER TABLE public\\." + name + "\\s+ADD COLUMN IF NOT EXISTS [^;]+;", "gi"),
        ) ?? []
      ).join("\n"),
    );
  await db.exec("ALTER TABLE payment_transactions ADD PRIMARY KEY(id);");
  await db.exec(`CREATE TYPE public.app_role AS ENUM('admin','manager','staff');ALTER TABLE app_users ALTER COLUMN role TYPE public.app_role USING role::public.app_role;
  CREATE TABLE user_roles(user_id uuid,role public.app_role);CREATE TABLE bookings(id uuid,store_id text,shift_id text);
  ALTER TABLE app_users ADD COLUMN full_name text,ADD COLUMN email text;
  ALTER TABLE terminal_tokens ADD COLUMN management_sync_enabled boolean DEFAULT false;
  CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT NULLIF(current_setting('request.jwt.claims',true),'')::jsonb->>'role'$$;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT (NULLIF(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
  CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT COALESCE(NULLIF(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
  SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
  ${["current_app_user", "is_app_supervisor", "is_supervisor_now", "user_store_id", "is_staff", "is_staff_now", "has_perm", "has_role", "store_visible", "sync_apply_held_orders", "sync_delete_held_orders", "sync_feed_held_orders", "sync_feed_sales", "sync_feed_sale_items", "sync_feed_payment_transactions", "guard_held_ticket_lifecycle", "complete_held_ticket_on_sale", "touch_updated_at"].map(fn).join("\n")}
  ALTER TABLE held_orders ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Branch staff manage held orders" ON public.held_orders TO authenticated USING (((SELECT public.is_staff_now()) AND public.store_visible(store_id))) WITH CHECK (((SELECT public.is_staff_now()) AND public.store_visible(store_id)));
  CREATE TRIGGER held_orders_aa_stale_guard BEFORE UPDATE ON held_orders FOR EACH ROW EXECUTE FUNCTION skip_stale_update();
  CREATE TRIGGER held_orders_ab_lifecycle BEFORE INSERT OR UPDATE ON held_orders FOR EACH ROW EXECUTE FUNCTION guard_held_ticket_lifecycle();
  CREATE TRIGGER held_orders_bump_row_version BEFORE UPDATE ON held_orders FOR EACH ROW EXECUTE FUNCTION bump_row_version();
  CREATE TRIGGER held_orders_touch_updated_at BEFORE UPDATE ON held_orders FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON held_orders FOR EACH ROW EXECUTE FUNCTION sync_feed_held_orders();
  CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON sales FOR EACH ROW EXECUTE FUNCTION sync_feed_sales();
  CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON sale_items FOR EACH ROW EXECUTE FUNCTION sync_feed_sale_items();
  CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON payment_transactions FOR EACH ROW EXECUTE FUNCTION sync_feed_payment_transactions();
  CREATE TRIGGER zz_sales_complete_held_ticket AFTER INSERT ON sales FOR EACH ROW EXECUTE FUNCTION complete_held_ticket_on_sale();
  GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role,anon;
  GRANT SELECT,INSERT,UPDATE ON held_orders TO authenticated;
  GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO service_role;
  REVOKE ALL ON FUNCTION pos_sync_push_aggregate(uuid,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
  GRANT EXECUTE ON FUNCTION pos_sync_push_aggregate(uuid,text,text,text,jsonb) TO service_role;`);
  await db.exec(
    "CREATE FUNCTION fixture_held_access() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT jsonb_build_object('role',auth.role(),'has_uid',auth.uid() IS NOT NULL,'staff',is_staff_now(),'store',user_store_id())$$;",
  );
  for (const [id, role, store] of [
    [author, "staff", branch],
    [other, "staff", foreign],
    [admin, "admin", null],
  ])
    await db.query(
      "INSERT INTO app_users(id,user_id,auth_user_id,role,role_slug,permissions,is_active,store_id) VALUES($1,$1,$1,$2,$2,$3::jsonb,true,$4)",
      [id, role, '{"can_process_sale":true,"can_hold_cart":true}', store],
    );
  await db.query("INSERT INTO stores(id,name) VALUES($1,$1),($2,$2)", [branch, foreign]);
}
async function createRest(db) {
  const exe = process.env.POSTGREST_TEST_EXE;
  assert(exe, "Provide existing POSTGREST_TEST_EXE; this fixture downloads nothing");
  assert.equal(
    execFileSync(exe, ["--version"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
    }).trim(),
    "PostgREST 16.5",
  );
  const port = await freePort(),
    secret = randomBytes(48).toString("hex"),
    env = { ...process.env };
  for (const key of Object.keys(env))
    if (/^PG/i.test(key) || key === "DATABASE_URL") delete env[key];
  Object.assign(env, {
    PGRST_DB_URI: `postgresql://postgres@127.0.0.1:${db.port}/postgres?sslmode=disable`,
    PGRST_DB_SCHEMAS: "public",
    PGRST_DB_ANON_ROLE: "anon",
    PGRST_DB_POOL: "1",
    PGRST_DB_CHANNEL_ENABLED: "false",
    PGRST_DB_CONFIG: "false",
    PGRST_DB_PREPARED_STATEMENTS: "false",
    PGRST_SERVER_HOST: "127.0.0.1",
    PGRST_SERVER_PORT: String(port),
    PGRST_JWT_SECRET: secret,
    PGRST_LOG_LEVEL: "error",
  });
  const child = spawn(exe, [], { env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  let errors = "";
  child.stderr.on("data", (chunk) => {
    errors = (errors + chunk).slice(-2000);
  });
  const url = "http://127.0.0.1:" + port,
    encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = (role, sub) => {
    const unsigned =
      encode({ alg: "HS256", typ: "JWT" }) +
      "." +
      encode({ role, ...(sub ? { sub } : {}), exp: Math.floor(Date.now() / 1000) + 1800 });
    return unsigned + "." + createHmac("sha256", secret).update(unsigned).digest("base64url");
  };
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(child.exitCode, null, errors);
    try {
      const ready = await fetch(url + "/", { signal: AbortSignal.timeout(500) });
      if (ready.ok) break;
    } catch {}
    await sleep(50);
  }
  return {
    url,
    headers: (role = "authenticated", sub = author) => ({
      "content-type": "application/json",
      authorization: "Bearer " + token(role, sub),
    }),
    close: async () => {
      if (child.exitCode === null) {
        const exit = new Promise((done) => child.once("exit", done));
        child.kill();
        await exit;
      }
    },
  };
}
async function main() {
  assert.deepEqual(process.argv.slice(2), ["--run"]);
  assert.equal(process.platform, "win32");
  const parent = realpathSync(process.env.HELD_SYNC_TEST_TMP || tmpdir()),
    owned = mkdtempSync(join(parent, "codex-held-sync-"));
  assert(!lstatSync(owned).isSymbolicLink());
  let local,
    db,
    rest,
    relay,
    originalFetch = globalThis.fetch,
    passed = 0,
    loseAck = false,
    requests = 0;
  const test = async (name, work) => {
    await work();
    passed++;
    console.log("PASS " + name);
  };
  try {
    db = await createPostgres(join(owned, "postgres"));
    local = await createLocal(branch);
    // The shared minimal causal fixture intentionally omits table defaults. Use
    // the actual reviewed registry defaults for ordinary held/payment rows here.
    for (const table of local.registry.tables.filter((value) =>
      ["held_orders", "sales", "sale_items", "payment_transactions"].includes(value.cloudTable),
    ))
      for (const column of table.columns.filter((value) => value.defaultRule))
        await local.manager.pool
          .request()
          .batch(
            "ALTER TABLE dbo.[" +
              table.sqlServerTable +
              "] ADD CONSTRAINT [fixture_held_" +
              table.sqlServerTable +
              "_" +
              column.sqlServerColumn +
              "] DEFAULT (" +
              column.defaultRule +
              ") FOR [" +
              column.sqlServerColumn +
              "];",
          );
    await createCloud(db, local.registry);
    rest = await createRest(db);
    const sqlMigration = read("database/sqlserver/migrations/016_synced_register_drafts.sql");
    for (const batch of sqlMigration.split(/^GO\s*$/m))
      if (batch.trim()) await local.manager.pool.request().batch(batch);
    relay = createServer(async (request, response) => {
      try {
        let text = "";
        for await (const chunk of request) {
          text += chunk;
          assert(text.length < 2 * 1024 * 1024);
        }
        const body = JSON.parse(text);
        assert.equal(body.terminalToken, terminal);
        assert.equal(body.deviceBindingProof, proof);
        const send = (status, value, headers = {}) => {
          response.writeHead(status, { "content-type": "application/json", ...headers });
          response.end(JSON.stringify(value));
        };
        if (body.sqlServerAggregate) {
          const a = body.sqlServerAggregate;
          requests++;
          const result = await originalFetch(rest.url + "/rpc/pos_sync_push_aggregate", {
            method: "POST",
            headers: rest.headers("service_role", null),
            body: JSON.stringify({
              p_batch_id: a.batchId,
              p_organization_id: a.organizationId,
              p_branch_id: a.branchId,
              p_terminal_id: body.terminalToken,
              p_operations: a.operations,
            }),
            signal: AbortSignal.timeout(15000),
          });
          const value = await result.json();
          if (loseAck && result.ok)
            return send(503, {
              ok: false,
              error: "Fixture lost acknowledgement",
              code: "HTTP_503",
            });
          return send(result.status, value);
        }
        if (body.sqlServerScopedHistory?.action === "feed") {
          const p = body.sqlServerScopedHistory;
          assert.deepEqual(Object.keys(body).sort(), ["deviceBindingProof", "sqlServerScopedHistory", "terminalToken"]);
          assert.deepEqual(Object.keys(p).sort(), ["action", "branchId", "cursor", "limit", "organizationId"]);
          await db.query("SELECT pos_sync_validate_scope($1,$2,$3)", [
            p.organizationId,
            p.branchId,
            terminal,
          ]);
          const feed = (
            await db.query(
              "SELECT cursor,table_name,entity_id,operation,row_version,tombstone FROM sync_change_feed WHERE organization_id=$1 AND branch_id=$2 AND cursor>$3::bigint ORDER BY cursor LIMIT $4::integer",
              [p.organizationId, p.branchId, p.cursor, p.limit + 1],
            )
          ).rows;
          const hasMore = feed.length > p.limit;
          if (hasMore) feed.pop();
          for (const row of feed) {
            assert(
              ["held_orders", "sales", "sale_items", "payment_transactions"].includes(
                row.table_name,
              ),
            );
            row.row_data = row.tombstone
              ? null
              : ((
                  await db.query(
                    "SELECT to_jsonb(x) data FROM " + row.table_name + " x WHERE id::text=$1",
                    [JSON.parse(row.entity_id).id],
                  )
                ).rows[0]?.data ?? null);
          }
          return send(200, feed, {
            "X-POS-Scoped-History-Transport": "1",
            "X-POS-Feed-Projection": "1",
            "X-POS-Feed-Continue": hasMore ? "1" : "0",
          });
        }
        if (body.sqlServerBootstrap) {
          const p = body.sqlServerBootstrap;
          assert(["held_orders", "sales", "bookings"].includes(p.table));
          await db.query("SELECT pos_sync_validate_scope($1,$2,$3)", [
            p.organizationId,
            p.branchId,
            terminal,
          ]);
          const rows = (
            await db.query("SELECT * FROM " + p.table + " WHERE store_id=$1 ORDER BY id", [
              p.branchId,
            ])
          ).rows;
          return send(200, { rows, cursor: null });
        }
        return send(400, { ok: false, error: "Unexpected fixture operation" });
      } catch (error) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: false, error: error.message }));
      }
    });
    await new Promise((done) => relay.listen(0, "127.0.0.1", done));
    const relayUrl = "http://127.0.0.1:" + relay.address().port;
    globalThis.fetch = (input, options) => {
      const url = typeof input === "string" ? input : input.url;
      assert.equal(url, origin + "/api/v1/pos/sync");
      return originalFetch(relayUrl, options);
    };
    const identity = {
      source: "pos",
      level: "staff",
      subject: author,
      permissions: {
        can_hold_cart: true,
        can_process_sale: true,
        can_reopen_held_order: true,
        can_discard_held_order: true,
      },
    };
    const cloud = new CloudClient({
        connectionManager: local.manager,
        configStore: { get: () => origin },
        terminalStore: {
          read: () => ({
            tokenId: terminal,
            locationId: branch,
            deviceUse: "operations",
            deviceBindingProof: proof,
          }),
        },
      }),
      checkpoints = new CheckpointRepository(local.manager),
      reader = new ChangeReader(local.manager, local.registry),
      repo = new AggregateRepository(local.manager, local.repository),
      pusher = new PushWorker({ reader, cloud, checkpoints, registry: local.registry }),
      pull = new PullWorker({
        connectionManager: local.manager,
        cloud,
        checkpoints,
        registry: local.registry,
        reader,
      });
    pusher.retry = (work) => work(); // Deterministic lost-ACK pass; no scheduler/backoff claim.
    const hold = (id, bill, patch = {}) => ({
      id,
      label: "Synthetic held sale",
      store_id: branch,
      shift_id: null,
      held_by: author,
      total: "12.35",
      lines: [{ productId: null, name: "Fixture", qty: 1, price: 12.35 }],
      cart_discount: 0,
      cart_discount_type: "amount",
      note: "",
      held_at: "2026-11-07T01:02:03.123Z",
      created_at: "2026-11-07T01:02:03.123Z",
      updated_at: "2026-11-07T01:02:03.123Z",
      row_version: 1,
      status: "held",
      bill_no: bill,
      ...patch,
    });
    const save = async (row, operationId = randomUUID()) => {
      const operations = [{ kind: "upsert", table: "held_orders", rows: [row] }];
      return repo.commit("held_order", {
        operations,
        operationId,
        branchId: branch,
        terminalId: terminal,
        permissions: identity.permissions,
        ...aggregatePolicy("held_order", operations, identity),
      });
    };
    const pending = async () =>
      Number(
        (
          await local.manager.pool
            .request()
            .query(
              "SELECT count(*) n FROM dbo.sync_change_journal WHERE entity_type='held_orders' AND acknowledged_at IS NULL",
            )
        ).recordset[0].n,
      );
    const native = async (id) =>
      (
        await local.manager.pool
          .request()
          .input("id", id)
          .query("SELECT * FROM dbo.held_orders WHERE id=@id")
      ).recordset[0];
    const listSource = read("src/core/api/pos-db.ts"),
      listStart = listSource.indexOf("  async listHeldOrders(storeId?: string)"),
      listEnd = listSource.indexOf("\n  },", listStart);
    assert(listStart >= 0 && listEnd > listStart);
    const listCode = require("esbuild").transformSync(
      "async function " +
        listSource
          .slice(listStart, listEnd + 4)
          .trim()
          .slice("async ".length),
      { loader: "ts", format: "cjs" },
    ).code;
    const listContext = {
      routedQuery: async (table, options) => {
        const result = await local.repository.query(branch, table, options, terminal);
        assert.equal(result.ok, true);
        return result.rows;
      },
    };
    require("node:vm").runInNewContext(listCode + "\nthis.list=listHeldOrders;", listContext);
    const web = async (path, options = {}) => {
      const response = await originalFetch(rest.url + path, {
        headers: rest.headers(),
        ...options,
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    };
    const first = hold("held-" + randomUUID(), "H-001");
    await test("offline hold and SQL pending evidence commit atomically and survive cold pool restart", async () => {
      await save(first);
      assert.equal(await pending(), 1);
      assert.equal((await native(first.id)).status, "held");
      assert.equal((await db.query("SELECT count(*) n FROM held_orders")).rows[0].n, 0);
      await local.restart();
      assert.equal(await pending(), 1);
      assert.equal((await native(first.id)).status, "held");
    });
    await test("lost cloud acknowledgement leaves SQL pending; same snapshot retry saves one cloud receipt", async () => {
      loseAck = true;
      await assert.rejects(pusher.pushAggregates(branch, 100), (error) => error.status === 503);
      assert.equal(await pending(), 1);
      assert.equal((await db.query("SELECT count(*) n FROM held_orders")).rows[0].n, 1);
      await local.restart();
      loseAck = false;
      await pusher.pushAggregates(branch, 100);
      assert.equal(await pending(), 0);
      assert.equal((await db.query("SELECT count(*) n FROM held_orders")).rows[0].n, 1);
      assert.equal(
        (await db.query("SELECT count(*) n FROM sync_idempotency_receipts")).rows[0].n,
        1,
      );
      assert.equal(requests, 2);
    });
    await test("actual PostgREST web read sees held bill and exact two-decimal amount after ACK", async () => {
      const access = await web("/rpc/fixture_held_access");
      assert.equal(access.status, 200);
      assert.deepEqual(access.body, {
        role: "authenticated",
        has_uid: true,
        staff: true,
        store: branch,
      });
      const value = await web("/held_orders?id=eq." + first.id);
      assert.equal(value.status, 200);
      assert.equal(value.body.length, 1);
      assert.equal(value.body[0].store_id, branch);
      assert.equal(value.body[0].status, "held");
      assert.equal(
        (await db.query("SELECT total::text amount FROM held_orders WHERE id=$1", [first.id]))
          .rows[0].amount,
        "12.35",
      );
    });
    await test("web update downloads through real CloudClient/PullWorker without new upload evidence", async () => {
      const value = await web("/held_orders?id=eq." + first.id, {
        method: "PATCH",
        body: JSON.stringify({ label: "Updated on web", status: "draft" }),
      });
      assert.equal(value.status, 204);
      await pull.run({ branchId: branch, skipMembership: true });
      assert.equal((await native(first.id)).label, "Updated on web");
      assert.equal((await native(first.id)).status, "draft");
      assert.equal(await pending(), 0);
    });
    await test("web branch RLS and actual sync terminal branch validator reject foreign records", async () => {
      await db.query(
        "INSERT INTO held_orders(id,store_id,label,status,row_version,total,lines) VALUES($1,$2,$3,$4,1,1,$5::jsonb)",
        ["foreign-" + randomUUID(), foreign, "Other branch", "held", "[]"],
      );
      const own = await web("/held_orders");
      assert.equal(own.status, 200);
      assert(own.body.every((row) => row.store_id === branch));
      const denied = await web("/held_orders?store_id=eq.B", {
        method: "PATCH",
        headers: { ...rest.headers(), Prefer: "return=representation" },
        body: JSON.stringify({ label: "must not write" }),
      });
      assert.equal(denied.status, 200);
      assert.deepEqual(denied.body, []);
      await assert.rejects(
        cloud.pushAggregate({
          batchId: randomUUID(),
          branchId: foreign,
          operations: [{ table: "held_orders", rows: [first], changes: [] }],
        }),
        (error) => /^SYNC_(?:BRANCH|TERMINAL_SCOPE)_FORBIDDEN$/.test(error.message),
      );
    });
    await test("Main aggregate policy still denies revoked hold permission before SQL save", async () => {
      const before = await pending();
      assert.throws(
        () =>
          aggregatePolicy(
            "held_order",
            [{ kind: "upsert", table: "held_orders", rows: [hold("denied", "DENIED")] }],
            { ...identity, permissions: { can_hold_cart: false } },
          ),
        { code: "PERMISSION_DENIED" },
      );
      assert.equal(await pending(), before);
      assert.equal(await native("denied"), undefined);
    });
    await test("pending local edit prevents cloud overwrite and pull cursor advancement before acknowledgement", async () => {
      const row = await native(first.id);
      await save({
        ...first,
        label: "Unsynced local edit",
        status: "draft",
        row_version: Number(row.row_version) + 1,
      });
      const before = (await checkpoints.get(branch, "__feed__", "pull"))?.committed_cursor;
      await web("/held_orders?id=eq." + first.id, {
        method: "PATCH",
        body: JSON.stringify({ label: "Competing web edit" }),
      });
      const deferred = await pull.run({ branchId: branch, skipMembership: true });
      assert.equal(deferred.deferredLocalChanges, true);
      assert.equal((await native(first.id)).label, "Unsynced local edit");
      assert.equal((await checkpoints.get(branch, "__feed__", "pull"))?.committed_cursor, before);
      assert.equal(await pending(), 1);
      // Observe the existing equal-version competing-edit outcome separately; this
      // test proves the pending barrier only, not a cloud/local conflict chooser.
      await pusher.pushAggregates(branch, 100);
      await pull.run({ branchId: branch, skipMembership: true });
      const observed = (
        await db.query("SELECT label,row_version FROM held_orders WHERE id=$1", [first.id])
      ).rows[0];
      console.log(
        "OBSERVED competing held edit after upload " +
          JSON.stringify({
            pending: await pending(),
            nativeLabel: (await native(first.id)).label,
            cloudLabel: observed.label,
            cloudVersion: observed.row_version,
          }),
      );
    });
    await test("web cancellation reaches Electron and stale draft upload cannot reopen cancelled bill", async () => {
      await web("/held_orders?id=eq." + first.id, {
        method: "PATCH",
        body: JSON.stringify({ status: "cancelled" }),
      });
      await pull.run({ branchId: branch, skipMembership: true });
      assert.equal((await native(first.id)).status, "cancelled");
      assert(!(await listContext.list(branch)).some((ticket) => ticket.id === first.id));
      const before = (await db.query("SELECT row_version FROM held_orders WHERE id=$1", [first.id]))
        .rows[0].row_version;
      await cloud.pushAggregate({
        batchId: randomUUID(),
        branchId: branch,
        operations: [
          {
            table: "held_orders",
            rows: [{ ...first, status: "held", row_version: Number(before) + 10 }],
            changes: [],
          },
        ],
      });
      assert.equal(
        (await db.query("SELECT status FROM held_orders WHERE id=$1", [first.id])).rows[0].status,
        "cancelled",
      );
    });
    await test("saved native sale completes its held ticket and original-request replay cannot duplicate sale or payment", async () => {
      const row = hold("held-" + randomUUID(), "H-002");
      await save(row);
      await pusher.pushAggregates(branch, 100);
      const id = randomUUID(),
        operations = [
          {
            kind: "upsert",
            table: "sales",
            rows: [
              {
                id,
                store_id: branch,
                bill_number: row.bill_no,
                total_amount: 12.35,
                paid_amount: 12.35,
                payment_type: "cash",
              },
            ],
          },
          {
            kind: "upsert",
            table: "sale_items",
            rows: [
              {
                id: randomUUID(),
                sale_id: id,
                branch_id: branch,
                product_name: "Synthetic item",
                quantity: 1,
                unit_price: 12.35,
              },
            ],
          },
          {
            kind: "upsert",
            table: "payment_transactions",
            rows: [
              {
                id: randomUUID(),
                sale_id: id,
                store_id: branch,
                source_type: "sale",
                amount: 12.35,
                method: "cash",
                status: "completed",
                kind: "payment",
              },
            ],
          },
        ];
      const aggregate = {
        operations,
        operationId: randomUUID(),
        branchId: branch,
        terminalId: terminal,
        permissions: identity.permissions,
        ...aggregatePolicy("sale", operations, identity),
      };
      await repo.commit("sale", aggregate);
      assert.equal((await repo.commit("sale", aggregate)).replayed, true);
      assert.equal((await native(row.id)).status, "completed");
      assert.equal(
        (
          await local.manager.pool
            .request()
            .query("SELECT count(*) n FROM dbo.payment_transactions")
        ).recordset[0].n,
        1,
      );
      await pusher.pushAggregates(branch, 100);
      assert.equal(
        (await db.query("SELECT status FROM held_orders WHERE id=$1", [row.id])).rows[0].status,
        "completed",
      );
      const value = await web("/held_orders?id=eq." + row.id);
      assert.equal(value.body[0].status, "completed");
      await pull.run({ branchId: branch, skipMembership: true });
      assert.equal((await native(row.id)).status, "completed");
      assert.equal((await db.query("SELECT count(*) n FROM sales")).rows[0].n, 1);
      assert.equal((await db.query("SELECT count(*) n FROM payment_transactions")).rows[0].n, 1);
    });
    await test("reproduce: expired shift CT prevents coordinator downloading an already completed web held bill", async () => {
      const row = hold("held-" + randomUUID(), "H-WEB");
      await save(row);
      await pusher.pushAggregates(branch, 100);
      const sale = randomUUID(),
        item = randomUUID(),
        payment = randomUUID();
      // This is an ACCEPTED cloud sale fixture, not a claim that the hosted Charge
      // UI/pos_sale_commit authorization was exercised. Its real source triggers
      // and actual PostgREST reads provide the completion used by the download.
      await db.exec("BEGIN;");
      try {
        await db.query(
          "INSERT INTO sales(id,store_id,bill_number,subtotal_amount,total_amount,paid_amount) VALUES($1,$2,$3,12.35,12.35,12.35)",
          [sale, branch, row.bill_no],
        );
        await db.query(
          "INSERT INTO sale_items(id,sale_id,branch_id,product_name,quantity,unit_price) VALUES($1,$2,$3,$4,1,12.35)",
          [item, sale, branch, "Accepted web fixture"],
        );
        await db.query(
          "INSERT INTO payment_transactions(id,sale_id,store_id,source_type,amount,method,kind,status) VALUES($1,$2,$3,'sale',12.35,'cash','payment','completed')",
          [payment, sale, branch],
        );
        await db.exec("COMMIT;");
      } catch (error) {
        await db.exec("ROLLBACK;");
        throw error;
      }
      const central = await web("/held_orders?id=eq." + row.id);
      assert.equal(central.status, 200);
      assert.equal(central.body[0].status, "completed");
      assert.equal((await native(row.id)).status, "held");
      await local.manager.pool
        .request()
        .batch(
          "UPDATE dbo.stores SET name=N'Advance owned CT fixture';ALTER TABLE dbo.shifts DISABLE CHANGE_TRACKING;ALTER TABLE dbo.shifts ENABLE CHANGE_TRACKING;",
        );
      let pullCalls = 0;
      const coordinator = new SyncCoordinator({
          pushWorker: pusher,
          pullWorker: {
            run: async (options) => {
              pullCalls++;
              return pull.run(options);
            },
          },
        }),
        before = (await checkpoints.get(branch, "__feed__", "pull"))?.committed_cursor;
      const result = await coordinator.runNow({ branchId: branch, skipMembership: true });
      assert.equal(result.ok, false);
      assert.equal(result.code, "ECHANGEGAP");
      assert.equal(result.table, "shifts");
      assert.equal(pullCalls, 0);
      assert.equal((await native(row.id)).status, "held");
      assert.equal((await checkpoints.get(branch, "__feed__", "pull"))?.committed_cursor, before);
      // Prove the current ordinary download can apply the accepted completion,
      // without treating this direct fixture call as an implemented gap bypass.
      await pull.run({ branchId: branch, skipMembership: true });
      assert.equal((await native(row.id)).status, "completed");
      assert(!(await listContext.list(branch)).some((ticket) => ticket.id === row.id));
      assert.equal(
        (
          await local.manager.pool
            .request()
            .input("id", sale)
            .query("SELECT count(*) n FROM dbo.sales WHERE id=@id")
        ).recordset[0].n,
        1,
      );
      assert.equal(
        (
          await local.manager.pool
            .request()
            .input("id", payment)
            .query("SELECT count(*) n FROM dbo.payment_transactions WHERE id=@id")
        ).recordset[0].n,
        1,
      );
      assert.equal(await pending(), 0);
    });
    await test("inactive web staff and anonymous callers do not acquire held-ticket access", async () => {
      await db.query("UPDATE app_users SET is_active=false WHERE id=$1", [author]);
      const inactive = await web("/held_orders");
      assert.equal(inactive.status, 200);
      assert.deepEqual(inactive.body, []);
      const response = await originalFetch(rest.url + "/held_orders");
      assert.equal(response.status, 401);
    });
    console.log(
      "PASS " +
        passed +
        " actual LocalDB/PostgreSQL/PostgREST held-sale groups; fixture HTTP relay only, no hosted identity/Main IPC/TLS acceptance claimed",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (relay) await new Promise((done) => relay.close(done));
    await rest?.close();
    await db?.close();
    await local?.close();
    const resolved = realpathSync(owned);
    assert(resolved.startsWith(parent + sep) && !lstatSync(owned).isSymbolicLink());
    rmSync(resolved, { recursive: true, force: true });
    console.log("CLEANED owned held-sale fixtures");
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
