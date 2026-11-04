// Opt-in, uniquely owned LocalDB only. No operator connection/profile modules.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const sql = require("mssql/msnodesqlv8");
const {
  build,
  NAMES,
  FIELDS,
  rowSignature,
  sha,
  META_SELECT,
} = require("./lib/local54-fourth-adoption.cjs");
const { digest } = require("./prepare-local54-fourth-adoption.cjs");
const { loadRegistry } = require("../electron/db/schema-registry.cjs");
const {
  projection,
  exactRows,
  parseExactJson,
} = require("../electron/sync/shift-recovery-exact.cjs");
const originalBatch = sql.Request.prototype.batch;
sql.Request.prototype.batch = function (text, ...args) {
  return originalBatch.call(this, text, ...args).catch((error) => {
    const line = Number(error.lineNumber ?? error.originalError?.info?.lineNumber ?? 1);
    error.message +=
      " [isolated fixture batch line " +
      line +
      ": " +
      String(text)
        .split("\n")
        .slice(Math.max(0, line - 2), line + 1)
        .join("\n")
        .slice(0, 1200) +
      "]";
    throw error;
  });
};
const schema = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../src/lib/__tests__/fixtures/local54-fourth-schema.metadata.json"),
    "utf8",
  ),
);
const registry = loadRegistry(),
  tables = NAMES.map((n) => registry.tables.find((t) => t.cloudTable === n));
