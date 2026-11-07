"use strict";

const { randomUUID } = require("node:crypto");
const { binding } = require("../verified-activation.cjs");
const { packageFiles } = require("../db/shift-recovery-metadata.cjs");
const { recordId } = require("./uuid-fields.cjs");
const {
  decimal,
  exactRows,
  instant,
  parseExactJson,
  projection,
  stringifyExactJson,
} = require("./shift-recovery-exact.cjs");

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ACTIVE = new Set(["draft", "held", "waiting", "ready"]);
const REVIEW_MINUTES = 5;
const MAX_REVIEWS = 64;
const ORGANIZATION = "default";
const MAX_GRAPH_BYTES = 512 * 1024;
const MAX_ITEMS = 256;
const MAX_PAYMENTS = 64;
const MAX_HOLD_BYTES = 65536;
const INTEGER_LIMITS = {
  bigint: [-9223372036854775808n, 9223372036854775807n],
  int: [-2147483648n, 2147483647n],
  smallint: [-32768n, 32767n],
  tinyint: [0n, 255n],
};
const graphs = new WeakMap();

const uuid = (value) =>
  typeof value === "string" && UUID.test(recordId(value)) ? recordId(value) : null;
const text = (value, max) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  !/[\u0000-\u001f]/.test(value);
const version = (value) =>
  typeof value === "string" &&
  /^(?:0|[1-9][0-9]{0,18})$/.test(value) &&
  BigInt(value) <= 9223372036854775807n
    ? BigInt(value)
    : null;

function fail(reason) {
  throw Object.assign(
    new Error("Saved bill recovery needs further verification. Local work remains intact."),
    {
      code: `EHELD_SALE_RECOVERY_${reason}`,
    },
  );
}

function keys(value, expected) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function tableOf(registry, name) {
  const table = registry?.tables?.find(
    (table) => table.cloudTable === name && table.sqlServerTable === name,
  );
  if (
    !table ||
    !Array.isArray(table.columns) ||
    !table.columns.some((column) => column.cloudColumn === "id" && column.sqlServerColumn === "id")
  ) {
    fail("SCHEMA");
  }
  return table;
}

