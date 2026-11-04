// Preparation-only generator. It never connects to an operator database.
const { createHash } = require("node:crypto");
const {
  parseExactJson,
  isExactNumber,
  decimal,
  instant,
  exactRows,
} = require("../../electron/sync/shift-recovery-exact.cjs");
const NAMES = [
  "shifts",
  "shift_cash_counts",
  "shift_reconciliations",
  "shift_close_events",
  "shift_notifications",
  "shift_variance_alerts",
];
const FIELDS = [
  "closed_at",
  "counted_cash",
  "expected_cash",
  "updated_at",
  "status",
  "closing_float",
  "row_version",
  "expected_card",
  "expected_digital",
  "variance_cash",
  "variance_total",
  "state",
  "close_reason",
  "closing_started_at",
  "closing_started_by",
  "final_counted_cash",
  "variance_status",
];
const quote = (v) => "N'" + String(v).replaceAll("'", "''") + "'";
const ident = (v) => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v)) throw Error("Unsafe schema identifier");
  return "[" + v + "]";
};
const sha = (text, encoding = "utf16le") =>
  createHash("sha256").update(Buffer.from(text, encoding)).digest("hex").toUpperCase();
const encode = (v) => (v == null ? "N" : "V" + String(v).length + ":" + v);
function rowSignature(table, row) {
  return sha(
    table.cloudTable +
      "|" +
      table.columns
        .map((c) => {
          let value = row[c.sqlServerColumn];
          if (value === undefined) throw Error("Incomplete before image");
          if (value !== null) {
            if (c.cloudType === "uuid") value = String(value).toLowerCase();
            else if (c.cloudType === "boolean") value = value === true || value === 1 ? "1" : "0";
            else value = String(value);
          }
          return c.sqlServerColumn + "=" + encode(value);
        })
        .join("|"),
  );
}
function metaSignature(kind, row) {
  return sha(
    kind +
      "|" +
      Object.entries(row)
        .map(
          ([key, value]) =>
            key + "=" + encode(typeof value === "boolean" ? (value ? "true" : "false") : value),
        )
        .join("|"),
  );
}
function sqlScalar(c, expr) {
  return c.cloudType === "uuid"
    ? `LOWER(CONVERT(nvarchar(36),${expr}))`
    : c.cloudType === "boolean"
      ? `CONVERT(nvarchar(1),${expr})`
      : /^(timestamp|date|time)/.test(c.cloudType)
        ? `CONVERT(nvarchar(40),${expr},127)`
        : `CONVERT(nvarchar(max),${expr})`;
}
function signaturesSelect(tables, from, where) {
  return tables
    .map(
      (table) =>
        `SELECT ${quote(table.cloudTable)} table_name,source.id,CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),CONVERT(nvarchar(max),${quote(table.cloudTable + "|")})+cells.facts)),2) signature FROM ${from(table)} source ${from(table).startsWith("@S_") ? "" : "WITH(UPDLOCK,HOLDLOCK,NOWAIT)"} CROSS APPLY(SELECT STRING_AGG(CONVERT(nvarchar(max),c.name+N'='+CASE WHEN c.value IS NULL THEN N'N' ELSE N'V'+CONVERT(nvarchar(20),DATALENGTH(c.value)/2)+N':'+c.value END),N'|') WITHIN GROUP(ORDER BY c.ordinal) facts FROM(VALUES ${table.columns.map((c, i) => `(${i},${quote(c.sqlServerColumn)},${sqlScalar(c, `source.${ident(c.sqlServerColumn)}`)})`).join(",")}) c(ordinal,name,value)) cells ${where ? where(table) : ""}`,
    )
    .join("\nUNION ALL\n");
}
const META_SELECT = {
  columns: `SELECT t.name table_name,c.column_id,c.name column_name,ty.name type_name,c.max_length,c.precision,c.scale,c.is_nullable,c.is_identity,c.is_computed,c.collation_name FROM sys.tables t JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id`,
  defaults: `SELECT t.name table_name,c.name column_name,d.name constraint_name,d.definition FROM sys.tables t JOIN sys.default_constraints d ON d.parent_object_id=t.object_id JOIN sys.columns c ON c.object_id=t.object_id AND c.column_id=d.parent_column_id`,
  checks: `SELECT t.name table_name,c.name,c.definition,c.is_disabled,c.is_not_trusted FROM sys.tables t JOIN sys.check_constraints c ON c.parent_object_id=t.object_id`,
  indexes: `SELECT t.name table_name,i.name index_name,i.type_desc,i.is_unique,i.is_primary_key,i.is_unique_constraint,i.is_disabled,i.has_filter,i.filter_definition,ic.index_column_id,ic.key_ordinal,ic.is_descending_key,ic.is_included_column,c.name column_name FROM sys.tables t JOIN sys.indexes i ON i.object_id=t.object_id JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id`,
  foreign_keys: `SELECT t.name table_name,f.name,OBJECT_NAME(f.referenced_object_id) referenced_table,f.is_disabled,f.is_not_trusted,f.delete_referential_action_desc,f.update_referential_action_desc,fc.constraint_column_id,c.name column_name,rc.name referenced_column FROM sys.tables t JOIN sys.foreign_keys f ON f.parent_object_id=t.object_id JOIN sys.foreign_key_columns fc ON fc.constraint_object_id=f.object_id JOIN sys.columns c ON c.object_id=fc.parent_object_id AND c.column_id=fc.parent_column_id JOIN sys.columns rc ON rc.object_id=fc.referenced_object_id AND rc.column_id=fc.referenced_column_id`,
  keys: `SELECT t.name table_name,k.name,k.type_desc,k.unique_index_id FROM sys.tables t JOIN sys.key_constraints k ON k.parent_object_id=t.object_id`,
  triggers: `SELECT t.name table_name,tr.name,tr.is_disabled,CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),OBJECT_DEFINITION(tr.object_id))),2) definition_sha256,OBJECT_DEFINITION(tr.object_id) definition FROM sys.tables t JOIN sys.triggers tr ON tr.parent_id=t.object_id`,
  tracking: `SELECT t.name table_name,ct.is_track_columns_updated_on FROM sys.tables t JOIN sys.change_tracking_tables ct ON ct.object_id=t.object_id`,
};
function normalizedMetadata(metadata) {
  const result = {};
  for (const kind of Object.keys(META_SELECT))
    result[kind] = (metadata[kind] ?? []).map((row) =>
      kind === "tracking"
        ? {
            table_name: row.table_name,
            is_track_columns_updated_on: row.is_track_columns_updated_on,
          }
        : row,
    );
  return result;
}
function metadataSql(metadata) {
  const expected = normalizedMetadata(metadata);
  const names = [...new Set(metadata.columns.map((r) => r.table_name))].sort();
  const list = names.map(quote).join(",");
  const inserts = Object.entries(expected).map(([kind, rows]) => {
    const keys = Object.keys(rows[0] ?? {});
    if (!keys.length) throw Error("Metadata category missing: " + kind);
    const values = keys
      .map((key, index) => {
        const bool = rows.some((r) => typeof r[key] === "boolean");
        const expr = "s." + ident(key);
        return `(${index},${quote(key)},(${bool ? `CASE WHEN ${expr} IS NULL THEN NULL WHEN ${expr}=1 THEN N'true' ELSE N'false' END` : `CONVERT(nvarchar(max),${expr})`}) COLLATE DATABASE_DEFAULT)`;
      })
      .join(",");
    return `INSERT @ActualMeta SELECT ${quote(kind)},CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),CONVERT(nvarchar(max),${quote(kind + "|")})+canonical.facts)),2) FROM (${META_SELECT[kind]} WHERE t.schema_id=SCHEMA_ID(N'dbo') AND t.name IN(${list})) s CROSS APPLY(SELECT STRING_AGG(CONVERT(nvarchar(max),c.name+N'='+CASE WHEN c.value IS NULL THEN N'N' ELSE N'V'+CONVERT(nvarchar(20),DATALENGTH(c.value)/2)+N':'+c.value END),N'|') WITHIN GROUP(ORDER BY c.ordinal) facts FROM(VALUES ${values}) c(ordinal,name,value)) canonical;`;
  });
  return {
    names,
    expected: Object.entries(expected).flatMap(([kind, rows]) =>
      rows.map((row) => ({ kind, signature: metaSignature(kind, row) })),
    ),
    sql: inserts.join("\n"),
  };
}
function validateSource(text, tables, branch, shift) {
  const graph = parseExactJson(text);
  if (!Array.isArray(graph) || graph.length !== 6)
    throw Error("Need complete six-table accepted source");
  const found = new Map();
  for (const part of graph) {
    if (!NAMES.includes(part.table) || found.has(part.table) || !Array.isArray(part.rows))
      throw Error("Invalid source table set");
    found.set(part.table, part.rows);
  }
  let total = 0;
  for (const table of tables) {
    for (const row of found.get(table.cloudTable)) {
      total++;
      if (
        String(row.store_id).toLowerCase() !== branch.toLowerCase() ||
        String(table.cloudTable === "shifts" ? row.id : row.shift_id).toLowerCase() !==
          shift.toLowerCase()
      )
        throw Error("Wrong source ownership");
      for (const c of table.columns) {
        const v = row[c.cloudColumn];
        if (v === undefined) throw Error("Missing source column " + c.cloudColumn);
        if (v === null) continue;
        if (/^(numeric|decimal|integer|bigint|smallint)/.test(c.cloudType)) {
          const raw = isExactNumber(v) ? v.raw : typeof v === "string" ? v : undefined;
          const canonical = decimal(raw);
          if (typeof raw !== "string" || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw))
            throw Error("Unsupported scalar numeric spelling");
          if (["int", "bigint"].includes(c.sqlServerType.toLowerCase())) {
            if (!/^-?(?:0|[1-9]\d*)$/.test(raw)) throw Error("Noninteger source identity/revision");
            const n = BigInt(raw),
              bits = c.sqlServerType.toLowerCase() === "int" ? 31n : 63n;
            if (n < -(2n ** bits) || n > 2n ** bits - 1n)
              throw Error("Integer source out of range");
          }
          if (canonical === undefined) throw Error("Unprovable source numeric");
          const digits = canonical.replace(/^-/, "").split("e");
          const exponent = Number(digits[1]);
          if (
            canonical !== "0" &&
            (exponent < -12 || digits[0].length + Math.max(0, exponent) > 38)
          )
            throw Error("Source numeric cannot fit local exact precision");
        } else if (/^timestamp/.test(c.cloudType) && instant(v) === undefined)
          throw Error("Unprovable source timestamp");
        else if (
          c.cloudType === "uuid" &&
          (typeof v !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v))
        )
          throw Error("Unprovable source UUID");
        else if (c.cloudType === "boolean" && typeof v !== "boolean")
          throw Error("Unprovable source boolean");
      }
    }
  }
  if (!NAMES.every((name, index) => found.get(name).length === [1, 1, 1, 3, 1, 1][index]))
    throw Error("Unexpected exact seven-child rowset");
  for (const table of tables) {
    const ids = new Set();
    for (const row of found.get(table.cloudTable)) {
      if (ids.has(String(row.id).toLowerCase())) throw Error("Duplicate source row identity");
      ids.add(String(row.id).toLowerCase());
      if (
        typeof row.id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id)
      )
        throw Error("Unprovable source row identity");
    }
  }
  if (
    found.get("shift_reconciliations")[0].count_id !== found.get("shift_cash_counts")[0].id ||
    found.get("shift_variance_alerts")[0].reconciliation_id !==
      found.get("shift_reconciliations")[0].id
  )
    throw Error("Broken source count links");
  const parent = found.get("shifts")[0],
    count = found.get("shift_cash_counts")[0],
    reconciliation = found.get("shift_reconciliations")[0];
  const amount = (v) =>
    v === null ? null : decimal(isExactNumber(v) ? v.raw : typeof v === "string" ? v : undefined);
  const equal = (a, b) => amount(a) !== undefined && amount(a) === amount(b);
  if (
    !equal(parent.counted_cash, parent.final_counted_cash ?? parent.counted_cash) ||
    count.kind !== "ORIGINAL" ||
    !["cash", "card", "digital"].every((t) =>
      equal(count["counted_" + t], reconciliation["counted_" + t]),
    ) ||
    ![
      "counted_card",
      "counted_digital",
      "expected_cash",
      "expected_card",
      "expected_digital",
      "variance_cash",
      "variance_card",
      "variance_digital",
      "variance_total",
    ].every((k) => equal(parent[k], reconciliation[k])) ||
    !equal(parent.final_counted_cash ?? parent.counted_cash, reconciliation.counted_cash) ||
    parent.variance_status !== reconciliation.variance_status
  )
    throw Error("Inconsistent exact accepted closing facts");
  if (
    instant(parent.opened_at) === undefined ||
    instant(parent.closed_at) === undefined ||
    BigInt(instant(parent.closed_at)) < BigInt(instant(parent.opened_at))
  )
    throw Error("Invalid accepted closing times");
  if (
    total !== 8 ||
    found.get("shifts").length !== 1 ||
    found.get("shifts")[0].status !== "CLOSED" ||
    found.get("shifts")[0].state !== "CLOSED"
  )
    throw Error("Not the reviewed one-parent/seven-child closing");
  return graph;
}
function build(spec) {
  const {
    registry,
    metadata,
    identity,
    branch,
    shift,
    sourceGraphText,
    beforeTables,
    otherExpected,
    threeReceipt,
    maintenanceId,
  } = spec;
  if (
    !identity.server_name ||
    !identity.database_name ||
    !identity.database_guid ||
    !branch ||
    !shift ||
    !maintenanceId
  )
    throw Error("Exact identity required");
  const tables = NAMES.map((name) => {
    const t = registry.tables.find((t) => t.cloudTable === name);
    if (!t) throw Error("Missing registered graph table");
    t.columns.forEach((c) => {
      ident(c.sqlServerColumn);
      ident(c.cloudColumn);
      if (
        !/^(?:uniqueidentifier|nvarchar\((?:max|\d+)\)|decimal\(\d+,\d+\)|datetimeoffset\(7\)|date|int|bigint|bit)$/.test(
          c.sqlServerType.toLowerCase(),
        )
      )
        throw Error("Unreviewed SQL type");
    });
    return t;
  });
  const sourceGraph = validateSource(sourceGraphText, tables, branch, shift);
  const beforeExpected = [];
  for (const table of tables) {
    const rows = beforeTables.find((p) => p.table === table.cloudTable)?.rows;
    if (
      !Array.isArray(rows) ||
      (table.cloudTable === "shifts" ? rows.length !== 1 : rows.length !== 0)
    )
      throw Error("Need exact OPEN parent and empty children");
    for (const row of rows)
      beforeExpected.push({
        table_name: table.cloudTable,
        id: row.id.toLowerCase(),
        signature: rowSignature(table, row),
      });
  }
  const before = beforeTables.find((p) => p.table === "shifts").rows[0];
  if (
    before.status !== "OPEN" ||
    before.state !== "ACTIVE" ||
    before.closed_at !== null ||
    String(before.row_version) !== "1"
  )
    throw Error("Unexpected target before image");
  const unchanged = {
    ...tables[0],
    columns: tables[0].columns.filter((c) => !FIELDS.includes(c.sqlServerColumn)),
  };
  if (!exactRows(unchanged, [before], sourceGraph.find((p) => p.table === "shifts").rows))
    throw Error("Source changes unapproved parent facts");
  const meta = metadataSql(metadata);
  const pack = {
    version: 1,
    identity,
    branch,
    shift,
    sourceGraphText,
    beforeTables,
    otherExpected,
    threeReceipt,
    maintenanceId,
    metadata,
  };
  const packageText = JSON.stringify(pack),
    packageHash = sha(packageText),
    fileHash = sha(packageText, "utf8");
  const sql = generateSql({
    tables,
    meta,
    identity,
    branch,
    shift,
    maintenanceId,
    packageHash,
    fileHash,
    beforeExpected,
    otherExpected,
    threeReceipt,
    metadata,
  });
  return { sql, packageText, packageHash, fileHash };
}
function metadataIndexes(ctx, name) {
  return ctx.metadata.indexes.filter(
    (i) => i.table_name === name && i.is_primary_key && i.key_ordinal > 0,
  );
}
function generateSql(ctx) {
  const {
    tables,
    meta,
    identity,
    branch,
    shift,
    maintenanceId,
    packageHash,
    fileHash,
    beforeExpected,
    otherExpected,
    threeReceipt,
  } = ctx;
  const sourceVars = tables
    .map(
      (t) =>
        `DECLARE @S_${t.cloudTable} TABLE(${t.columns.map((c) => ident(c.sqlServerColumn) + " " + c.sqlServerType + " NULL").join(",")});\nINSERT @S_${t.cloudTable} SELECT ${t.columns.map((c, i) => (c.cloudType === "boolean" ? `CASE j${i}.value WHEN N'true' THEN CONVERT(bit,1) WHEN N'false' THEN CONVERT(bit,0) ELSE TRY_CONVERT(bit,j${i}.value) END` : c.cloudType === "jsonb" || c.cloudType.endsWith("[]") ? `CASE j${i}.[type] WHEN 1 THEN N'"'+STRING_ESCAPE(j${i}.value,'json')+N'"' ELSE j${i}.value END` : `TRY_CONVERT(${c.sqlServerType},j${i}.value${/^(timestamp|date|time)/.test(c.cloudType) ? ",127" : ""})`)).join(",")} FROM OPENJSON(@SourceGraph) p CROSS APPLY OPENJSON(p.value,'$.rows') r ${t.columns.map((c, i) => `OUTER APPLY(SELECT value,[type] FROM OPENJSON(r.value) WHERE [key]=${quote(c.cloudColumn)}) j${i}`).join(" ")} WHERE JSON_VALUE(p.value,'$.table')=${quote(t.cloudTable)};`,
    )
    .join("\n");
  const actual = () =>
    signaturesSelect(
      tables,
      (t) => `dbo.${ident(t.cloudTable)}`,
      (t) => `WHERE ${t.cloudTable === "shifts" ? "source.id" : "source.shift_id"}=@Shift`,
    );
  const others = () =>
    signaturesSelect(
      tables,
      (t) => `dbo.${ident(t.cloudTable)}`,
      (t) =>
        `WHERE ${t.cloudTable === "shifts" ? "source.id" : "source.shift_id"}<>@Shift AND (source.store_id=@Branch OR ${t.cloudTable === "shifts" ? "1=0" : "source.shift_id IN(SELECT id FROM dbo.shifts WHERE store_id=@Branch)"})`,
    );
  const proposed = signaturesSelect(tables, (t) => "@S_" + t.cloudTable);
  const ownedTables = meta.names
    .map(
      (name) => `SELECT @Lock=COUNT_BIG(*) FROM dbo.${ident(name)} WITH(TABLOCKX,HOLDLOCK,NOWAIT);`,
    )
    .join("\n");
  const ancillaryNames = [
    ...meta.names.filter((name) => !NAMES.includes(name)),
    ...["sync_checkpoints"].filter((name) => !meta.names.includes(name)),
  ];
  const ancillarySelect = () =>
    ancillaryNames
      .map((name) => {
        const keys =
          name === "sync_checkpoints"
            ? ["organization_id", "branch_id", "entity_type", "direction"]
            : Object.values(metadataIndexes(ctx, name))
                .sort((a, b) => a.key_ordinal - b.key_ordinal)
                .map((c) => c.column_name);
        if (!keys.length) throw Error("Missing protected table primary key");
        return `SELECT ${quote(name)} table_name,CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),(SELECT * FROM dbo.${ident(name)} WITH(TABLOCKX,HOLDLOCK,NOWAIT) ${name === "local_operation_receipts" ? "WHERE operation_id<>@Repair" : ""} ORDER BY ${keys.map(ident).join(",")} FOR JSON PATH,INCLUDE_NULL_VALUES))),2) signature`;
      })
      .join("\nUNION ALL\n");
  const business = ["sales", "bookings", "booking_payments", "payment_transactions"];
  const businessGuards = `SELECT @Lock=COUNT_BIG(*) FROM dbo.booking_payments WITH(TABLOCKX,HOLDLOCK,NOWAIT);SELECT @Lock=COUNT_BIG(*) FROM dbo.sale_items WITH(TABLOCKX,HOLDLOCK,NOWAIT);IF EXISTS(SELECT 1 FROM dbo.booking_payments p LEFT JOIN dbo.bookings b ON b.id=p.booking_id WHERE b.id IS NULL) OR EXISTS(SELECT 1 FROM dbo.sale_items i LEFT JOIN dbo.sales s ON s.id=i.sale_id WHERE s.id IS NULL) THROW 51155,'LOCAL54F orphan business children require separate review.',1;IF EXISTS(SELECT 1 FROM dbo.sales WITH(TABLOCKX,HOLDLOCK,NOWAIT) WHERE store_id=@Branch AND TRY_CONVERT(uniqueidentifier,shift_id)=@Shift) OR EXISTS(SELECT 1 FROM dbo.bookings WITH(TABLOCKX,HOLDLOCK,NOWAIT) WHERE store_id=@Branch AND TRY_CONVERT(uniqueidentifier,shift_id)=@Shift) OR EXISTS(SELECT 1 FROM dbo.payment_transactions WITH(TABLOCKX,HOLDLOCK,NOWAIT) WHERE store_id=@Branch AND TRY_CONVERT(uniqueidentifier,shift_id)=@Shift) THROW 51155,'LOCAL54F linked business records require separate review.',1;`;
  const insertChildren = tables
    .slice(1)
    .map(
      (t) =>
        `WITH CHANGE_TRACKING_CONTEXT(0x434C4F5544) INSERT dbo.${ident(t.cloudTable)}(${t.columns.map((c) => ident(c.sqlServerColumn)).join(",")}) SELECT ${t.columns.map((c) => ident(c.sqlServerColumn)).join(",")} FROM @S_${t.cloudTable};`,
    )
    .join("\n");
  return `-- PREPARATION ONLY. Separate exact local approval and maintenance window required.\n-- Private pinned package is mandatory; no operator payload is embedded here.\n-- Parameters: @RepairPackage nvarchar(max), @MaintenanceWindowConfirmed bit.\nIF @@LOCK_TIMEOUT<>-1 THROW 51155,'LOCAL54F requires a fresh session with its default lock timeout.',1;\nIF @@TRANCOUNT<>0 OR (@@OPTIONS&2)=2 THROW 51155,'LOCAL54F requires its own explicit transaction.',1;\nIF ISNULL(@MaintenanceWindowConfirmed,0)<>1 THROW 51155,'LOCAL54F requires owner-confirmed no-unsaved-checkout/no-concurrent-DDL maintenance window.',1;\nIF @RepairPackage IS NULL OR ISJSON(@RepairPackage)<>1 OR DATALENGTH(@RepairPackage)>4194304 OR CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),@RepairPackage)),2)<>${quote(packageHash)} THROW 51155,'LOCAL54F private package missing or changed.',1;\nIF UPPER(CONVERT(nvarchar(128),SERVERPROPERTY('ServerName')))<>${quote(identity.server_name.toUpperCase())} OR DB_NAME()<>${quote(identity.database_name)} OR NOT EXISTS(SELECT 1 FROM sys.database_recovery_status WHERE database_id=DB_ID() AND database_guid=${quote(identity.database_guid)}) THROW 51155,'LOCAL54F wrong server/database GUID.',1;\nIF HAS_PERMS_BY_NAME(DB_NAME(),'DATABASE','CONTROL')<>1 THROW 51155,'LOCAL54F needs authorized database maintenance access.',1;\nDECLARE @HadXactAbort bit=CASE WHEN (@@OPTIONS&16384)=16384 THEN 1 ELSE 0 END;\nSET LOCK_TIMEOUT 2000;SET XACT_ABORT ON;\nBEGIN TRY\n DECLARE @Branch nvarchar(128)=${quote(branch)},@Shift uniqueidentifier=${quote(shift)},@Repair uniqueidentifier=${quote(maintenanceId)},@Lock bigint,@SourceGraph nvarchar(max);\n SELECT @SourceGraph=sourceGraphText FROM OPENJSON(@RepairPackage) WITH(sourceGraphText nvarchar(max));\n ${sourceVars}\n DECLARE @ExpectedMeta TABLE(kind nvarchar(40),signature varchar(64));\n INSERT @ExpectedMeta SELECT kind,signature FROM OPENJSON(${quote(JSON.stringify(meta.expected))}) WITH(kind nvarchar(40),signature varchar(64));\n DECLARE @ActualMeta TABLE(kind nvarchar(40),signature varchar(64));\n DECLARE @ExpectedBefore TABLE(table_name nvarchar(128),id uniqueidentifier,signature varchar(64));\n INSERT @ExpectedBefore SELECT * FROM OPENJSON(${quote(JSON.stringify(beforeExpected))}) WITH(table_name nvarchar(128),id uniqueidentifier,signature varchar(64));\n DECLARE @ExpectedOther TABLE(table_name nvarchar(128),id uniqueidentifier,signature varchar(64));\n INSERT @ExpectedOther SELECT * FROM OPENJSON(${quote(JSON.stringify(otherExpected))}) WITH(table_name nvarchar(128),id uniqueidentifier,signature varchar(64));\n DECLARE @AncillaryBefore TABLE(table_name nvarchar(128),signature varchar(64));DECLARE @AncillaryAfter TABLE(table_name nvarchar(128),signature varchar(64));\n DECLARE @Current TABLE(table_name nvarchar(128),id uniqueidentifier,signature varchar(64));DECLARE @Proposed TABLE(table_name nvarchar(128),id uniqueidentifier,signature varchar(64));DECLARE @Other TABLE(table_name nvarchar(128),id uniqueidentifier,signature varchar(64));\n INSERT @Proposed ${proposed};\n BEGIN TRANSACTION;\n ${ownedTables}\n ${meta.sql}\n IF EXISTS(SELECT kind,signature,COUNT_BIG(*) n FROM @ActualMeta GROUP BY kind,signature EXCEPT SELECT kind,signature,COUNT_BIG(*) FROM @ExpectedMeta GROUP BY kind,signature) OR EXISTS(SELECT kind,signature,COUNT_BIG(*) FROM @ExpectedMeta GROUP BY kind,signature EXCEPT SELECT kind,signature,COUNT_BIG(*) FROM @ActualMeta GROUP BY kind,signature) THROW 51155,'LOCAL54F schema/default/constraint/index/trigger metadata changed.',1;\n IF OBJECT_ID(N'dbo.pos_sync_shift_author_attestations') IS NOT NULL THROW 51155,'LOCAL54F unexpected author receipt table.',1;\n IF EXISTS(SELECT 1 FROM dbo.pos_sync_shift_closing_starts WHERE branch_id=@Branch AND shift_id=@Shift) OR EXISTS(SELECT 1 FROM dbo.pos_sync_shift_intents WHERE branch_id=@Branch AND shift_id=@Shift) OR EXISTS(SELECT 1 FROM dbo.pos_sync_shift_baselines WHERE branch_id=@Branch AND shift_id=@Shift) THROW 51155,'LOCAL54F target has protected local history.',1;\n IF EXISTS(SELECT 1 FROM dbo.sync_change_journal WHERE acknowledged_at IS NULL AND (branch_id IS NULL OR branch_id=N'global' OR branch_id=@Branch) AND (entity_type IN(${[...NAMES, "sales", "sale_items", "bookings", "booking_payments", "payment_transactions", "held_orders"].map(quote).join(",")}) OR branch_id IS NULL OR branch_id=N'global')) THROW 51155,'LOCAL54F pending or unattributable local work.',1;\n ${businessGuards}\n INSERT @AncillaryBefore ${ancillarySelect()};\n IF EXISTS(SELECT 1 FROM dbo.held_orders WHERE store_id=@Branch AND (TRY_CONVERT(uniqueidentifier,shift_id)=@Shift OR shift_id IS NULL) AND status IS NULL) THROW 51155,'LOCAL54F unknown held order state.',1;\n IF NOT EXISTS(SELECT 1 FROM dbo.local_operation_receipts WHERE operation_id=${quote(threeReceipt.id)} AND operation_type=N'cloud_shift_summary_mirror' AND entity_id=@Branch AND ISJSON(note)=1 AND JSON_VALUE(note,'$.k')=N'LOCAL54' AND JSON_VALUE(note,'$.b')=${quote(threeReceipt.before)} AND JSON_VALUE(note,'$.a')=${quote(threeReceipt.after)} AND JSON_VALUE(note,'$.s')=${quote(threeReceipt.source)} AND CONVERT(nvarchar(40),committed_at,127)=JSON_VALUE(note,'$.t') AND JSON_VALUE(note,'$.u')=SUSER_SNAME()) THROW 51155,'LOCAL54F verified three-shift repair receipt required first.',1;\n INSERT @Current ${actual()};\n INSERT @Other ${others()};\n IF EXISTS(SELECT * FROM @Other EXCEPT SELECT * FROM @ExpectedOther) OR EXISTS(SELECT * FROM @ExpectedOther EXCEPT SELECT * FROM @Other) THROW 51155,'LOCAL54F branch before-image changed; rebind after three-shift readback.',1;\n DECLARE @BeforeDigest varchar(64),@AfterDigest varchar(64),@OtherDigest varchar(64);\n SELECT @BeforeDigest=CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),STRING_AGG(CONVERT(nvarchar(max),table_name+N':'+LOWER(CONVERT(nvarchar(36),id))+N':'+signature),NCHAR(30)) WITHIN GROUP(ORDER BY table_name,CONVERT(nvarchar(36),id)))),2) FROM @ExpectedBefore;\n SELECT @AfterDigest=CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),STRING_AGG(CONVERT(nvarchar(max),table_name+N':'+LOWER(CONVERT(nvarchar(36),id))+N':'+signature),NCHAR(30)) WITHIN GROUP(ORDER BY table_name,CONVERT(nvarchar(36),id)))),2) FROM @Proposed;\n SELECT @OtherDigest=CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),STRING_AGG(CONVERT(nvarchar(max),table_name+N':'+LOWER(CONVERT(nvarchar(36),id))+N':'+signature),NCHAR(30)) WITHIN GROUP(ORDER BY table_name,CONVERT(nvarchar(36),id)))),2) FROM @Other;\n DECLARE @Note nvarchar(400)=(SELECT note FROM dbo.local_operation_receipts WHERE operation_id=@Repair);\n IF @Note IS NOT NULL BEGIN\n  IF ISJSON(@Note)<>1 OR ISNULL(JSON_VALUE(@Note,'$.k'),N'')<>N'LOCAL54F' OR ISNULL(JSON_VALUE(@Note,'$.b'),N'')<>@BeforeDigest OR ISNULL(JSON_VALUE(@Note,'$.a'),N'')<>@AfterDigest OR ISNULL(JSON_VALUE(@Note,'$.o'),N'')<>@OtherDigest OR ISNULL(JSON_VALUE(@Note,'$.p'),N'')<>${quote(fileHash)} OR ISNULL(JSON_VALUE(@Note,'$.u'),N'')<>SUSER_SNAME() OR NOT EXISTS(SELECT 1 FROM dbo.local_operation_receipts WHERE operation_id=@Repair AND operation_type=N'cloud_shift_graph_adoption' AND entity_id=CONVERT(nvarchar(36),@Shift) AND CONVERT(nvarchar(40),committed_at,127)=JSON_VALUE(@Note,'$.t')) OR EXISTS(SELECT * FROM @Current EXCEPT SELECT * FROM @Proposed) OR EXISTS(SELECT * FROM @Proposed EXCEPT SELECT * FROM @Current) THROW 51155,'LOCAL54F replay receipt or current graph mismatch.',1;\n  COMMIT;SET LOCK_TIMEOUT -1;IF @HadXactAbort=0 SET XACT_ABORT OFF;SELECT N'ALREADY ADOPTED / no new history' result;RETURN;\n END;\n IF EXISTS(SELECT * FROM @Current EXCEPT SELECT * FROM @ExpectedBefore) OR EXISTS(SELECT * FROM @ExpectedBefore EXCEPT SELECT * FROM @Current) THROW 51155,'LOCAL54F target before-image changed.',1;\n IF (SELECT COUNT(*) FROM @S_shifts)<>1 OR EXISTS(SELECT 1 FROM @S_shifts WHERE id<>@Shift OR store_id<>@Branch OR status<>N'CLOSED' OR state<>N'CLOSED' OR row_version<>3) THROW 51155,'LOCAL54F source parent does not match approved closing.',1;\n ${insertChildren}\n WITH CHANGE_TRACKING_CONTEXT(0x434C4F5544) UPDATE current_parent SET ${FIELDS.map((name) => ident(name) + "=source." + ident(name)).join(",")} FROM dbo.shifts current_parent JOIN @S_shifts source ON source.id=current_parent.id WHERE current_parent.id=@Shift AND current_parent.store_id=@Branch;\n IF @@ROWCOUNT<>1 THROW 51155,'LOCAL54F exact parent was not updated.',1;\n DELETE @Current;INSERT @Current ${actual()};\n IF EXISTS(SELECT * FROM @Current EXCEPT SELECT * FROM @Proposed) OR EXISTS(SELECT * FROM @Proposed EXCEPT SELECT * FROM @Current) THROW 51155,'LOCAL54F full accepted graph readback failed.',1;\n DELETE @Current;INSERT @Current ${others()};\n IF EXISTS(SELECT * FROM @Current EXCEPT SELECT * FROM @Other) OR EXISTS(SELECT * FROM @Other EXCEPT SELECT * FROM @Current) THROW 51155,'LOCAL54F unrelated history changed.',1;\n DELETE @ActualMeta;\n ${meta.sql}\n IF EXISTS(SELECT kind,signature,COUNT_BIG(*) n FROM @ActualMeta GROUP BY kind,signature EXCEPT SELECT kind,signature,COUNT_BIG(*) FROM @ExpectedMeta GROUP BY kind,signature) OR EXISTS(SELECT kind,signature,COUNT_BIG(*) FROM @ExpectedMeta GROUP BY kind,signature EXCEPT SELECT kind,signature,COUNT_BIG(*) FROM @ActualMeta GROUP BY kind,signature) THROW 51155,'LOCAL54F metadata changed during adoption.',1;\n DECLARE @Committed datetimeoffset(7)=SYSDATETIMEOFFSET();\n DECLARE @Receipt nvarchar(max)=(SELECT N'LOCAL54F' k,@BeforeDigest b,@AfterDigest a,@OtherDigest o,${quote(fileHash)} p,SUSER_SNAME() u,CONVERT(nvarchar(40),@Committed,127) t FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);\n IF DATALENGTH(@Receipt)>800 THROW 51155,'LOCAL54F honest receipt exceeds existing capacity.',1;\n INSERT dbo.local_operation_receipts(operation_id,operation_type,entity_id,note,committed_at) VALUES(@Repair,N'cloud_shift_graph_adoption',CONVERT(nvarchar(36),@Shift),@Receipt,@Committed);\n IF @@ROWCOUNT<>1 THROW 51155,'LOCAL54F receipt insert failed.',1;\n INSERT @AncillaryAfter ${ancillarySelect()};\n IF EXISTS(SELECT * FROM @AncillaryBefore EXCEPT SELECT * FROM @AncillaryAfter) OR EXISTS(SELECT * FROM @AncillaryAfter EXCEPT SELECT * FROM @AncillaryBefore) THROW 51155,'LOCAL54F queue/checkpoint/proof/audit or existing receipts changed.',1;\n COMMIT;SET LOCK_TIMEOUT -1;IF @HadXactAbort=0 SET XACT_ABORT OFF;SELECT N'ADOPTED EXISTING CLOUD GRAPH / not full branch recovery' result;\nEND TRY\nBEGIN CATCH\n IF XACT_STATE()<>0 ROLLBACK;SET LOCK_TIMEOUT -1;IF @HadXactAbort=0 SET XACT_ABORT OFF;THROW;\nEND CATCH;\n`;
}
module.exports = {
  NAMES,
  FIELDS,
  build,
  rowSignature,
  metaSignature,
  metadataSql,
  normalizedMetadata,
  sha,
  META_SELECT,
  validateSource,
};