const q = (v) => "N'" + String(v).replaceAll("'", "''") + "'";
const id = (n) => "[" + n.replaceAll("]", "]]") + "]";
const schemaNames = [...new Set(schema.columns.map((c) => c.table_name))].sort();
function type(c) {
  return (
    c.type_name +
    (["nvarchar", "nchar"].includes(c.type_name)
      ? "(" + (c.max_length === -1 ? "max" : c.max_length / 2) + ")"
      : ["varchar", "char", "varbinary", "binary"].includes(c.type_name)
        ? "(" + (c.max_length === -1 ? "max" : c.max_length) + ")"
        : ["decimal", "numeric"].includes(c.type_name)
          ? "(" + c.precision + "," + c.scale + ")"
          : ["datetimeoffset", "datetime2", "time"].includes(c.type_name)
            ? "(" + c.scale + ")"
            : "")
  );
}
async function main() {
  assert.deepEqual(process.argv.slice(2), ["--run"]);
  assert.equal(process.platform, "win32");
  const suffix = randomUUID().replaceAll("-", ""),
    instance = "CodexFourth54_" + suffix,
    database = "Fourth54Fixture_" + suffix;
  assert(
    /^CodexFourth54_[a-f0-9]{32}$/.test(instance) &&
      /^Fourth54Fixture_[a-f0-9]{32}$/.test(database),
  );
  const tool = "C:/Program Files/Microsoft SQL Server/170/Tools/Binn/SqlLocalDB.exe";
  const control = (...args) => {
    const b = execFileSync(tool, args, { windowsHide: true, timeout: 30000, stdio: "pipe" });
    return b.toString(b.includes(0) ? "utf16le" : "utf8").replace(/^\uFEFF/, "");
  };
  let owned = false,
    created = false,
    server,
    master,
    pool,
    other,
    passed = 0;
  const connect = (name) => {
    assert(name === "master" || name === database);
    return new sql.ConnectionPool({
      connectionString: `Driver={ODBC Driver 18 for SQL Server};Server=${server};Database=${name};Trusted_Connection=Yes;Encrypt=No;TrustServerCertificate=Yes;`,
      options: { trustedConnection: true },
      pool: { min: 0, max: 4 },
      requestTimeout: 15000,
    }).connect();
  };
  try {
    control("create", instance, "-s");
    owned = true;
    server = control("info", instance).match(
      /np:\\\\\.\\pipe\\LOCALDB#[A-Fa-f0-9]+\\tsql\\query/,
    )?.[0];
    assert(server, "Owned private pipe missing");
    master = await connect("master");
    await master
      .request()
      .batch(
        `CREATE DATABASE ${id(database)};ALTER DATABASE ${id(database)} SET CHANGE_TRACKING=ON(CHANGE_RETENTION=2 DAYS,AUTO_CLEANUP=ON);`,
      );
    created = true;
    pool = await connect(database);
    other = await connect(database);
    for (const name of schemaNames) {
      const cols = schema.columns.filter((c) => c.table_name === name);
      assert(cols.every((c) => !c.is_computed));
      await pool
        .request()
        .batch(
          `CREATE TABLE dbo.${id(name)}(${cols.map((c) => id(c.column_name) + " " + type(c) + (c.is_identity ? " IDENTITY(1,1)" : "") + (c.is_nullable ? " NULL" : " NOT NULL")).join(",")});`,
        );
    }
    for (const d of schema.defaults)
      await pool
        .request()
        .batch(
          `ALTER TABLE dbo.${id(d.table_name)} ADD CONSTRAINT ${id(d.constraint_name)} DEFAULT ${d.definition} FOR ${id(d.column_name)};`,
        );
    for (const k of schema.keys) {
      const indexes = schema.indexes
        .filter(
          (i) => i.table_name === k.table_name && i.index_name === k.name && i.key_ordinal > 0,
        )
        .sort((a, b) => a.key_ordinal - b.key_ordinal);
      await pool
        .request()
        .batch(
          `ALTER TABLE dbo.${id(k.table_name)} ADD CONSTRAINT ${id(k.name)} ${k.type_desc === "PRIMARY_KEY_CONSTRAINT" ? "PRIMARY KEY" : "UNIQUE"} ${indexes[0].type_desc}(${indexes.map((i) => id(i.column_name) + (i.is_descending_key ? " DESC" : " ASC")).join(",")});`,
        );
    }
    const indexes = new Map();
    for (const i of schema.indexes)
      if (!i.is_primary_key && !i.is_unique_constraint)
        indexes.set(i.table_name + "|" + i.index_name, i);
    for (const i of indexes.values()) {
      const cols = schema.indexes.filter(
        (c) => c.table_name === i.table_name && c.index_name === i.index_name,
      );
      const keys = cols
          .filter((c) => !c.is_included_column && c.key_ordinal > 0)
          .sort((a, b) => a.key_ordinal - b.key_ordinal),
        included = cols.filter((c) => c.is_included_column);
      await pool
        .request()
        .batch(
          `CREATE ${i.is_unique ? "UNIQUE " : ""}${i.type_desc} INDEX ${id(i.index_name)} ON dbo.${id(i.table_name)}(${keys.map((c) => id(c.column_name) + (c.is_descending_key ? " DESC" : " ASC")).join(",")})${included.length ? " INCLUDE(" + included.map((c) => id(c.column_name)).join(",") + ")" : ""}${i.has_filter ? " WHERE " + i.filter_definition : ""};`,
        );
    }
    for (const c of schema.checks)
      await pool
        .request()
        .batch(
          `ALTER TABLE dbo.${id(c.table_name)} WITH CHECK ADD CONSTRAINT ${id(c.name)} CHECK ${c.definition};`,
        );
    const fks = new Map();
    for (const f of schema.foreign_keys) fks.set(f.table_name + "|" + f.name, f);
    for (const f of fks.values()) {
      const cols = schema.foreign_keys
        .filter((c) => c.table_name === f.table_name && c.name === f.name)
        .sort((a, b) => a.constraint_column_id - b.constraint_column_id);
      await pool
        .request()
        .batch(
          `ALTER TABLE dbo.${id(f.table_name)} ADD CONSTRAINT ${id(f.name)} FOREIGN KEY(${cols.map((c) => id(c.column_name)).join(",")}) REFERENCES dbo.${id(f.referenced_table)}(${cols.map((c) => id(c.referenced_column)).join(",")}) ON DELETE ${f.delete_referential_action_desc.replaceAll("_", " ")} ON UPDATE ${f.update_referential_action_desc.replaceAll("_", " ")};`,
        );
    }
    for (const name of schema.tracking.map((t) => t.table_name))
      await pool.request().batch(`ALTER TABLE dbo.${id(name)} ENABLE CHANGE_TRACKING;`);
    for (const t of schema.triggers) await pool.request().batch(t.definition);
    await pool
      .request()
      .batch(
        `CREATE TABLE dbo.sales(id uniqueidentifier PRIMARY KEY,store_id nvarchar(450),shift_id nvarchar(128),bill_number nvarchar(128));CREATE TABLE dbo.bookings(id uniqueidentifier PRIMARY KEY,store_id nvarchar(450),shift_id nvarchar(128));CREATE TABLE dbo.payment_transactions(id uniqueidentifier PRIMARY KEY,store_id nvarchar(450),shift_id nvarchar(128));CREATE TABLE dbo.sale_items(id uniqueidentifier PRIMARY KEY,sale_id uniqueidentifier);CREATE TABLE dbo.booking_payments(id uniqueidentifier PRIMARY KEY,booking_id uniqueidentifier);IF OBJECT_ID(N'dbo.sync_checkpoints') IS NULL CREATE TABLE dbo.sync_checkpoints(organization_id nvarchar(128),branch_id nvarchar(128),entity_type nvarchar(128),direction nvarchar(10),change_tracking_version bigint,committed_cursor nvarchar(400),PRIMARY KEY(organization_id,branch_id,entity_type,direction));CREATE TABLE dbo.fixture_stock(id int PRIMARY KEY,quantity int);INSERT dbo.fixture_stock VALUES(1,37);`,
      );
    const identity = (
      await pool
        .request()
        .query(
          `SELECT CONVERT(nvarchar(128),SERVERPROPERTY('ServerName')) server_name,DB_NAME() database_name,CONVERT(nvarchar(36),database_guid) database_guid FROM sys.database_recovery_status WHERE database_id=DB_ID();`,
        )
    ).recordset[0];
    assert.notEqual(identity.database_name, "POS_Local");
    assert.notEqual(identity.database_guid.toUpperCase(), "CEAFA630-D613-423C-8997-8A31DF70C506");
    const branch = randomUUID(),
      shift = randomUUID(),
      maintenanceId = randomUUID(),
      threeId = randomUUID(),
      otherIds = [randomUUID(), randomUUID(), randomUUID()];
    const baseRow = (table) =>
      Object.fromEntries(
        table.columns.map((c) => [
          c.cloudColumn,
          c.cloudColumn === "id"
            ? randomUUID()
            : c.nullable
              ? null
              : c.cloudType === "uuid"
                ? randomUUID()
                : /^(numeric|decimal|integer|bigint|smallint)/.test(c.cloudType)
                  ? 0
                  : c.cloudType === "boolean"
                    ? false
                    : /^timestamp/.test(c.cloudType)
                      ? "2026-01-01T01:00:00.1234567Z"
                      : c.cloudType === "date"
                        ? "2026-01-01"
                        : c.cloudType === "jsonb"
                          ? {}
                          : c.cloudType.endsWith("[]")
                            ? []
                            : "synthetic",
        ]),
      );
    const makeGraph = (target) => {
      const p = {
        ...baseRow(tables[0]),
        id: target,
        store_id: branch,
        terminal_id: "synthetic-terminal",
        opened_at: "2026-01-01T01:00:00.1234567Z",
        closed_at: "2026-01-01T09:00:00.1234567Z",
        created_at: "2026-01-01T01:00:00.1234567Z",
        updated_at: "2026-01-01T09:00:01.1234567Z",
        status: "CLOSED",
        state: "CLOSED",
        row_version: 3,
        counted_cash: 20,
        final_counted_cash: 20,
        closing_float: 20,
        counted_card: null,
        counted_digital: null,
        expected_cash: 18,
        expected_card: 0,
        expected_digital: 0,
        variance_cash: 2,
        variance_card: null,
        variance_digital: null,
        variance_total: 2,
        variance_status: "OVER",
        closing_started_at: "2026-01-01T08:59:00.1234567Z",
        closing_started_by: "synthetic-cashier",
        close_reason: "Synthetic accepted closing",
      };
      const count = {
        ...baseRow(tables[1]),
        store_id: branch,
        shift_id: target,
        kind: "ORIGINAL",
        client_key: randomUUID(),
        counted_cash: 20,
        counted_card: null,
        counted_digital: null,
      };
      const reconciliation = {
        ...baseRow(tables[2]),
        store_id: branch,
        shift_id: target,
        count_id: count.id,
        counted_cash: 20,
        counted_card: null,
        counted_digital: null,
        expected_cash: 18,
        expected_card: 0,
        expected_digital: 0,
        variance_cash: 2,
        variance_card: null,
        variance_digital: null,
        variance_total: 2,
        variance_status: "OVER",
      };
      const events = Array.from({ length: 3 }, (_, i) => ({
        ...baseRow(tables[3]),
        store_id: branch,
        shift_id: target,
        event: ["closing_started", "cash_count_submitted", "reconciled"][i],
        detail: { count_id: count.id },
      }));
      const notification = { ...baseRow(tables[4]), store_id: branch, shift_id: target };
      const alert = {
        ...baseRow(tables[5]),
        store_id: branch,
        shift_id: target,
        reconciliation_id: reconciliation.id,
        delivery_status: "pending",
        attempts: 0,
      };
      return NAMES.map((table, i) => ({
        table,
        rows:
          i === 0
            ? [p]
            : i === 1
              ? [count]
              : i === 2
                ? [reconciliation]
                : i === 3
                  ? events
                  : i === 4
                    ? [notification]
                    : [alert],
      }));
    };
    const insert = async (table, row) => {
      const r = pool.request();
      table.columns.forEach((c, i) =>
        r.input(
          "v" + i,
          row[c.cloudColumn] !== null && typeof row[c.cloudColumn] === "object"
            ? JSON.stringify(row[c.cloudColumn])
            : row[c.cloudColumn],
        ),
      );
      await r.query(
        `INSERT dbo.${id(table.cloudTable)}(${table.columns.map((c) => id(c.sqlServerColumn)).join(",")}) VALUES(${table.columns.map((_, i) => "@v" + i).join(",")});`,
      );
    };
    const graphRows = async () =>
      Promise.all(
        tables.map(async (table) => ({
          table: table.cloudTable,
          rows: (
            await pool
              .request()
              .query(
                `SELECT ${projection(table)} FROM dbo.${id(table.cloudTable)} source ORDER BY CONVERT(nvarchar(36),id);`,
              )
          ).recordset,
        })),
      );
    const signatures = (data, accept) =>
      tables.flatMap((table) =>
        data
          .find((p) => p.table === table.cloudTable)
          .rows.filter((r) =>
            accept(String(table.cloudTable === "shifts" ? r.id : r.shift_id).toLowerCase()),
          )
          .map((r) => ({
            table_name: table.cloudTable,
            id: r.id.toLowerCase(),
            signature: rowSignature(table, r),
          })),
      );
    const captureMetadata = async () => {
      const m = {};
      for (const [kind, query] of Object.entries(META_SELECT))
        m[kind] = (
          await pool
            .request()
            .query(
              query +
                ` WHERE t.schema_id=SCHEMA_ID(N'dbo') AND t.name IN(${schemaNames.map(q).join(",")});`,
            )
        ).recordset;
      return m;
    };
    let beforeTables, sourceGraphText, threeReceipt;
    async function seed() {
      for (const name of [
        "held_orders",
        "pos_sync_shift_closing_starts",
        "pos_sync_shift_intents",
        "pos_sync_shift_baselines",
        "sync_change_journal",
        "local_operation_receipts",
        "sync_checkpoints",
        "sale_items",
        "booking_payments",
        "sales",
        "bookings",
        "payment_transactions",
        ...NAMES.slice(1).reverse(),
        "shifts",
      ])
        await pool.request().query(`DELETE dbo.${id(name)};`);
      const source = makeGraph(shift),
        before = {
          ...source[0].rows[0],
          status: "OPEN",
          state: "ACTIVE",
          row_version: 1,
          updated_at: source[0].rows[0].created_at,
        };
      for (const field of FIELDS)
        if (!["status", "state", "row_version", "updated_at"].includes(field)) before[field] = null;
      await insert(tables[0], before);
      sourceGraphText = JSON.stringify(source);
      for (const target of otherIds) {
        const graph = makeGraph(target);
        graph[0].rows[0].row_version = 5;
        for (const field of [
          "expected_cash",
          "expected_card",
          "expected_digital",
          "variance_cash",
          "variance_total",
        ])
          graph[0].rows[0][field] = null;
        for (let i = 0; i < tables.length; i++)
          for (const row of graph[i].rows) await insert(tables[i], row);
      }
      const old = await graphRows();
      for (const target of otherIds)
        await pool
          .request()
          .input("shift", target)
          .query(
            `UPDATE dbo.shifts SET expected_cash=18,expected_card=0,expected_digital=0,variance_cash=2,variance_total=2,row_version=6,updated_at='2026-01-02T10:00:00.1112223Z' WHERE id=@shift;`,
          );
      const after = await graphRows();
      threeReceipt = {
        id: threeId,
        before: digest(signatures(old, (x) => otherIds.includes(x))),
        after: digest(signatures(after, (x) => otherIds.includes(x))),
        source: sha("synthetic approved three-shift authority", "utf8"),
      };
      await pool
        .request()
        .input("operation", threeId)
        .input("branch", branch)
        .input("before", threeReceipt.before)
        .input("after", threeReceipt.after)
        .input("source", threeReceipt.source)
        .query(
          `DECLARE @Clock datetimeoffset(7)=SYSDATETIMEOFFSET();INSERT dbo.local_operation_receipts(operation_id,operation_type,entity_id,note,committed_at) SELECT @operation,N'cloud_shift_summary_mirror',@branch,(SELECT N'LOCAL54' k,@before b,@after a,@source s,SUSER_SNAME() u,CONVERT(nvarchar(40),@Clock,127) t FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),@Clock;`,
        );
      await pool
        .request()
        .input("branch", branch)
        .query(
          "INSERT dbo.sync_checkpoints(organization_id,branch_id,entity_type,direction,change_tracking_version,committed_cursor) VALUES(N'default',@branch,N'shifts',N'push',1,N'synthetic-preserve-cursor');",
        );
      beforeTables = after.map((p) => ({
        table: p.table,
        rows: p.rows.filter(
          (r) => String(p.table === "shifts" ? r.id : r.shift_id).toLowerCase() === shift,
        ),
      }));
    }
    const fixture = async () =>
      build({
        registry,
        metadata: await captureMetadata(),
        identity,
        branch,
        shift,
        maintenanceId,
        sourceGraphText,
        beforeTables,
        otherExpected: signatures(await graphRows(), (x) => x !== shift),
        threeReceipt,
      });
    const execute = (f, source = f.sql, packageText = f.packageText, confirmed = true) =>
      (fs.writeFileSync(path.join(__dirname, "../.tmp/local54-fourth-synthetic.sql"), source),
      pool.request())
        .input("RepairPackage", sql.NVarChar(sql.MAX), packageText)
        .input("MaintenanceWindowConfirmed", sql.Bit, confirmed)
        .batch(source);
    const snapshot = async () => {
      const result = { graph: await graphRows() };
      for (const name of [
        "local_operation_receipts",
        "held_orders",
        "pos_sync_shift_closing_starts",
        "pos_sync_shift_intents",
        "pos_sync_shift_baselines",
        "sync_change_journal",
        "sales",
        "bookings",
        "payment_transactions",
        "sale_items",
        "booking_payments",
        "sync_checkpoints",
        "fixture_stock",
      ])
        result[name] = (await pool.request().query(`SELECT * FROM dbo.${id(name)};`)).recordset;
      return JSON.stringify(result);
    };
    const test = async (name, fn) => {
      await seed();
      await fn();
      passed++;
      console.log("PASS " + name);
    };
    await test("exact existing accepted graph, seven rows, preserved three-repair and idempotent receipt", async () => {
      const f = await fixture(),
        before = await graphRows();
      await execute(f);
      const after = await graphRows();
      for (const table of tables) {
        const local = after
            .find((p) => p.table === table.cloudTable)
            .rows.filter(
              (r) =>
                String(table.cloudTable === "shifts" ? r.id : r.shift_id).toLowerCase() === shift,
            ),
          remote = parseExactJson(sourceGraphText).find((p) => p.table === table.cloudTable).rows;
        assert(exactRows(table, local, remote));
      }
      assert.deepEqual(
        signatures(after, (x) => x !== shift),
        signatures(before, (x) => x !== shift),
      );
      const receipt = (
        await pool
          .request()
          .input("repair", maintenanceId)
          .query("SELECT * FROM dbo.local_operation_receipts WHERE operation_id=@repair;")
      ).recordset;
      assert.equal(receipt.length, 1);
      const final = await snapshot();
      await execute(f);
      assert.equal(await snapshot(), final);
    });
    await test("missing maintenance confirmation/private sidecar and changed source fail without writes", async () => {
      const f = await fixture(),
        before = await snapshot();
      for (const [text, flag] of [
        [null, true],
        [f.packageText, false],
        [f.packageText + " ", true],
      ]) {
        await assert.rejects(execute(f, f.sql, text, flag));
        assert.equal(await snapshot(), before);
      }
    });
    await test("held and unassigned drafts execute real enabled guard51022 and roll back every inserted child", async () => {
      for (const linked of [shift, null]) {
        await pool.request().query("DELETE dbo.held_orders;");
        const columns = schema.columns.filter(
            (c) => c.table_name === "held_orders" && !c.is_identity,
          ),
          row = Object.fromEntries(
            columns.map((c) => [
              c.column_name,
              c.is_nullable
                ? null
                : c.type_name === "uniqueidentifier"
                  ? randomUUID()
                  : c.type_name === "bit"
                    ? false
                    : /int|decimal|numeric/.test(c.type_name)
                      ? 0
                      : /date|time/.test(c.type_name)
                        ? "2026-01-01T00:00:00Z"
                        : "synthetic",
            ]),
          );
        Object.assign(row, {
          id: randomUUID(),
          store_id: branch,
          shift_id: linked,
          status: "held",
        });
        const r = pool.request();
        columns.forEach((c, i) => r.input("h" + i, row[c.column_name]));
        await r.query(
          `INSERT dbo.held_orders(${columns.map((c) => id(c.column_name)).join(",")}) VALUES(${columns.map((_, i) => "@h" + i).join(",")});`,
        );
        const f = await fixture(),
          before = await snapshot();
        await assert.rejects(
          execute(f),
          (error) => error.number === 51022 || error.originalError?.info?.number === 51022,
        );
        assert.equal(await snapshot(), before);
      }
    });
    await test("pending graph journal is not cleared or falsely acknowledged", async () => {
      await pool
        .request()
        .input("branch", branch)
        .input("key", JSON.stringify({ id: shift }))
        .query(
          `INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id) VALUES('shifts',@key,'update',@branch,1,NEWID());`,
        );
      const f = await fixture(),
        before = await snapshot();
      await assert.rejects(execute(f));
      assert.equal(await snapshot(), before);
    });
    await test("changed target remains held without replacing its evidence", async () => {
      const f = await fixture();
      await pool
        .request()
        .input("shift", shift)
        .query(`UPDATE dbo.shifts SET note=N'changed synthetic evidence' WHERE id=@shift;`);
      const before = await snapshot();
      await assert.rejects(execute(f));
      assert.equal(await snapshot(), before);
    });
    await test("failure after first child, after parent, and after receipt is fully atomic", async () => {
      const f = await fixture(),
        before = await snapshot();
      for (const anchor of [
        "FROM @S_shift_cash_counts;",
        "FROM @S_shift_reconciliations;",
        "FROM @S_shift_close_events;",
        "FROM @S_shift_notifications;",
        "FROM @S_shift_variance_alerts;",
        "IF @@ROWCOUNT<>1 THROW 51155,'LOCAL54F exact parent was not updated.',1;",
        "IF @@ROWCOUNT<>1 THROW 51155,'LOCAL54F receipt insert failed.',1;",
      ]) {
        assert(f.sql.includes(anchor));
        const changed = f.sql.replace(
          anchor,
          anchor + " THROW 51156,'Synthetic atomic failure',1;",
        );
        await assert.rejects(execute(f, changed));
        assert.equal(await snapshot(), before);
      }
    });

    await test("existing local child is never merged away", async () => {
      const f = await fixture(),
        row = JSON.parse(sourceGraphText).find((p) => p.table === "shift_close_events").rows[0];
      await insert(tables[3], row);
      const before = await snapshot();
      await assert.rejects(execute(f));
      assert.equal(await snapshot(), before);
    });
    await test("unknown trigger metadata and disabled existing guard abort before changes", async () => {
      const f = await fixture();
      await pool
        .request()
        .batch(
          "CREATE TRIGGER dbo.synthetic_unreviewed ON dbo.shift_cash_counts AFTER INSERT AS BEGIN RETURN;END;",
        );
      try {
        const before = await snapshot();
        await assert.rejects(execute(f));
        assert.equal(await snapshot(), before);
      } finally {
        await pool.request().batch("DROP TRIGGER dbo.synthetic_unreviewed;");
      }
      await pool.request().batch("DISABLE TRIGGER dbo.shifts_unfinished_tickets ON dbo.shifts;");
      try {
        const before = await snapshot();
        await assert.rejects(execute(f));
        assert.equal(await snapshot(), before);
      } finally {
        await pool.request().batch("ENABLE TRIGGER dbo.shifts_unfinished_tickets ON dbo.shifts;");
      }
    });
    await test("linked sale and unattributable orphan children require review", async () => {
      const f = await fixture();
      await pool
        .request()
        .input("branch", branch)
        .input("shift", shift)
        .query(
          "INSERT dbo.sales(id,store_id,shift_id) VALUES(NEWID(),@branch,CONVERT(nvarchar(36),@shift));",
        );
      let before = await snapshot();
      await assert.rejects(execute(f));
      assert.equal(await snapshot(), before);
      await pool.request().query("DELETE dbo.sales;INSERT dbo.sale_items VALUES(NEWID(),NEWID());");
      before = await snapshot();
      await assert.rejects(execute(f));
      assert.equal(await snapshot(), before);
    });
    await test("unattributable global journal is preserved without acknowledgement", async () => {
      const f = await fixture();
      await pool
        .request()
        .query(
          `INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id) VALUES('audit_logs',N'{"id":"${randomUUID()}"}','insert',N'global',1,NEWID());`,
        );
      const before = await snapshot();
      await assert.rejects(execute(f));
      assert.equal(await snapshot(), before);
    });
    await test("missing verified three-repair receipt cannot use stale scope", async () => {
      const f = await fixture();
      await pool
        .request()
        .input("three", threeId)
        .query("DELETE dbo.local_operation_receipts WHERE operation_id=@three;");
      let before = await snapshot();
      await assert.rejects(execute(f));
      assert.equal(await snapshot(), before);
    });
    await test("partial replay never fills in missing accepted history", async () => {
      const f = await fixture();
      await execute(f);
      const event = JSON.parse(sourceGraphText).find((p) => p.table === "shift_close_events")
        .rows[0];
      await pool
        .request()
        .input("event", event.id)
        .query("DELETE dbo.shift_close_events WHERE id=@event;");
      const before = await snapshot();
      await assert.rejects(execute(f));
      assert.equal(await snapshot(), before);
    });
    await test("forged replay receipt field remains held", async () => {
      const f = await fixture();
      await execute(f);
      await pool
        .request()
        .input("repair", maintenanceId)
        .query(
          `UPDATE dbo.local_operation_receipts SET note=JSON_MODIFY(note,'$.p',REPLICATE('F',64)) WHERE operation_id=@repair;`,
        );
      const before = await snapshot();
      await assert.rejects(execute(f));
      assert.equal(await snapshot(), before);
    });
    await test("concurrent parent owner causes bounded busy failure and leaves its transaction intact", async () => {
      const f = await fixture(),
        transaction = new sql.Transaction(other);
      await transaction.begin();
      try {
        await new sql.Request(transaction)
          .input("shift", shift)
          .query("UPDATE dbo.shifts SET note=N'Synthetic concurrent change' WHERE id=@shift;");
        await assert.rejects(
          execute(f),
          (error) => error.number === 1222 || error.originalError?.info?.number === 1222,
        );
        await transaction.rollback();
      } catch (error) {
        await transaction.rollback().catch(() => {});
        throw error;
      }
    });

    await test("changed other branch history invalidates the prepared scope", async () => {
      const f = await fixture();
      await pool
        .request()
        .input("other", otherIds[0])
        .query("UPDATE dbo.shifts SET note=N'Synthetic later correction' WHERE id=@other;");
      const before = await snapshot();
      await assert.rejects(execute(f));
      assert.equal(await snapshot(), before);
    });
    await test("saved closing-start proof and baseline each require review rather than replacement", async () => {
      for (const name of ["pos_sync_shift_closing_starts", "pos_sync_shift_baselines"]) {
        const f = await fixture();
        const columns = schema.columns.filter((c) => c.table_name === name && !c.is_identity),
          row = Object.fromEntries(
            columns.map((c) => [
              c.column_name,
              c.is_nullable
                ? null
                : c.type_name === "uniqueidentifier"
                  ? randomUUID()
                  : c.type_name === "bit"
                    ? false
                    : /int|decimal|numeric/.test(c.type_name)
                      ? 0
                      : /date|time/.test(c.type_name)
                        ? "2026-01-01T00:00:00Z"
                        : c.column_name.endsWith("_json")
                          ? "{}"
                          : "a".repeat(Math.min(c.max_length / 2, 64)),
            ]),
          );
        Object.assign(row, { branch_id: branch, shift_id: shift });
        if (name === "pos_sync_shift_closing_starts")
          Object.assign(row, { event_id: randomUUID(), proof_json: "{}" });
        if (name === "pos_sync_shift_baselines")
          Object.assign(row, {
            graph_token: "a".repeat(64),
            graph_json: "{}",
            closed_at_raw: "2026-01-01T09:00:00.1234567Z",
          });
        const r = pool.request();
        columns.forEach((c, i) => r.input("fixture_proof_" + i, row[c.column_name]));
        await r.query(
          `INSERT dbo.${id(name)}(${columns.map((c) => id(c.column_name)).join(",")}) VALUES(${columns.map((_, i) => "@fixture_proof_" + i).join(",")});`,
        );
        const before = await snapshot();
        await assert.rejects(execute(f));
        assert.equal(await snapshot(), before);
        await pool.request().query(`DELETE dbo.${id(name)};`);
      }
    });
    await test("unreviewed author-attestation table fails closed", async () => {
      const f = await fixture();
      await pool.request().batch("CREATE TABLE dbo.pos_sync_shift_author_attestations(id int);");
      try {
        const before = await snapshot();
        await assert.rejects(execute(f));
        assert.equal(await snapshot(), before);
      } finally {
        await pool.request().batch("DROP TABLE dbo.pos_sync_shift_author_attestations;");
      }
    });
    await test("checkpoint mutation inside a synthetic fault is detected and rolled back", async () => {
      const f = await fixture(),
        before = await snapshot(),
        anchor = "INSERT @AncillaryAfter";
      assert(f.sql.includes(anchor));
      const fault = f.sql.replace(
        anchor,
        "UPDATE dbo.sync_checkpoints SET committed_cursor=N'Synthetic incorrect cursor';" + anchor,
      );
      await assert.rejects(execute(f, fault));
      assert.equal(await snapshot(), before);
    });
    await test("an enclosing caller transaction is refused and preserved", async () => {
      const f = await fixture(),
        transaction = new sql.Transaction(other);
      await transaction.begin();
      try {
        await assert.rejects(
          new sql.Request(transaction)
            .input("RepairPackage", sql.NVarChar(sql.MAX), f.packageText)
            .input("MaintenanceWindowConfirmed", sql.Bit, true)
            .batch(f.sql),
        );
        const active = (
          await new sql.Request(transaction).query("SELECT @@TRANCOUNT n,XACT_STATE() s;")
        ).recordset[0];
        assert.equal(active.n, 1);
        assert.equal(active.s, 1);
        await transaction.rollback();
      } catch (error) {
        await transaction.rollback().catch(() => {});
        throw error;
      }
    });
    await test("concurrent DDL is blocked or detected before unchecked transactional effects commit", async () => {
      const f = await fixture();
      const marker = "WITH CHANGE_TRACKING_CONTEXT(0x434C4F5544) INSERT dbo.[shift_cash_counts]";
      assert(f.sql.includes(marker));
      let signal;
      const ready = new Promise((resolve) => {
        signal = resolve;
      });
      const request = pool.request();
      request.on("info", (info) => {
        if (info.message.includes("FOURTH54_FIXTURE_LOCKED")) signal();
      });
      const altered = f.sql.replace(
        marker,
        "RAISERROR('FOURTH54_FIXTURE_LOCKED',10,1) WITH NOWAIT;WAITFOR DELAY '00:00:02';" + marker,
      );
      const run = request
        .input("RepairPackage", sql.NVarChar(sql.MAX), f.packageText)
        .input("MaintenanceWindowConfirmed", sql.Bit, true)
        .batch(altered)
        .then(
          () => ({ ok: true }),
          (error) => ({ error }),
        );
      let timer;
      try {
        await Promise.race([
          ready,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(Error("Bounded fixture lock signal did not arrive")),
              5000,
            );
          }),
          run.then(() => {
            throw Error("Fixture ended before lock signal");
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      const ddl = other
        .request()
        .batch(
          "SET LOCK_TIMEOUT 3000;EXEC(N'CREATE TRIGGER dbo.synthetic_concurrent ON dbo.shifts AFTER UPDATE AS BEGIN UPDATE dbo.fixture_stock SET quantity=999;END;');",
        )
        .then(
          () => ({ ok: true }),
          (error) => ({ error }),
        );
      const [result, creation] = await Promise.all([run, ddl]);
      assert.equal(
        (await pool.request().query("SELECT quantity FROM dbo.fixture_stock WHERE id=1;"))
          .recordset[0].quantity,
        37,
      );
      if (result.error) {
        assert(
          [51155, 1222, 1205].includes(
            result.error.number ?? result.error.originalError?.info?.number,
          ),
        );
        assert.equal(
          (
            await pool
              .request()
              .input("shift", shift)
              .query("SELECT status FROM dbo.shifts WHERE id=@shift;")
          ).recordset[0].status,
          "OPEN",
        );
      } else
        assert.equal(
          (
            await pool
              .request()
              .input("repair", maintenanceId)
              .query(
                "SELECT COUNT(*) n FROM dbo.local_operation_receipts WHERE operation_id=@repair;",
              )
          ).recordset[0].n,
          1,
        );
      if (creation.error)
        assert(
          [1222, 1205].includes(
            creation.error.number ?? creation.error.originalError?.info?.number,
          ),
        );
      await pool
        .request()
        .batch(
          "IF OBJECT_ID(N'dbo.synthetic_concurrent') IS NOT NULL DROP TRIGGER dbo.synthetic_concurrent;",
        );
    });
    console.log(passed + " isolated fourth-adoption SQL Server groups passed.");
  } finally {
    await other?.close().catch(() => {});
    await pool?.close().catch(() => {});
    if (master && created) {
      assert(/^Fourth54Fixture_[a-f0-9]{32}$/.test(database));
      await master
        .request()
        .batch(
          `ALTER DATABASE ${id(database)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE;DROP DATABASE ${id(database)};`,
        );
    }
    await master?.close().catch(() => {});
    if (owned) {
      control("stop", instance, "-k");
      control("delete", instance);
    }
    console.log("Cleaned owned fixture " + instance + " / " + database);
  }
}
main().catch((error) => {
  console.error(error.message);
  for (const prior of error.precedingErrors ?? []) console.error(prior.message);
  console.error(error.stack);
  process.exitCode = 1;
});