// Convert the exact JSON token to plain decimal text. SQL Server does not
// accept scientific notation directly for its exact integer/decimal targets.
function numericText(value, storage) {
  const normalized = decimal(value);
  if (normalized === undefined) fail("PROTOCOL");
  if (normalized === "0") return "0";
  const [, sign, digits, rawExponent] = /^(-?)(\d+)e(-?\d+)$/.exec(normalized);
  const point = digits.length + Number(rawExponent);
  const precision = /^(?:decimal|numeric)\((\d+),\s*(\d+)\)$/.exec(storage);
  if (precision) {
    const scale = Number(precision[2]);
    if (
      Math.max(point, 0) > Number(precision[1]) - scale ||
      Math.max(digits.length - point, 0) > scale
    )
      fail("PROTOCOL");
  } else {
    const limits = INTEGER_LIMITS[storage];
    if (!limits || point < digits.length || point > 19) fail("PROTOCOL");
    const integer = BigInt(sign + digits.padEnd(point, "0"));
    if (integer < limits[0] || integer > limits[1]) fail("PROTOCOL");
  }
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return sign + digits.padEnd(point, "0");
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

function encodeRow(table, row) {
  if (
    !keys(
      row,
      table.columns.map((column) => column.cloudColumn),
    )
  )
    fail("PROTOCOL");
  const encoded = {};
  const values = table.columns.map((column) => {
    const name = column.sqlServerColumn,
      type = String(column.cloudType).toLowerCase();
    const storage = String(column.sqlServerType).toLowerCase();
    if (
      !/^[a-z_][a-z0-9_]*$/.test(name) ||
      !/^(?:uniqueidentifier|bit|datetimeoffset\(7\)|nvarchar\((?:max|\d+)\)|(?:decimal|numeric)\(\d+,\s*\d+\)|bigint|int|smallint|tinyint)$/.test(
        storage,
      )
    )
      fail("SCHEMA");
    const value = row[column.cloudColumn];
    if (value === null && !column.nullable) fail("PROTOCOL");
    let stored = value;
    if (value !== null) {
      if (/^(?:numeric|decimal|bigint|integer|smallint)/.test(type))
        stored = numericText(value, storage);
      else if (type === "jsonb") stored = stringifyExactJson(value, { maxBytes: MAX_GRAPH_BYTES });
      else if (type === "boolean") {
        if (typeof value !== "boolean") fail("PROTOCOL");
      } else if (typeof value !== "string") fail("PROTOCOL");
    }
    encoded[name] = stored;
    return { name, storage, value: typeof stored === "boolean" ? String(Number(stored)) : stored };
  });
  if (!exactRows(table, [encoded], [row])) fail("PROTOCOL");
  return values;
}

function prepareHeldSale({ response, branchId, terminalId, actorId, ticket, registry }) {
  const branch = text(branchId, 128) && recordId(branchId),
    terminal = uuid(terminalId),
    shift = uuid(ticket?.shiftId);
  const bill = ticket?.billNo;
  if (
    !branch ||
    !terminal ||
    !shift ||
    !text(bill, 450) ||
    !text(ticket.id, 450) ||
    ticket.id !== `D:${branch}:${bill}`
  )
    fail("IDENTITY");
  if (
    !keys(response, [
      "ok",
      "version",
      "organizationId",
      "branchId",
      "terminalId",
      "ticketId",
      "billNo",
      "shiftId",
      "actorId",
      "proof",
      "graphJson",
    ]) ||
    response.ok !== true ||
    response.version !== 1 ||
    response.organizationId !== ORGANIZATION ||
    recordId(response.branchId) !== branch ||
    uuid(response.actorId) !== actorId ||
    uuid(response.terminalId) !== terminal ||
    response.ticketId !== ticket.id ||
    response.billNo !== bill ||
    uuid(response.shiftId) !== shift
  )
    fail("PROTOCOL");
  if (response.proof === null && response.graphJson === null) return null;
  if (
    !["cleaned_hold", "completed_hold"].includes(response.proof) ||
    typeof response.graphJson !== "string"
  )
    fail("PROTOCOL");
  let graph;
  try {
    graph = parseExactJson(response.graphJson, { maxBytes: MAX_GRAPH_BYTES, maxDepth: 32 });
  } catch {
    fail("PROTOCOL");
  }
  if (
    !keys(graph, ["sale", "items", "payments"]) ||
    !graph.sale ||
    !Array.isArray(graph.items) ||
    !Array.isArray(graph.payments) ||
    graph.items.length === 0 ||
    graph.items.length > MAX_ITEMS ||
    graph.payments.length > MAX_PAYMENTS
  )
    fail("PROTOCOL");
  const { sale, items, payments } = graph;
  const saleId = uuid(sale.id);
  const allowedBranch = (value) => value === null || recordId(value) === branch;
  if (
    !saleId ||
    sale.bill_number !== bill ||
    recordId(sale.store_id) !== branch ||
    !allowedBranch(sale.branch_id) ||
    uuid(sale.shift_id) !== shift ||
    (payments.length === 0 &&
      !(
        sale.is_exchange === true &&
        decimal(sale.total_amount) === "0" &&
        decimal(sale.paid_amount) === "0"
      ))
  )
    fail("IDENTITY");

  for (const [rows, valid] of [
    [items, (row) => allowedBranch(row.branch_id)],
    [
      payments,
      (row) =>
        recordId(row.store_id) === branch &&
        uuid(row.shift_id) === shift &&
        row.booking_id === null &&
        row.source_type === "sale",
    ],
  ]) {
    const ids = new Set();
    for (const row of rows) {
      const id = uuid(row?.id);
      if (!id || ids.has(id) || uuid(row.sale_id) !== saleId || !valid(row)) fail("IDENTITY");
      ids.add(id);
    }
  }

  const families = [
    ["sales", [sale]],
    ["sale_items", items],
    ["payment_transactions", payments],
  ].map(([name, rows]) => {
    const table = tableOf(registry, name);
    return { name, table, rows, values: rows.map((row) => encodeRow(table, row)) };
  });
  const prepared = Object.freeze({ saleId, billNo: bill, shiftId: shift, ticketId: ticket.id });
  graphs.set(prepared, { families, proof: response.proof });
  return prepared;
}

function idList(request, type, ids, prefix = "row") {
  return ids
    .map((id, index) => {
      const name = prefix + index;
      request.input(name, type, id);
      return "@" + name;
    })
    .join(",");
}

async function lockAbsentGraph({ request, sql, prepared, families }) {
  for (const { name, rows } of families) {
    const q = request().input("sale", sql.UniqueIdentifier, prepared.saleId);
    let where;
    if (name === "sales") {
      q.input("bill", sql.NVarChar(450), prepared.billNo);
      where = "id=@sale OR bill_number=@bill";
    } else {
      const ids = idList(
        q,
        sql.UniqueIdentifier,
        rows.map((row) => row.id),
      );
      where = ids ? `sale_id=@sale OR id IN(${ids})` : "sale_id=@sale";
    }
    if (name !== "sale_items") {
      const transactions = rows
        .map((row) => row.client_transaction_id)
        .filter((value) => value !== null);
      if (transactions.some((value) => !text(value, 450))) fail("PROTOCOL");
      if (transactions.length)
        where += ` OR client_transaction_id IN(${idList(q, sql.NVarChar(450), transactions, "client")})`;
    }
    if (
      (await q.query(`SELECT TOP(1) id FROM dbo.[${name}] WITH(UPDLOCK,HOLDLOCK) WHERE ${where};`))
        .recordset?.length !== 0
    )
      fail("COLLISION");
  }
}

async function assertTracked({ request, sql, branch, targets }) {
  for (const [name, ids] of targets) {
    const bounds = (
      await request()
        .input("entity", sql.NVarChar(128), name)
        .input("branch", sql.NVarChar(128), branch)
        .query(`SELECT CONVERT(varchar(30),CHANGE_TRACKING_CURRENT_VERSION()) current_version,
        CONVERT(varchar(30),CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.'+@entity))) minimum_version,
        (SELECT COUNT(*) FROM dbo.sync_checkpoints WITH(UPDLOCK,HOLDLOCK) WHERE organization_id=N'default' AND branch_id=@branch AND entity_type=@entity AND direction=N'push') checkpoint_count,
        (SELECT CONVERT(varchar(30),MAX(change_tracking_version)) FROM dbo.sync_checkpoints WITH(HOLDLOCK) WHERE organization_id=N'default' AND branch_id=@branch AND entity_type=@entity AND direction=N'push') checkpoint_version,
        (SELECT COUNT(*) FROM dbo.sync_change_journal WITH(UPDLOCK,HOLDLOCK) WHERE (branch_id=@branch OR branch_id=N'global' OR branch_id IS NULL OR branch_id=N'') AND entity_type=@entity AND acknowledged_at IS NULL) pending_count;`)
    ).recordset?.[0];
    const current = version(bounds?.current_version),
      minimum = version(bounds?.minimum_version),
      saved = version(bounds?.checkpoint_version);
    if (
      current === null ||
      minimum === null ||
      saved === null ||
      saved === 0n ||
      minimum > current ||
      saved > current ||
      bounds.checkpoint_count !== 1 ||
      bounds.pending_count !== 0
    )
      fail("PENDING");
    const since = saved < minimum ? minimum : saved;
    const q = request().input("since", sql.VarChar(30), String(since));
    const list = idList(q, name === "held_orders" ? sql.NVarChar(450) : sql.UniqueIdentifier, ids);
    // The expired interval itself is never proof of equivalence. Here the sale
    // and all children have already been locked as absent and the one held
    // row is rechecked in full. Reject any contrary evidence still retained.
    const observed = (
      await q.query(`DECLARE @v bigint=CONVERT(bigint,@since),@changed int=0;
      ${
        list
          ? `IF EXISTS(SELECT 1 FROM CHANGETABLE(CHANGES dbo.[${name}],@v) c
        WHERE c.id IN(${list}) AND (c.SYS_CHANGE_CONTEXT IS NULL OR c.SYS_CHANGE_CONTEXT<>0x434C4F5544)) SET @changed=1;`
          : ""
      }
      SELECT CONVERT(varchar(30),CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.${name}'))) minimum_version,@changed changed;`)
    ).recordset?.[0];
    const observedMinimum = version(observed?.minimum_version);
    if (observedMinimum === null || observedMinimum > since || observed.changed !== 0)
      fail("PENDING");
  }
}

async function writeFamily({ request, sql, name, values }) {
  for (const row of values) {
    const q = request(),
      columns = [],
      expressions = [];
    row.forEach(({ name, storage, value }, index) => {
      const param = `value${index}`;
      q.input(param, sql.NVarChar(sql.MAX), value);
      columns.push(`[${name}]`);
      // Implicit text assignment rejects overflow rather than truncating it.
      expressions.push(
        storage.startsWith("nvarchar(") ? `@${param}` : `CONVERT(${storage},@${param})`,
      );
    });
    try {
      await q.query(
        `WITH CHANGE_TRACKING_CONTEXT(0x434C4F5544) INSERT dbo.[${name}](${columns.join(",")}) VALUES(${expressions.join(",")});`,
      );
    } catch (error) {
      // Missing local dependencies and contested unique keys leave this
      // bill pending without terminating recovery for other saved bills.
      if ([547, 2601, 2627, 51021, 51023].includes(error?.number)) fail("COLLISION");
      throw error;
    }
  }
}

async function verifyGraph({ request, sql, prepared, families }) {
  for (const { name, table, rows } of families) {
    const match = name === "sales" ? "id" : "sale_id";
    const readback = (
      await request()
        .input("sale", sql.UniqueIdentifier, prepared.saleId)
        .query(
          `SELECT TOP(${rows.length + 1}) ${projection(table, "r")} FROM dbo.[${name}] r WITH(HOLDLOCK) WHERE r.[${match}]=@sale;`,
        )
    ).recordset;
    if (!exactRows(table, readback, rows)) fail("POSTIMAGE");
  }
}

const DECISION_TABLE = "pos_held_sale_review_decisions";
const IMMUTABLE_TRIGGER = `CREATE TRIGGER dbo.TR_pos_held_sale_review_decisions_immutable
ON dbo.pos_held_sale_review_decisions INSTEAD OF UPDATE, DELETE
AS
BEGIN
 SET NOCOUNT ON;
 THROW 51029,'Held-sale review decisions are append-only.',1;
END;`;
const DECISION_COLUMNS = [
  ["decision_id", "uniqueidentifier", 16],
  ["database_guid", "uniqueidentifier", 16],
  ["branch_id", "nvarchar", 256],
  ["terminal_id", "uniqueidentifier", 16],
  ["shift_id", "uniqueidentifier", 16],
  ["ticket_id", "nvarchar", 900],
  ["sale_id", "uniqueidentifier", 16],
  ["actor_id", "uniqueidentifier", 16],
  ["source_hash", "char", 64],
  ["proof_kind", "varchar", 16],
  ["reason", "nvarchar", 800],
  ["local_before_json", "nvarchar", -1],
  ["cloud_graph_json", "nvarchar", -1],
  ["decided_at", "datetimeoffset", 10],
];
const ACTIVE_SQL = "h.status IN(N'draft',N'held',N'waiting',N'ready')";
const HOLD_SCOPE_SQL = `h.store_id=@branch AND s.store_id=@branch
  AND s.terminal_id=@terminal AND h.shift_id=CONVERT(nvarchar(36),s.id)
  AND h.shift_id IS NOT NULL AND h.bill_no IS NOT NULL
  AND h.id COLLATE Latin1_General_100_BIN2=CONCAT(N'D:',@branch,N':',h.bill_no) COLLATE Latin1_General_100_BIN2`;

const summaryText = (value, maximum) =>
  typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, maximum) : null;
