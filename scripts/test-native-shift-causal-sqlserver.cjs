// Opt-in: only a new randomly owned LocalDB instance/database is accepted.
// No POS configuration, saved profile, hosted URL or existing database is read.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const sql = require("mssql/msnodesqlv8");
const { loadRegistry } = require("../electron/db/schema-registry.cjs");
const { OperationsRepository } = require("../electron/db/repositories/operations.cjs");
const { ShiftSyncJournal } = require("../electron/db/shift-sync-journal.cjs");
const { ChangeReader } = require("../electron/sync/change-reader.cjs");
const { applyShiftGraphs } = require("../electron/sync/shift-graph.cjs");
const { GRAPH_TABLES } = require("../electron/db/shift-intents.cjs");
const { AggregateRepository } = require("../electron/db/repositories/aggregates.cjs");
const { CheckpointRepository } = require("../electron/sync/checkpoints.cjs");
const { matchingCoverage } = require("./lib/shift-coverage-fixture.cjs");

async function main() {
  assert.deepEqual(
    process.argv.slice(2),
    ["--run"],
    "Only --run is accepted; never supply an existing server/database.",
  );
  assert.equal(process.platform, "win32");
  const suffix = randomUUID().replaceAll("-", ""),
    instance = "CodexShift36_" + suffix,
    database = "Shift36Fixture_" + suffix;
  assert(
    /^CodexShift36_[a-f0-9]{32}$/.test(instance) && /^Shift36Fixture_[a-f0-9]{32}$/.test(database),
  );
  const control = (...args) => {
    const result = execFileSync(
      "C:/Program Files/Microsoft SQL Server/170/Tools/Binn/SqlLocalDB.exe",
      args,
      { windowsHide: true, timeout: 30000, stdio: "pipe" },
    );
    return result.toString(result.includes(0) ? "utf16le" : "utf8").replace(/^\uFEFF/, "");
  };
  let server,
    owned = false,
    created = false,
    master,
    pool,
    passed = 0;
  const connect = (name) =>
    new sql.ConnectionPool({
      connectionString: `Driver={ODBC Driver 18 for SQL Server};Server=${server};Database=${name};Trusted_Connection=Yes;Encrypt=No;TrustServerCertificate=Yes;`,
      options: { trustedConnection: true },
      pool: { min: 0, max: 4 },
      requestTimeout: 15000,
    }).connect();
  const test = async (name, work) => {
    await work();
    passed++;
    console.log("PASS " + name);
  };
  try {
    control("create", instance, "-s");
    owned = true;
    server = control("info", instance).match(
      /np:\\\\\.\\pipe\\LOCALDB#[A-Fa-f0-9]+\\tsql\\query/,
    )?.[0];
    assert(server, "The newly owned instance has no private pipe.");
    master = await connect("master");
    await master
      .request()
      .query(
        `CREATE DATABASE [${database}]; ALTER DATABASE [${database}] SET CHANGE_TRACKING=ON(CHANGE_RETENTION=2 DAYS,AUTO_CLEANUP=ON);`,
      );
    created = true;
    pool = await connect(database);
    const registry = loadRegistry(),
      migration = readFileSync(
        path.join(__dirname, "../database/sqlserver/migrations/022_shift_causal_intents.sql"),
        "utf8",
      );
    const fixtureTables = [
      ...GRAPH_TABLES,
      "sales",
      "sale_items",
      "bookings",
      "booking_items",
      "booking_payments",
      "payment_transactions",
      "held_orders",
    ].filter((name) => registry.tables.some((table) => table.cloudTable === name));
    for (const name of fixtureTables) {
      const table = registry.tables.find((table) => table.cloudTable === name);
      await pool
        .request()
        .batch(
          `CREATE TABLE dbo.[${name}](${table.columns.map((column) => `[${column.sqlServerColumn}] ${column.sqlServerType} ${column.sqlServerColumn === "id" ? "NOT NULL" : "NULL"}`).join(",")},PRIMARY KEY(id)); ALTER TABLE dbo.[${name}] ENABLE CHANGE_TRACKING;`,
        );
    }
    await pool.request()
      .batch(`CREATE UNIQUE INDEX UX_fixture_original ON dbo.shift_cash_counts(shift_id) WHERE kind=N'ORIGINAL';
   CREATE UNIQUE INDEX UX_fixture_client ON dbo.shift_cash_counts(client_key) WHERE client_key IS NOT NULL;
   CREATE TABLE dbo.pos_schema_migrations(version int PRIMARY KEY,name nvarchar(200));
   CREATE TABLE dbo.local_operation_receipts(operation_id uniqueidentifier PRIMARY KEY,operation_type nvarchar(80),entity_id nvarchar(128),note nvarchar(max));
   CREATE TABLE dbo.sync_change_journal(change_id bigint IDENTITY PRIMARY KEY,entity_type nvarchar(128),entity_id nvarchar(400),operation nvarchar(16),branch_id nvarchar(128),entity_version bigint,aggregate_id uniqueidentifier,acknowledged_at datetimeoffset NULL,last_error nvarchar(1000),retry_count int NOT NULL DEFAULT(0));
   CREATE TABLE dbo.sync_checkpoints(organization_id nvarchar(128) NOT NULL DEFAULT(N'default'),branch_id nvarchar(128),entity_type nvarchar(128),direction nvarchar(10),change_tracking_version bigint,committed_cursor nvarchar(400),updated_at datetimeoffset);`);
    const manager = { pool, sql: () => sql },
      writer = new ShiftSyncJournal(new OperationsRepository(manager, registry)),
      reader = new ChangeReader(manager, registry);
    const branch = "fixture",
      shift = randomUUID(),
      count = randomUUID(),
      recon = randomUUID(),
      raw = "2026-11-02T03:00:00.123456+00:00";
    const facts = (cash) => ({
      counted_cash: cash,
      counted_card: null,
      counted_digital: null,
      expected_cash: 100,
      expected_card: 0,
      expected_digital: 0,
      variance_cash: cash - 100,
      variance_card: null,
      variance_digital: null,
      variance_total: cash - 100,
      variance_status: cash === 100 ? "NO_VARIANCE" : "OVER",
    });
    const row = (table, facts) =>
      Object.assign(
        Object.fromEntries(
          registry.tables
            .find((metadata) => metadata.cloudTable === table)
            .columns.map((column) => [column.cloudColumn, null]),
        ),
        facts,
      );
    const graph = {
      ok: true,
      shiftGraphVersion: 1,
      branchId: branch,
      shiftId: shift,
      graphToken: "a".repeat(64),
      closedAtRaw: raw,
      tables: [
        {
          table: "shifts",
          rows: [
            row("shifts", {
              id: shift,
              store_id: branch,
              status: "CLOSED",
              state: "CLOSED",
              closed_at: raw,
              opened_at: raw,
              created_at: raw,
              row_version: 5,
              final_counted_cash: 100,
              ...facts(100),
            }),
          ],
        },
        {
          table: "shift_cash_counts",
          rows: [
            row("shift_cash_counts", {
              id: count,
              shift_id: shift,
              store_id: branch,
              kind: "ORIGINAL",
              counted_cash: 100,
              client_key: "cloud-original",
              created_at: raw,
            }),
          ],
        },
        {
          table: "shift_reconciliations",
          rows: [
            row("shift_reconciliations", {
              id: recon,
              shift_id: shift,
              store_id: branch,
              count_id: count,
              created_at: raw,
              ...facts(100),
            }),
          ],
        },
        ...["shift_close_events", "shift_notifications", "shift_variance_alerts"].map((table) => ({
          table,
          rows: [],
        })),
      ],
    };
    const insert = async (table, data) => {
      const entries = Object.entries(data),
        request = pool.request();
      entries.forEach(([, value], index) => request.input("v" + index, value));
      await request.query(
        `WITH CHANGE_TRACKING_CONTEXT(0x434C4F5544) INSERT dbo.[${table}](${entries.map(([key]) => `[${key}]`).join(",")}) VALUES(${entries.map((_, index) => "@v" + index).join(",")});`,
      );
    };
    await insert("shifts", {
      id: shift,
      store_id: branch,
      status: "OPEN",
      state: "ACTIVE",
      row_version: 99,
    });
    await pool
      .request()
      .query(
        `INSERT dbo.sync_checkpoints(branch_id,entity_type,direction,change_tracking_version) SELECT N'fixture',name,N'push',CHANGE_TRACKING_CURRENT_VERSION() FROM sys.tables WHERE name IN(${fixtureTables.map((name) => "N'" + name + "'").join(",")});`,
      );
    const image = async () => {
      const result = [];
      for (const table of [
        ...GRAPH_TABLES,
        "sync_change_journal",
        "pos_sync_shift_baselines",
        "pos_sync_shift_intents",
        "pos_sync_shift_openings",
      ])
        result.push(
          (
            await pool
              .request()
              .query(`SELECT * FROM dbo.[${table}] FOR JSON PATH,INCLUDE_NULL_VALUES;`)
          ).recordset,
        );
      return result;
    };
    const adopt = async (value = graph) => {
      const tx = new sql.Transaction(pool);
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      try {
        const result = await applyShiftGraphs({
          transaction: tx,
          connectionManager: manager,
          registry,
          reader,
          branchId: branch,
          prepared: { graphs: new Map([[value.shiftId, value]]) },
        });
        await tx.commit();
        return result;
      } catch (error) {
        await Promise.resolve(tx.rollback()).catch(() => undefined);
        throw error;
      }
    };
    await test("022 creates metadata additively and is idempotent", async () => {
      await pool.request().batch(migration);
      const before = await image();
      await pool.request().batch(migration);
      assert.deepEqual(await image(), before);
    });
    await test("actual whole-graph adoption accepts CLOSED5 over OPEN99 and preserves opaque raw timestamp", async () => {
      await adopt();
      const parent = (
        await pool.request().query("SELECT status,state,row_version FROM dbo.shifts;")
      ).recordset[0];
      assert.deepEqual(parent, { status: "CLOSED", state: "CLOSED", row_version: 5 });
      const baseline = (
        await pool
          .request()
          .query("SELECT graph_token,closed_at_raw,graph_json FROM dbo.pos_sync_shift_baselines;")
      ).recordset[0];
      assert.equal(baseline.graph_token, graph.graphToken);
      assert.equal(baseline.closed_at_raw, raw);
      assert.equal(baseline.graph_json, JSON.stringify(graph));
    });
    const operations = (cash, index) => {
      const countId = randomUUID(),
        time = `2026-11-02T04:0${index}:00.000Z`;
      return [
        {
          kind: "insert",
          table: "shift_cash_counts",
          rows: [
            {
              id: countId,
              shift_id: shift,
              store_id: branch,
              terminal_id: "terminal",
              kind: "RECOUNT",
              counted_cash: cash,
              counted_card: null,
              counted_digital: null,
              reason: "Reviewed",
              counted_by_name: "manager",
              counted_by_staff_id: "manager",
              client_key: "recount-" + index,
              created_at: time,
            },
          ],
        },
        {
          kind: "insert",
          table: "shift_reconciliations",
          rows: [
            {
              id: randomUUID(),
              shift_id: shift,
              store_id: branch,
              count_id: countId,
              ...facts(cash),
              created_at: time,
            },
          ],
        },
        {
          kind: "insert",
          table: "shift_close_events",
          rows: [
            {
              id: randomUUID(),
              shift_id: shift,
              store_id: branch,
              terminal_id: "terminal",
              event: "recount_submitted",
              from_state: "CLOSED",
              to_state: "CLOSED",
              actor_name: "manager",
              actor_staff_id: "manager",
              detail: { count_id: countId, reason: "Reviewed" },
              created_at: time,
            },
          ],
        },
        {
          kind: "update",
          table: "shifts",
          match: { id: shift },
          values: {
            store_id: branch,
            status: "CLOSED",
            state: "CLOSED",
            ...facts(cash),
            final_counted_cash: cash,
            closing_float: cash,
            updated_at: time,
          },
        },
      ];
    };
    const commit = async (cash, index, observation) =>
      writer.apply("isolated recount", operations(cash, index), {
        branchId: branch,
        terminalId: "terminal",
        observation: observation ?? (await writer.observe(branch, shift)),
      });
    await test("two offline recounts bind baseline then durable predecessor, retaining raw PG history", async () => {
      await commit(110, 1);
      await commit(120, 2);
      const intents = (
        await pool
          .request()
          .query("SELECT * FROM dbo.pos_sync_shift_intents ORDER BY intent_sequence;")
      ).recordset;
      assert.equal(intents.length, 2);
      const first = JSON.parse(intents[0].payload_json),
        second = JSON.parse(intents[1].payload_json);
      assert.equal(first.baseToken, graph.graphToken);
      assert.equal(first.predecessorIntentId, null);
      assert.equal(second.baseToken, null);
      assert.equal(second.predecessorIntentId, intents[0].intent_id.toLowerCase());
      assert.equal(second.predecessorIntentHash, intents[0].payload_hash);
      assert.deepEqual(
        [first, second].map(
          (payload) =>
            payload.operations.find((op) => op.table === "shift_cash_counts").rows.length,
        ),
        [2, 3],
      );
      assert.equal(
        first.operations
          .find((op) => op.table === "shift_cash_counts")
          .rows.find((row) => row.kind === "ORIGINAL").created_at,
        raw,
      );
    });
    await test("stale local observation aborts before any business/queue/metadata mutation", async () => {
      const stale = await writer.observe(branch, shift);
      await commit(130, 3);
      const before = await image();
      await assert.rejects(commit(140, 4, stale), (error) => error.code === "ESHIFT_LOCAL_CHANGED");
      assert.deepEqual(await image(), before);
    });
    await test("pending causal work blocks a cloud correction without changing baseline or counts", async () => {
      const before = await image();
      await assert.rejects(adopt(), (error) => error.code === "ELOCAL_UPLOAD_PENDING");
      assert.deepEqual(await image(), before);
    });
    await test("ACK I1 only acknowledges I1 history and leaves pending successor/tail intact", async () => {
      const intents = (
          await pool
            .request()
            .query("SELECT * FROM dbo.pos_sync_shift_intents ORDER BY intent_sequence;")
        ).recordset,
        first = await reader.protectedIntent(intents[0].intent_id, branch);
      await reader.acknowledgeProtectedIntent(first, {
        intent_id: first.intentId,
        intent_hash: first.payloadHash,
        accepted_token: "b".repeat(64),
        current_token: "c".repeat(64),
        superseded: true,
        coverage: matchingCoverage(registry, first.operations),
      });
      const saved = (
        await pool
          .request()
          .query("SELECT acknowledged_at FROM dbo.pos_sync_shift_intents ORDER BY intent_sequence;")
      ).recordset;
      assert(saved[0].acknowledged_at);
      assert.equal(saved[1].acknowledged_at, null);
      assert.equal(
        (await pool.request().query("SELECT graph_token FROM dbo.pos_sync_shift_baselines;"))
          .recordset[0].graph_token,
        graph.graphToken,
      );
    });
    await test("exact accepted legacy CT copies do not undo/block the next web correction", async () => {
      const beforeCheckpoints = (
        await pool.request().query("SELECT * FROM dbo.sync_checkpoints ORDER BY entity_type;")
      ).recordset;
      const intents = (
        await pool
          .request()
          .query("SELECT * FROM dbo.pos_sync_shift_intents ORDER BY intent_sequence;")
      ).recordset;
      for (const row of intents.slice(1)) {
        const intent = await reader.protectedIntent(row.intent_id, branch);
        await reader.acknowledgeProtectedIntent(intent, {
          intent_id: intent.intentId,
          intent_hash: intent.payloadHash,
          accepted_token: "c".repeat(64),
          current_token: "c".repeat(64),
          superseded: false,
          coverage: matchingCoverage(registry, intent.operations),
        });
      }
      const latest = JSON.parse(intents.at(-1).payload_json);
      graph.tables = GRAPH_TABLES.map((table) => ({
        table,
        rows: latest.operations.find((op) => op.table === table)?.rows ?? [],
      }));
      graph.graphToken = "d".repeat(64);
      Object.assign(graph.tables[0].rows[0], {
        ...facts(140),
        final_counted_cash: 140,
        closing_float: 140,
        row_version: 2,
      });
      const cloudCount = randomUUID();
      graph.tables
        .find((table) => table.table === "shift_cash_counts")
        .rows.push(
          row("shift_cash_counts", {
            id: cloudCount,
            shift_id: shift,
            store_id: branch,
            kind: "RECOUNT",
            counted_cash: 140,
            reason: "Web correction",
            created_at: raw,
          }),
        );
      graph.tables
        .find((table) => table.table === "shift_reconciliations")
        .rows.push(
          row("shift_reconciliations", {
            id: randomUUID(),
            shift_id: shift,
            store_id: branch,
            count_id: cloudCount,
            ...facts(140),
            created_at: raw,
          }),
        );
      await adopt();
      assert.equal(
        (await pool.request().query("SELECT counted_cash,row_version FROM dbo.shifts;"))
          .recordset[0].counted_cash,
        140,
      );
      assert.equal(
        (await pool.request().query("SELECT graph_token FROM dbo.pos_sync_shift_baselines;"))
          .recordset[0].graph_token,
        graph.graphToken,
      );
      assert.deepEqual(
        (await pool.request().query("SELECT * FROM dbo.sync_checkpoints ORDER BY entity_type;"))
          .recordset,
        beforeCheckpoints,
      );
    });
    await test("immutable mismatch rolls back earlier parent writes and baseline metadata", async () => {
      const conflicting = structuredClone(graph),
        parent = conflicting.tables[0].rows[0],
        lastCount = conflicting.tables
          .find((table) => table.table === "shift_cash_counts")
          .rows.at(-1),
        lastRecon = conflicting.tables
          .find((table) => table.table === "shift_reconciliations")
          .rows.at(-1);
      Object.assign(parent, { ...facts(141), final_counted_cash: 141 });
      lastCount.counted_cash = 141;
      Object.assign(lastRecon, facts(141));
      const before = await image();
      await assert.rejects(adopt(conflicting), (error) => error.code === "ESYNC_APPLY_CONFLICT");
      assert.deepEqual(await image(), before);
    });
    await test("a new unjournaled local CT edit remains pending beyond accepted receipts", async () => {
      await pool
        .request()
        .query(
          "UPDATE dbo.shifts SET row_version=row_version+1,close_reason=N'Unuploaded legacy edit';",
        );
      const before = await image();
      await assert.rejects(adopt(), (error) => error.code === "ELOCAL_CT_PENDING");
      assert.deepEqual(await image(), before);
    });
    await test("normal opening commit freezes its genuine persisted OPEN before sale and final close", async () => {
      const operationsRepository = new OperationsRepository(manager, registry),
        aggregates = new AggregateRepository(manager, operationsRepository),
        offlineShift = randomUUID();
      const opened = await aggregates.commit("shift", {
        branchId: branch,
        terminalId: "terminal",
        permissions: { can_open_shift: true },
        operations: [
          {
            kind: "upsert",
            table: "shifts",
            rows: [
              {
                id: offlineShift,
                store_id: branch,
                terminal_id: "terminal",
                status: "OPEN",
                state: "ACTIVE",
                row_version: 1,
                opening_float: 20,
                opened_at: raw,
              },
            ],
          },
        ],
      });
      const opening = await reader.frozenOpeningRows(opened.operationId, branch);
      assert.equal(opening.length, 1);
      assert.equal(opening[0].status, "OPEN");
      assert.equal(opening[0].state, "ACTIVE");
      const sold = await aggregates.commit("sale", {
        branchId: branch,
        terminalId: "terminal",
        permissions: { can_process_sale: true },
        operations: [
          {
            kind: "insert",
            table: "sales",
            rows: [
              {
                id: randomUUID(),
                store_id: branch,
                shift_id: offlineShift,
                bill_number: "isolated-offline-sale",
                total_amount: 80,
                row_version: 1,
                created_at: raw,
              },
            ],
          },
        ],
      });
      const scope = {
        branchId: branch,
        shiftId: offlineShift,
        baseToken: null,
        predecessorIntentId: null,
      };
      assert.equal(
        await reader.shiftPrerequisites(scope),
        false,
        "pending sale journal must precede close",
      );
      await reader.acknowledgeAggregate(sold.operationId);
      assert.equal(
        await reader.shiftPrerequisites(scope),
        false,
        "unjournaled/acknowledged CT sale copy still precedes close",
      );
      const checkpoints = new CheckpointRepository(manager);
      await checkpoints.save(branch, "sales", "push", {
        change_tracking_version: await reader.currentVersion(),
      });
      assert.equal(await reader.shiftPrerequisites(scope), true);
      const ops = operations(100, 5);
      for (const op of ops) {
        for (const record of op.rows ?? []) if (record.shift_id) record.shift_id = offlineShift;
        if (op.match) op.match.id = offlineShift;
      }
      const cashCount = ops[0].rows[0];
      cashCount.kind = "ORIGINAL";
      cashCount.client_key = "offline-original";
      const time = cashCount.created_at;
      ops[2].rows = [
        {
          ...ops[2].rows[0],
          event: "cash_count_submitted",
          from_state: "CASH_COUNT_REQUIRED",
          to_state: "CASH_COUNT_SUBMITTED",
          detail: { count_id: cashCount.id },
        },
        {
          ...ops[2].rows[0],
          id: randomUUID(),
          event: "reconciled",
          from_state: "CASH_COUNT_SUBMITTED",
          to_state: "CLOSED",
          detail: { variance_status: "NO_VARIANCE", variance_total: 0 },
        },
      ];
      ops[3].values.closed_at = time;
      await writer.apply("offline original", ops, {
        branchId: branch,
        terminalId: "terminal",
        observation: await writer.observe(branch, offlineShift),
      });
      assert.deepEqual(await reader.frozenOpeningRows(opened.operationId, branch), opening);
      const intent = (
        await pool
          .request()
          .input("shift", offlineShift)
          .query("SELECT payload_json FROM dbo.pos_sync_shift_intents WHERE shift_id=@shift;")
      ).recordset[0];
      assert.equal(JSON.parse(intent.payload_json).operations.length, 6);
      assert.equal(JSON.parse(intent.payload_json).kind, "ORIGINAL");
      const later = operations(110, 6);
      for (const op of later) {
        for (const record of op.rows ?? []) if (record.shift_id) record.shift_id = offlineShift;
        if (op.match) op.match.id = offlineShift;
      }
      later[0].rows[0].client_key = "offline-later-recount";
      await writer.apply("later recount", later, {
        branchId: branch,
        terminalId: "terminal",
        observation: await writer.observe(branch, offlineShift),
      });
      const replay = {
        branchId: branch,
        shiftId: offlineShift,
        clientKey: "offline-original",
        actor: "manager",
        terminalId: "terminal",
        cash: 100,
        card: null,
        digital: null,
      };
      assert.deepEqual(await writer.originalReplay(replay), { state: "CLOSED" });
      await assert.rejects(
        writer.originalReplay({ ...replay, cash: 101 }),
        (error) => error.code === "EIDEMPOTENCY",
      );
      await reader.acknowledgeAggregate(opened.operationId);
    });
    await test("missing original proven by a durable tail fails replay without reconstructing history", async () => {
      const saved = (
        await pool
          .request()
          .query("SELECT * FROM dbo.shift_cash_counts WHERE client_key=N'offline-original';")
      ).recordset[0];
      await pool
        .request()
        .input("id", saved.id)
        .query("DELETE FROM dbo.shift_cash_counts WHERE id=@id;");
      const before = await image();
      await assert.rejects(
        writer.originalReplay({
          branchId: branch,
          shiftId: saved.shift_id,
          clientKey: "offline-original",
          actor: "manager",
          terminalId: "terminal",
          cash: 100,
          card: null,
          digital: null,
        }),
        (error) => error.code === "EIDEMPOTENCY",
      );
      assert.deepEqual(await image(), before);
      await insert("shift_cash_counts", saved);
    });
    await test("legacy CT-only sale and NULL-shift draft completion block final upload until their own checkpoints", async () => {
      const checkpoints = new CheckpointRepository(manager),
        legacySale = randomUUID(),
        held = randomUUID();
      await pool
        .request()
        .input("sale", legacySale)
        .input("shift", shift)
        .query(
          "INSERT dbo.sales(id,store_id,shift_id,bill_number,total_amount) VALUES(@sale,N'fixture',CONVERT(nvarchar(36),@shift),N'legacy-ct-only',1);",
        );
      const intent = {
        branchId: branch,
        shiftId: shift,
        baseToken: null,
        predecessorIntentId: null,
      };
      assert.equal(await reader.shiftPrerequisites(intent), false);
      await checkpoints.save(branch, "sales", "push", {
        change_tracking_version: await reader.currentVersion(),
      });
      assert.equal(await reader.shiftPrerequisites(intent), true);
      await pool
        .request()
        .input("held", held)
        .query(
          "INSERT dbo.held_orders(id,store_id,shift_id,status) VALUES(@held,N'fixture',NULL,N'draft');",
        );
      assert.equal(await reader.shiftPrerequisites(intent), false);
      await pool
        .request()
        .input("held", held)
        .query("UPDATE dbo.held_orders SET status=N'completed' WHERE id=@held;");
      assert.equal(await reader.shiftPrerequisites(intent), false);
      await checkpoints.save(branch, "held_orders", "push", {
        change_tracking_version: await reader.currentVersion(),
      });
      assert.equal(await reader.shiftPrerequisites(intent), true);
    });
    await test("a payment received in a later shift gates its own shift rather than the booking's earlier shift", async () => {
      const laterShift = randomUUID(),
        booking = randomUUID();
      await insert("bookings", { id: booking, store_id: branch, shift_id: shift });
      await pool
        .request()
        .input("id", randomUUID())
        .input("booking", booking)
        .input("later", laterShift)
        .query(
          "INSERT dbo.payment_transactions(id,booking_id,store_id,shift_id,amount) VALUES(@id,@booking,N'fixture',CONVERT(nvarchar(36),@later),10);",
        );
      const scope = (target) => ({
        branchId: branch,
        shiftId: target,
        baseToken: null,
        predecessorIntentId: null,
      });
      assert.equal(await reader.shiftPrerequisites(scope(shift)), true);
      assert.equal(await reader.shiftPrerequisites(scope(laterShift)), false);
      await new CheckpointRepository(manager).save(branch, "payment_transactions", "push", {
        change_tracking_version: await reader.currentVersion(),
      });
      assert.equal(await reader.shiftPrerequisites(scope(laterShift)), true);
    });
    let coverageScenario;
    await test("historical fully-matched alert proof permits its old CT copy, then adopts WEB sent state", async () => {
      const target = randomUUID(),
        alert = randomUUID(),
        aggregate = new AggregateRepository(manager, new OperationsRepository(manager, registry));
      const opened = await aggregate.commit("shift", {
        branchId: branch,
        terminalId: "terminal",
        permissions: { can_open_shift: true },
        operations: [
          {
            kind: "insert",
            table: "shifts",
            rows: [
              {
                id: target,
                store_id: branch,
                terminal_id: "terminal",
                status: "OPEN",
                state: "ACTIVE",
                row_version: 1,
                opening_float: 20,
              },
            ],
          },
        ],
      });
      const closing = (cash, index) => {
        const ops = operations(cash, index);
        for (const op of ops) {
          for (const record of op.rows ?? []) if (record.shift_id) record.shift_id = target;
          if (op.match) op.match.id = target;
        }
        ops[0].rows[0].client_key = `coverage-${index}`;
        return ops;
      };
      const first = closing(110, 8),
        time = first[0].rows[0].created_at;
      first[0].rows[0].kind = "ORIGINAL";
      first[3].values.closed_at = time;
      first[2].rows = [
        {
          ...first[2].rows[0],
          event: "cash_count_submitted",
          to_state: "CASH_COUNT_SUBMITTED",
          from_state: "CASH_COUNT_REQUIRED",
          detail: { count_id: first[0].rows[0].id },
        },
        {
          ...first[2].rows[0],
          id: randomUUID(),
          event: "reconciled",
          from_state: "CASH_COUNT_SUBMITTED",
          to_state: "CLOSED",
          detail: { variance_status: "OVER", variance_total: 10 },
        },
      ];
      first.push({
        kind: "insert",
        table: "shift_variance_alerts",
        rows: [
          {
            id: alert,
            shift_id: target,
            store_id: branch,
            reconciliation_id: first[1].rows[0].id,
            variance_total: 10,
            variance_status: "OVER",
            severity: "warning",
            delivery_status: "pending",
            attempts: 0,
            created_at: time,
            updated_at: time,
          },
        ],
      });
      await writer.apply("coverage original", first, {
        branchId: branch,
        terminalId: "terminal",
        observation: await writer.observe(branch, target),
      });
      await reader.acknowledgeAggregate(opened.operationId);
      const latest = async () => {
        const saved = (
          await pool
            .request()
            .input("shift", target)
            .query(
              "SELECT TOP(1) intent_id FROM dbo.pos_sync_shift_intents WHERE shift_id=@shift ORDER BY intent_sequence DESC;",
            )
        ).recordset[0];
        return reader.protectedIntent(saved.intent_id, branch);
      };
      const acknowledge = async (intent, token, omitted = {}) =>
        reader.acknowledgeProtectedIntent(intent, {
          intent_id: intent.intentId,
          intent_hash: intent.payloadHash,
          accepted_token: token,
          current_token: token,
          superseded: false,
          coverage: matchingCoverage(registry, intent.operations, omitted),
        });
      await acknowledge(await latest(), "a".repeat(64));
      await writer.apply("coverage later recount", closing(120, 9), {
        branchId: branch,
        terminalId: "terminal",
        observation: await writer.observe(branch, target),
      });
      const later = await latest();
      await acknowledge(later, "b".repeat(64), { shift_variance_alerts: [alert] });
      const alertTable = registry.tables.find(
        (table) => table.cloudTable === "shift_variance_alerts",
      );
      assert.deepEqual(
        await reader.acceptedShiftChanges(
          alertTable,
          [{ key: { id: alert }, operation: "U" }],
          branch,
        ),
        new Set([alert]),
      );
      const remote = {
        ok: true,
        shiftGraphVersion: 1,
        branchId: branch,
        shiftId: target,
        graphToken: "b".repeat(64),
        closedAtRaw: later.operations.find((op) => op.table === "shifts").rows[0].closed_at,
        tables: GRAPH_TABLES.map((table) => ({
          table,
          rows: structuredClone(later.operations.find((op) => op.table === table).rows),
        })),
      };
      Object.assign(
        remote.tables.find((entry) => entry.table === "shift_variance_alerts").rows[0],
        { delivery_status: "sent", attempts: 1, updated_at: "2026-11-02T06:00:00.000Z" },
      );
      await adopt(remote);
      assert.equal(
        (
          await pool
            .request()
            .input("alert", alert)
            .query("SELECT delivery_status FROM dbo.shift_variance_alerts WHERE id=@alert;")
        ).recordset[0].delivery_status,
        "sent",
      );
      coverageScenario = { target, alert, closing, latest, acknowledge, remote };
    });
    await test("unuploaded note and alert retry observed before closing remain pending when omitted by actual-match proof", async () => {
      const { target, alert, closing, latest, acknowledge, remote } = coverageScenario;
      await pool
        .request()
        .input("shift", target)
        .input("alert", alert)
        .query(
          "UPDATE dbo.shifts SET note=N'unuploaded local note',row_version=row_version+1,updated_at='2026-11-02T07:00:00Z' WHERE id=@shift; UPDATE dbo.shift_variance_alerts SET delivery_status=N'pending',attempts=2,updated_at='2026-11-02T07:00:00Z' WHERE id=@alert;",
        );
      await writer.apply("coverage count with unrelated observations", closing(130, 7), {
        branchId: branch,
        terminalId: "terminal",
        observation: await writer.observe(branch, target),
      });
      const intent = await latest(),
        malformed = matchingCoverage(registry, intent.operations),
        beforeInvalidAck = await image();
      malformed.tables.find(
        (entry) => entry.table === "shift_cash_counts",
      ).rows[0].serverValues.note = "forbidden business override";
      await assert.rejects(
        reader.acknowledgeProtectedIntent(intent, {
          intent_id: intent.intentId,
          intent_hash: intent.payloadHash,
          accepted_token: "c".repeat(64),
          current_token: "c".repeat(64),
          superseded: false,
          coverage: malformed,
        }),
        (error) => error.code === "ESHIFT_COVERAGE_UNCONFIRMED",
      );
      assert.deepEqual(await image(), beforeInvalidAck);
      await acknowledge(intent, "c".repeat(64), {
        shifts: [target],
        shift_variance_alerts: [alert],
      });
      for (const [name, id] of [
        ["shifts", target],
        ["shift_variance_alerts", alert],
      ])
        assert.deepEqual(
          await reader.acceptedShiftChanges(
            registry.tables.find((table) => table.cloudTable === name),
            [{ key: { id }, operation: "U" }],
            branch,
          ),
          new Set(),
        );
      const serverGraph = {
        ...remote,
        graphToken: "c".repeat(64),
        tables: GRAPH_TABLES.map((table) => ({
          table,
          rows: structuredClone(intent.operations.find((op) => op.table === table).rows),
        })),
      };
      serverGraph.tables.find((entry) => entry.table === "shifts").rows[0].note = null;
      serverGraph.tables.find((entry) => entry.table === "shift_variance_alerts").rows =
        structuredClone(
          remote.tables.find((entry) => entry.table === "shift_variance_alerts").rows,
        );
      const before = await image(),
        checkpoints = (
          await pool.request().query("SELECT * FROM dbo.sync_checkpoints ORDER BY entity_type;")
        ).recordset;
      await assert.rejects(adopt(serverGraph), (error) => error.code === "ELOCAL_CT_PENDING");
      assert.deepEqual(await image(), before);
      assert.deepEqual(
        (await pool.request().query("SELECT * FROM dbo.sync_checkpoints ORDER BY entity_type;"))
          .recordset,
        checkpoints,
      );
    });
    await test("022 refuses unknown metadata shape without rewriting saved rows", async () => {
      await pool
        .request()
        .query("ALTER TABLE dbo.pos_sync_shift_intents ADD operator_column int NULL;");
      const before = await image();
      await assert.rejects(pool.request().batch(migration));
      assert.deepEqual(await image(), before);
    });
    await pool
      .request()
      .query("ALTER TABLE dbo.pos_sync_shift_intents DROP COLUMN operator_column;");
    await test("022 refuses an unexpected named metadata index without normalizing operator DDL", async () => {
      await pool
        .request()
        .query(
          "DROP INDEX IX_pos_sync_shift_intents_tail ON dbo.pos_sync_shift_intents; CREATE INDEX IX_pos_sync_shift_intents_tail ON dbo.pos_sync_shift_intents(branch_id,shift_id,intent_sequence ASC);",
        );
      const before = await image();
      await assert.rejects(pool.request().batch(migration));
      assert.deepEqual(await image(), before);
      assert.equal(
        (
          await pool
            .request()
            .query(
              "SELECT ic.is_descending_key FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id WHERE i.name=N'IX_pos_sync_shift_intents_tail' AND ic.key_ordinal=3;",
            )
        ).recordset[0].is_descending_key,
        false,
      );
    });
    await pool
      .request()
      .query(
        "DROP INDEX IX_pos_sync_shift_intents_tail ON dbo.pos_sync_shift_intents; CREATE INDEX IX_pos_sync_shift_intents_tail ON dbo.pos_sync_shift_intents(branch_id,shift_id,intent_sequence DESC);",
      );
    const refuses = async (fragment) => {
      const result = await pool
        .request()
        .input("fixtureMigration", migration)
        .query(
          "BEGIN TRY EXEC sys.sp_executesql @fixtureMigration; SELECT 0 n,N'' message; END TRY BEGIN CATCH SELECT ERROR_NUMBER() n,ERROR_MESSAGE() message; END CATCH;",
        );
      assert.equal(result.recordset[0].n, 51022);
      assert(result.recordset[0].message.includes(fragment), result.recordset[0].message);
    };
    await test("022 refuses an unreviewed extra UNIQUE without dropping it or rewriting metadata", async () => {
      await pool
        .request()
        .query(
          "CREATE UNIQUE INDEX operator_pending_shift ON dbo.pos_sync_shift_intents(shift_id,intent_kind) WHERE acknowledged_at IS NULL;",
        );
      const before = await image();
      await refuses("uniqueness");
      assert.deepEqual(await image(), before);
      assert.equal(
        (
          await pool
            .request()
            .query("SELECT COUNT(*) n FROM sys.indexes WHERE name=N'operator_pending_shift';")
        ).recordset[0].n,
        1,
      );
      await pool
        .request()
        .query("DROP INDEX operator_pending_shift ON dbo.pos_sync_shift_intents;");
    });
    await test("022 checks CHECK expressions rather than accepting a familiar constraint name", async () => {
      await pool
        .request()
        .query(
          "ALTER TABLE dbo.pos_sync_shift_intents DROP CONSTRAINT CK_pos_sync_shift_intents_kind; ALTER TABLE dbo.pos_sync_shift_intents WITH CHECK ADD CONSTRAINT CK_pos_sync_shift_intents_kind CHECK(intent_kind IN(N'ORIGINAL',N'RECOUNT',N'VARIANCE',N'UNKNOWN'));",
        );
      const before = await image();
      await refuses("CHECK expression");
      assert.deepEqual(await image(), before);
      await pool
        .request()
        .query(
          "ALTER TABLE dbo.pos_sync_shift_intents DROP CONSTRAINT CK_pos_sync_shift_intents_kind; ALTER TABLE dbo.pos_sync_shift_intents WITH CHECK ADD CONSTRAINT CK_pos_sync_shift_intents_kind CHECK(intent_kind IN(N'ORIGINAL',N'RECOUNT',N'VARIANCE'));",
        );
    });
    await test("022 refuses reseeded identity below the saved durable tail without normalizing it", async () => {
      await pool
        .request()
        .query("DBCC CHECKIDENT('dbo.pos_sync_shift_intents',RESEED,0) WITH NO_INFOMSGS;");
      const before = await image();
      await refuses("identity");
      assert.deepEqual(await image(), before);
    });
    await test("022 refuses descending identity increment before any migration DDL/data change", async () => {
      await pool.request().query("DROP TABLE dbo.pos_sync_shift_intents;");
      const ddl = migration
        .slice(
          migration.indexOf("CREATE TABLE dbo.pos_sync_shift_intents"),
          migration.indexOf(" IF OBJECT_ID(N'dbo.pos_sync_shift_openings'"),
        )
        .replace("IDENTITY(1,1)", "IDENTITY(1,-1)");
      await pool.request().batch(ddl);
      const before = await image();
      await refuses("identity");
      assert.deepEqual(await image(), before);
    });
    console.log(
      `${passed} isolated SHIFT36 LocalDB scenarios passed; no POS database/profile/network used.`,
    );
  } finally {
    if (pool) await pool.close();
    if (created) {
      assert(owned && /^Shift36Fixture_[a-f0-9]{32}$/.test(database));
      await master
        .request()
        .query(
          `ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}];`,
        );
    }
    if (master) await master.close();
    if (owned) {
      assert(/^CodexShift36_[a-f0-9]{32}$/.test(instance));
      control("stop", instance, "-k");
      control("delete", instance);
    }
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