const amount = (value, storage = "decimal(38,12)") =>
  decimal(value) === undefined ? null : numericText(value, storage);
const itemSummary = (item, local) => ({
  name: summaryText(local ? item?.name : item?.product_name, 200),
  variant: summaryText(local ? (item?.variantLabel ?? item?.variantCode) : item?.variant_code, 120),
  quantity: amount(local ? item?.qty : item?.quantity),
  price: amount(local ? item?.price : item?.unit_price),
});
const publicHold = (hold) => ({
  ticketId: hold.id,
  billNo: hold.bill_no,
  shiftId: uuid(hold.shift_id),
  status: hold.status,
  updatedAt: hold.updated_at,
  rowVersion: hold.row_version,
});
const publicCloud = (plan) => {
  const { families, proof } = graphs.get(plan);
  const [sale] = families[0].rows;
  return {
    saleId: plan.saleId,
    createdAt: sale.created_at,
    total: amount(sale.total_amount),
    paid: amount(sale.paid_amount),
    items: families[1].rows.map((item) => itemSummary(item, false)),
    paymentCount: families[2].rows.length,
    proof,
  };
};

class HeldSaleReview {
  constructor({
    connectionManager,
    registry,
    cloud,
    authority,
    loadPackage = packageFiles,
    now = Date.now,
  }) {
    Object.assign(this, { connectionManager, registry, cloud, authority, loadPackage, now });
    this.held = tableOf(registry, "held_orders");
    this.reviews = new Map();
  }

  capture() {
    const approval = this.authority.capture(),
      source = this.cloud.requestContext(true);
    const pool = this.connectionManager.pool,
      branch = recordId(approval.branchId);
    const terminal = uuid(approval.binding?.terminalId),
      actor = uuid(approval.binding?.authorId);
    const registered = binding(source.terminal);
    if (
      !pool ||
      pool !== source.pool ||
      !/^[a-f0-9]{64}$/.test(source.fingerprint) ||
      !text(branch, 128) ||
      !terminal ||
      !actor ||
      !text(approval.subject, 200) ||
      registered?.mode !== "operations" ||
      registered.platform !== "pc" ||
      registered.id !== terminal ||
      registered.branchId !== branch ||
      source.project?.projectOrigin !== approval.binding.projectOrigin ||
      recordId(source.project.branchId) !== branch ||
      !text(source.profile?.database, 128) ||
      !Object.values(source.personProof ?? {}).some(Boolean)
    )
      fail("CONTEXT");
    const assertCurrent = () => {
      approval.assertCurrent();
      const current = this.cloud.requestContext(true);
      if (
        this.connectionManager.pool !== pool ||
        current.pool !== pool ||
        current.fingerprint !== source.fingerprint
      )
        fail("CONTEXT");
    };
    assertCurrent();
    return {
      pool,
      branch,
      terminal,
      actor,
      sourceHash: source.fingerprint,
      databaseName: source.profile.database,
      assertCurrent,
    };
  }

  query(tx, query, inputs = {}) {
    const sql = this.connectionManager.sql(),
      request = new sql.Request(tx);
    for (const [name, value] of Object.entries(inputs)) request.input(name, value);
    return request.query(query);
  }

  async atomic(context, work) {
    const sql = this.connectionManager.sql(),
      tx = new sql.Transaction(context.pool);
    context.assertCurrent();
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const frame = (
        await this.query(
          tx,
          `SELECT CONVERT(varchar(36),database_guid) guid,
        DB_NAME() database_name,DB_ID(@database) configured_id,DB_ID() database_id,
        @@TRANCOUNT transaction_count,CONVERT(int,@@OPTIONS&2) implicit_transactions,
        (SELECT transaction_isolation_level FROM sys.dm_exec_sessions WHERE session_id=@@SPID) isolation_level
        FROM sys.database_recovery_status WHERE database_id=DB_ID();`,
          { database: context.databaseName },
        )
      ).recordset;
      const current = frame?.[0],
        guid = uuid(current?.guid);
      if (
        frame?.length !== 1 ||
        !guid ||
        current.database_name !== context.databaseName ||
        current.database_id < 5 ||
        current.configured_id !== current.database_id ||
        current.transaction_count !== 1 ||
        current.implicit_transactions !== 0 ||
        current.isolation_level !== 4
      )
        fail("CONTEXT");
      context.assertCurrent();
      const result = await work(tx, guid);
      context.assertCurrent();
      await tx.commit();
      return result;
    } catch (error) {
      await Promise.resolve(tx.rollback()).catch(() => undefined);
      throw error;
    }
  }

  async list({ afterId = null, limit = 25 } = {}) {
    if (
      (afterId !== null && !text(afterId, 450)) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      fail("IDENTITY");
    const context = this.capture();
    return this.atomic(context, async (tx) => {
      const rows = (
        await this.query(
          tx,
          `SELECT TOP(@limit) h.id,h.bill_no,h.shift_id,h.status,h.store_id,s.store_id owned_branch,s.terminal_id owned_terminal,
        CONVERT(nvarchar(40),h.updated_at,127) updated_at, CONVERT(varchar(30),h.row_version) row_version
        FROM dbo.held_orders h JOIN dbo.shifts s ON CONVERT(nvarchar(36),s.id)=h.shift_id
        WHERE ${HOLD_SCOPE_SQL} AND ${ACTIVE_SQL}
        AND (@after IS NULL OR h.id COLLATE Latin1_General_100_BIN2>@after COLLATE Latin1_General_100_BIN2)
        ORDER BY h.id COLLATE Latin1_General_100_BIN2;`,
          {
            limit,
            after: afterId,
            branch: context.branch,
            terminal: context.terminal,
          },
        )
      ).recordset;
      if (!Array.isArray(rows) || rows.length > limit) fail("IDENTITY");
      const items = rows.map((row) => {
        this.assertHold(row, context);
        this.assertOwner(row, context);
        return publicHold(row);
      });
      return {
        available: true,
        items,
        nextAfterId: items.length === limit ? items.at(-1).ticketId : null,
      };
    });
  }

  assertHold(row, context) {
    if (
      !text(row?.bill_no, 450) ||
      !text(row.id, 450) ||
      row.id !== `D:${context.branch}:${row.bill_no}` ||
      !uuid(row.shift_id) ||
      !ACTIVE.has(row.status) ||
      instant(row.updated_at) === undefined ||
      version(row.row_version) === null
    )
      fail("IDENTITY");
  }

  assertOwner(row, context) {
    if (
      recordId(row.store_id) !== context.branch ||
      recordId(row.owned_branch) !== context.branch ||
      uuid(row.owned_terminal) !== context.terminal
    )
      fail("IDENTITY");
  }

  async readHold(tx, context, ticketId) {
    const size =
      this.held.columns
        .filter((c) => /\(max\)/i.test(c.sqlServerType))
        .map((c) => `ISNULL(DATALENGTH(h.[${c.sqlServerColumn}]),0)`)
        .join("+") || "0";
    const rows = (
      await this.query(
        tx,
        `SELECT TOP(2) CASE WHEN ${size}<=${MAX_HOLD_BYTES}
      THEN (SELECT ${projection(this.held, "h")} FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER) END exact_json,s.store_id owned_branch,s.terminal_id owned_terminal
      FROM dbo.held_orders h WITH(UPDLOCK,HOLDLOCK) JOIN dbo.shifts s WITH(UPDLOCK,HOLDLOCK)
        ON CONVERT(nvarchar(36),s.id)=h.shift_id
      WHERE ${HOLD_SCOPE_SQL} AND ${ACTIVE_SQL} AND h.id=@ticket
        AND h.id COLLATE Latin1_General_100_BIN2=@ticket COLLATE Latin1_General_100_BIN2;`,
        { ticket: ticketId, branch: context.branch, terminal: context.terminal },
      )
    ).recordset;
    if (rows?.length !== 1 || !text(rows[0].exact_json, 2 * MAX_HOLD_BYTES)) fail("IDENTITY");
    const raw = rows[0].exact_json,
      row = JSON.parse(raw);
    this.assertHold(row, context);
    this.assertOwner({ ...rows[0], store_id: row.store_id }, context);
    if (row.id !== ticketId) fail("IDENTITY");
    return { raw, row };
  }

  async schemaReady(tx) {
    const result = await this.query(
      tx,
      `SELECT
      OBJECT_ID(N'dbo.${DECISION_TABLE}') object_id,
      HAS_PERMS_BY_NAME(N'dbo.${DECISION_TABLE}',N'OBJECT',N'INSERT') can_insert,
      (SELECT c.name,t.name type,c.max_length,c.is_nullable,c.is_computed,c.is_identity
       FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id
       WHERE c.object_id=OBJECT_ID(N'dbo.${DECISION_TABLE}',N'U') ORDER BY c.column_id FOR JSON PATH) columns_json,
      (SELECT tr.name,tr.is_disabled,tr.is_not_for_replication,tr.is_instead_of_trigger,OBJECT_DEFINITION(tr.object_id) definition
       FROM sys.triggers tr WHERE tr.parent_id=OBJECT_ID(N'dbo.${DECISION_TABLE}',N'U') FOR JSON PATH) triggers_json,
      (SELECT i.name,i.is_disabled,c.name column_name
       FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
       JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
       WHERE i.is_primary_key=1 AND i.object_id=OBJECT_ID(N'dbo.${DECISION_TABLE}',N'U') FOR JSON PATH) keys_json;`,
    );
    if (result.recordset?.length !== 1) fail("SCHEMA");
    const state = result.recordset[0];
    if (state.object_id === null || state.can_insert !== 1) return false;
    const columns = JSON.parse(state.columns_json),
      triggers = JSON.parse(state.triggers_json),
      keys = JSON.parse(state.keys_json);
    return (
      columns.length === DECISION_COLUMNS.length &&
      DECISION_COLUMNS.every(
        ([name, type, size], i) =>
          columns[i].name === name &&
          columns[i].type === type &&
          columns[i].max_length === size &&
          !columns[i].is_nullable &&
          !columns[i].is_computed &&
          !columns[i].is_identity,
      ) &&
      triggers.length === 1 &&
      !triggers[0].is_disabled &&
      !triggers[0].is_not_for_replication &&
      triggers[0].is_instead_of_trigger === true &&
      triggers[0].definition?.replaceAll("\r\n", "\n") === IMMUTABLE_TRIGGER &&
      keys.length === 1 &&
      !keys[0].is_disabled &&
      keys[0].column_name === "decision_id"
    );
  }

  async assertBusinessSchema(tx, context, guid) {
    const manifest = this.loadPackage();
    const rows = (await this.query(tx, manifest.probe.text)).recordset;
    const row = rows?.[0];
    if (
      rows?.length !== 1 ||
      uuid(row.database_guid) !== guid ||
      row.database_name !== context.databaseName ||
      row.core_state !== "supported" ||
      row.transaction_count !== 1 ||
      row.transaction_state !== 1 ||
      row.implicit_transactions !== 0 ||
      !manifest.prefixes.some(
        (prefix) =>
          prefix.prefix === row.prefix &&
          prefix.state === row.metadata_state &&
          prefix.schemaFingerprint === row.schema_fingerprint,
      )
    )
      fail("SCHEMA");
    const triggers = (
      await this.query(
        tx,
        `SELECT tr.name,OBJECT_NAME(tr.parent_id) table_name
      FROM sys.triggers tr WHERE tr.parent_id IN(OBJECT_ID(N'dbo.sales'),OBJECT_ID(N'dbo.sale_items'),
        OBJECT_ID(N'dbo.payment_transactions'),OBJECT_ID(N'dbo.held_orders')); `,
      )
    ).recordset;
    if (
      triggers?.length !== 2 ||
      !triggers.some((t) => t.name === "sales_complete_held_ticket" && t.table_name === "sales") ||
      !triggers.some((t) => t.name === "held_orders_lifecycle" && t.table_name === "held_orders") ||
      !(await this.schemaReady(tx))
    )
      fail("SCHEMA");
  }

  async readCloud(context, ticket) {
    context.assertCurrent();
    const response = await this.cloud.heldSaleReview({
      branchId: context.branch,
      ticketId: ticket.id,
      billNo: ticket.billNo,
      shiftId: ticket.shiftId,
    });
    context.assertCurrent();
    const plan = prepareHeldSale({
      response,
      branchId: context.branch,
      terminalId: context.terminal,
      actorId: context.actor,
      ticket,
      registry: this.registry,
    });
    return { response, plan };
  }

  async preview(ticketId) {
    if (!text(ticketId, 450)) fail("IDENTITY");
    const context = this.capture();
    const before = await this.atomic(context, async (tx, guid) => ({
      guid,
      hold: await this.readHold(tx, context, ticketId),
    }));
    const ticket = {
      id: ticketId,
      billNo: before.hold.row.bill_no,
      shiftId: uuid(before.hold.row.shift_id),
    };
    const { plan, response } = await this.readCloud(context, ticket);
    const ready = await this.atomic(context, async (tx, guid) => {
      if (
        guid !== before.guid ||
        (await this.readHold(tx, context, ticketId)).raw !== before.hold.raw
      )
        fail("CHANGED");
      return this.schemaReady(tx);
    });
    const row = before.hold.row;
    const lines = parseExactJson(row.lines, { maxBytes: MAX_HOLD_BYTES, maxDepth: 32 });
    if (!Array.isArray(lines) || lines.length > 2000) fail("IDENTITY");
    const exceedsComparison = lines.length > MAX_ITEMS;
    const reviewToken = plan && ready && !exceedsComparison ? randomUUID() : null;
    if (reviewToken) {
      if (this.reviews.size >= MAX_REVIEWS) this.reviews.delete(this.reviews.keys().next().value);
      this.reviews.set(reviewToken, {
        context,
        before,
        ticket,
        plan,
        proof: response.proof,
        graphJson: response.graphJson,
        expiresAt: this.now() + REVIEW_MINUTES * 60_000,
      });
    }
    return {
      ticketId,
      billNo: ticket.billNo,
      shiftId: ticket.shiftId,
      local: {
        status: row.status,
        updatedAt: row.updated_at,
        rowVersion: row.row_version,
        total: amount(row.total),
        items: lines.slice(0, MAX_ITEMS).map((item) => itemSummary(item, true)),
        itemCount: lines.length,
      },
      cloud: plan ? publicCloud(plan) : null,
      canAdopt: Boolean(reviewToken),
      reviewToken,
      reason: !plan
        ? "NO_COMPLETION_PROOF"
        : exceedsComparison
          ? "CART_TOO_LARGE"
          : ready
            ? null
            : "SCHEMA_REQUIRED",
    };
  }

  async resolve({ reviewToken, reason }) {
    if (!uuid(reviewToken) || !text(reason, 400) || !reason.trim()) fail("REVIEW");
    reason = reason.trim();
    const saved = this.reviews.get(reviewToken);
    if (!saved || this.now() >= saved.expiresAt) fail("REVIEW");
    const { context, before, ticket } = saved;
    context.assertCurrent();
    if (saved.result) {
      if (saved.reason !== reason) fail("REVIEW");
      return saved.result;
    }
    const { response, plan } = await this.readCloud(context, ticket);
    if (
      !plan ||
      response.proof !== saved.proof ||
      response.graphJson !== saved.graphJson ||
      this.now() >= saved.expiresAt
    )
      fail("CHANGED");
    const result = await this.atomic(context, async (tx, guid) => {
      if (guid !== before.guid) fail("CONTEXT");
      const { saleId } = plan;
      const expected = {
        reviewToken,
        reason,
        context,
        before,
        ticket,
        saleId,
        proof: saved.proof,
        graphJson: saved.graphJson,
      };
      if (!(await this.schemaReady(tx))) fail("SCHEMA");
      if (!(await this.replay(tx, expected))) await this.adopt(tx, plan, expected);
      return Object.freeze({
        state: "ADOPTED",
        ticketId: ticket.id,
        saleId,
        decisionId: reviewToken,
      });
    });
    saved.result = result;
    saved.reason = reason;
    return result;
  }

  async replay(tx, { reviewToken, reason, context, before, ticket, saleId, proof, graphJson }) {
    const rows = (
      await this.query(
        tx,
        `SELECT * FROM dbo.${DECISION_TABLE} WITH(UPDLOCK,HOLDLOCK)
      WHERE decision_id=@id;`,
        { id: reviewToken },
      )
    ).recordset;
    if (!rows?.length) return false;
    const row = rows[0];
    if (
      rows.length !== 1 ||
      uuid(row.database_guid) !== before.guid ||
      row.branch_id !== context.branch ||
      uuid(row.terminal_id) !== context.terminal ||
      uuid(row.actor_id) !== context.actor ||
      uuid(row.shift_id) !== ticket.shiftId ||
      row.ticket_id !== ticket.id ||
      uuid(row.sale_id) !== saleId ||
      row.source_hash !== context.sourceHash ||
      row.proof_kind !== proof ||
      row.reason !== reason ||
      row.local_before_json !== before.hold.raw ||
      row.cloud_graph_json !== graphJson
    )
      fail("REVIEW");
    return true;
  }

  async adopt(
    tx,
    plan,
    { reviewToken, reason, context, before, ticket, saleId, proof, graphJson },
  ) {
    const { families } = graphs.get(plan);
    const sql = this.connectionManager.sql(),
      request = () => new sql.Request(tx);
    await lockAbsentGraph({ request, sql, prepared: plan, families });
    const aliases = (
      await this.query(
        tx,
        `SELECT TOP(2) id FROM dbo.held_orders WITH(UPDLOCK,HOLDLOCK)
      WHERE store_id=@branch AND bill_no=@bill;`,
        { branch: context.branch, bill: ticket.billNo },
      )
    ).recordset;
    if (aliases?.length !== 1 || aliases[0].id !== ticket.id) fail("IDENTITY");
    if ((await this.readHold(tx, context, ticket.id)).raw !== before.hold.raw) fail("CHANGED");
    await assertTracked({
      request,
      sql,
      branch: context.branch,
      targets: [
        ...families.map(({ name, rows }) => [name, rows.map((row) => row.id)]),
        ["held_orders", [ticket.id]],
      ],
    });
    await this.assertBusinessSchema(tx, context, before.guid);
    if (this.now() >= this.reviews.get(reviewToken)?.expiresAt || !this.reviews.has(reviewToken))
      fail("REVIEW");
    context.assertCurrent();
    const old = before.hold.row;
    for (const family of families) await writeFamily({ request, sql, ...family });
    const readback = async () =>
      (
        await this.query(
          tx,
          `SELECT
      (SELECT ${projection(this.held, "h")} FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER) exact_json
      FROM dbo.held_orders h WITH(HOLDLOCK) WHERE h.id=@id;`,
          { id: ticket.id },
        )
      ).recordset?.[0]?.exact_json;
    const closedText = await readback();
    if (!text(closedText, 2 * MAX_HOLD_BYTES)) fail("POSTIMAGE");
    const closed = JSON.parse(closedText),
      oldVersion = version(old.row_version);
    if (
      oldVersion === null ||
      version(closed.row_version) !== oldVersion + 1n ||
      instant(closed.updated_at) === undefined ||
      JSON.stringify({
        ...old,
        status: "completed",
        row_version: closed.row_version,
        updated_at: closed.updated_at,
      }) !== JSON.stringify(closed)
    )
      fail("POSTIMAGE");
    // The existing sale trigger can complete a held bill. Its nested write
    // drops the outer SQL Change Tracking context, so mark only its exact row.
    const stamped = (
      await this.query(
        tx,
        `DECLARE @updated TABLE(id nvarchar(450));
      WITH CHANGE_TRACKING_CONTEXT(0x434C4F5544) UPDATE dbo.held_orders SET status=status
      OUTPUT inserted.id INTO @updated WHERE id=@id AND status=N'completed';
      SELECT COUNT(*) matched FROM @updated;`,
        { id: ticket.id },
      )
    ).recordset;
    if (stamped?.[0]?.matched !== 1 || (await readback()) !== closedText) fail("POSTIMAGE");
    await verifyGraph({ request, sql, prepared: plan, families });
    context.assertCurrent();
    const decision = request();
    for (const [name, value] of Object.entries({
      id: reviewToken,
      database: before.guid,
      branch: context.branch,
      terminal: context.terminal,
      shift: ticket.shiftId,
      ticket: ticket.id,
      sale: saleId,
      actor: context.actor,
      source: context.sourceHash,
      proof,
      reason,
    }))
      decision.input(name, value);
    await decision
      .input("before", sql.NVarChar(sql.MAX), before.hold.raw)
      .input("graph", sql.NVarChar(sql.MAX), graphJson).query(`INSERT dbo.${DECISION_TABLE}(
        decision_id,database_guid,branch_id,terminal_id,shift_id,ticket_id,sale_id,actor_id,source_hash,proof_kind,
        reason,local_before_json,cloud_graph_json,decided_at)
      VALUES(@id,@database,@branch,@terminal,@shift,@ticket,@sale,@actor,@source,@proof,@reason,@before,@graph,SYSDATETIMEOFFSET());`);
  }
}

module.exports = { HeldSaleReview };
