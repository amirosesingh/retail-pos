"use strict";
// Replica maintenance only. It never accepts a payment, uploads a ticket,
// copies a financial parent, acknowledges a queue or advances a checkpoint.
const { createHash } = require("node:crypto");
const { packageFiles } = require("../db/shift-recovery-metadata.cjs");
const { stableUuid } = require("../db/repositories/aggregates.cjs");
const { recordId } = require("./uuid-fields.cjs");
const {
  parseExactJson,
  stringifyExactJson,
  isExactNumber,
  exactRows,
  projection,
  instant,
} = require("./shift-recovery-exact.cjs");
const LINE_KEYS = Object.freeze([
  "saleItemId",
  "productId",
  "variantCode",
  "price",
  "originalPrice",
  "priceOverridden",
  "qty",
  "taxRate",
  "discount",
  "discountType",
  "credit",
  "foc",
  "promoId",
  "couponCode",
  "couponDiscount",
  "bookingId",
  "bookingRef",
]);
const COUPON_KEYS = Object.freeze(["code", "promoId", "scope", "discount", "productId"]);
const IDENTITY_KEYS = Object.freeze([
  "id",
  "store_id",
  "bill_no",
  "shift_id",
  "total",
  "cart_discount",
  "cart_discount_type",
  "exchange_ref",
  "member_id",
  "coupon",
  "lines",
  "pending_request_id",
  "approval_snapshot_hash",
]);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ACTIVE = new Set(["draft", "held", "waiting", "ready"]);
const MAX_IDS = 100,
  MAX_LOCAL_BYTES = 65536;
const RECEIPT_TYPE = "held_status_cloud_adoption_v1";
// Booking lines are stored in bookings.lines in the canonical registry.
const FAMILIES = {
  sale: ["sales", "sale_items", "payment_transactions"],
  booking: ["bookings", "booking_payments"],
};
const MESSAGE = "Held tickets need further verification. Saved local work remains intact.";
const fail = (code) => {
  throw Object.assign(new Error(MESSAGE), { code });
};
const hash = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const text = (value, max = 450) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  !/[\u0000-\u001f]/.test(value);
const version = (value) =>
  typeof value === "string" &&
  /^(?:0|[1-9][0-9]{0,18})$/.test(value) &&
  BigInt(value) <= 9223372036854775807n
    ? value
    : null;
function object(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every((value) =>
    Object.hasOwn(value, "value"),
  );
}
function scalar(value) {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    isExactNumber(value)
  );
}
function safeObject(value, keys) {
  if (!object(value)) fail("EHELD_STATUS_IDENTITY");
  const result = {};
  for (const key of keys)
    if (Object.hasOwn(value, key)) {
      if (!scalar(value[key])) fail("EHELD_STATUS_IDENTITY");
      result[key] = value[key];
    }
  return result;
}
function projectIdentity(row, { local = false } = {}) {
  if (!object(row)) fail("EHELD_STATUS_IDENTITY");
  const result = {};
  for (const key of IDENTITY_KEYS) {
    if (!Object.hasOwn(row, key)) fail("EHELD_STATUS_IDENTITY");
    result[key] = row[key];
  }
  if (IDENTITY_KEYS.some((key) => !["lines", "coupon"].includes(key) && !scalar(result[key])))
    fail("EHELD_STATUS_IDENTITY");
  const lines = local
    ? parseExactJson(row.lines, { maxBytes: MAX_LOCAL_BYTES, maxDepth: 32 })
    : row.lines;
  if (!Array.isArray(lines) || lines.length > 2000) fail("EHELD_STATUS_IDENTITY");
  result.lines = lines.map((line) => {
    if (!local && object(line) && Object.keys(line).some((key) => !LINE_KEYS.includes(key)))
      fail("EHELD_STATUS_IDENTITY");
    return safeObject(line, LINE_KEYS);
  });
  const coupon =
    local && typeof row.coupon === "string"
      ? parseExactJson(row.coupon, { maxBytes: MAX_LOCAL_BYTES, maxDepth: 32 })
      : row.coupon;
  if (!local && object(coupon) && Object.keys(coupon).some((key) => !COUPON_KEYS.includes(key)))
    fail("EHELD_STATUS_IDENTITY");
  result.coupon = coupon === null ? null : safeObject(coupon, COUPON_KEYS);
  if (local) {
    result.lines = stringifyExactJson(result.lines, { maxBytes: MAX_LOCAL_BYTES });
    result.coupon =
      result.coupon === null
        ? null
        : stringifyExactJson(result.coupon, { maxBytes: MAX_LOCAL_BYTES });
  }
  return result;
}
function normalizeResponse(value, { branchId, terminalId, tickets, onOversized = null }) {
  if (
    !object(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          "ok",
          "heldStatusVersion",
          "organizationId",
          "branchId",
          "terminalId",
          "records",
        ].includes(key),
    ) ||
    value.ok !== true ||
    value.heldStatusVersion !== 1 ||
    value.organizationId !== "default" ||
    recordId(value.branchId) !== branchId ||
    recordId(value.terminalId) !== terminalId ||
    !Array.isArray(value.records) ||
    value.records.length > tickets.length
  )
    fail("EHELD_STATUS_PROTOCOL");
  const requested = new Map(tickets.map((ticket) => [ticket.id, ticket])),
    seen = new Set();
  return value.records
    .map((row) => {
      if (
        !object(row) ||
        Object.keys(row).length !== 7 ||
        Object.keys(row).some(
          (key) =>
            ![
              "id",
              "status",
              "proofFrom",
              "rowVersion",
              "updatedAt",
              "identityJson",
              "parent",
            ].includes(key),
        ) ||
        !requested.has(row.id) ||
        seen.has(row.id) ||
        !["completed", "cancelled"].includes(row.status) ||
        !["held", "accepted_parent"].includes(row.proofFrom)
      )
        fail("EHELD_STATUS_PROTOCOL");
      seen.add(row.id);
      const ticket = requested.get(row.id);
      if (row.proofFrom === "accepted_parent") {
        if (
          row.status !== "completed" ||
          row.identityJson !== null ||
          row.rowVersion !== null ||
          row.updatedAt !== null
        )
          fail("EHELD_STATUS_PROTOCOL");
      } else {
        if (
          !version(row.rowVersion) ||
          BigInt(row.rowVersion) < 1n ||
          BigInt(row.rowVersion) > 2147483647n ||
          typeof row.updatedAt !== "string" ||
          instant(row.updatedAt) === undefined ||
          typeof row.identityJson !== "string"
        )
          fail("EHELD_STATUS_PROTOCOL");
        if (Buffer.byteLength(row.identityJson) > MAX_LOCAL_BYTES) {
          if (!onOversized) fail("EHELD_STATUS_PROTOCOL");
          onOversized();
          return null;
        }
        const exact = parseExactJson(row.identityJson, { maxBytes: MAX_LOCAL_BYTES, maxDepth: 32 });
        if (
          !object(exact) ||
          Object.keys(exact).length !== IDENTITY_KEYS.length ||
          Object.keys(exact).some((key) => !IDENTITY_KEYS.includes(key))
        )
          fail("EHELD_STATUS_PROTOCOL");
        if (
          exact.id !== row.id ||
          recordId(exact.store_id) !== branchId ||
          exact.bill_no !== ticket.billNo ||
          recordId(exact.shift_id) !== recordId(ticket.shiftId)
        )
          fail("EHELD_STATUS_PROTOCOL");
        const projected = projectIdentity(exact);
        // projectIdentity rejects unexpected remote keys; object key order is not
        // authority and JSONB serialization may legitimately reorder them.
        row = { ...row, exact: projected };
      }
      if (row.status === "cancelled") {
        if (row.parent !== null || row.proofFrom !== "held") fail("EHELD_STATUS_PROTOCOL");
      } else {
        const parent = row.parent;
        if (
          !object(parent) ||
          Object.keys(parent).length !== 5 ||
          Object.keys(parent).some(
            (key) => !["kind", "id", "storeId", "billNo", "shiftId"].includes(key),
          ) ||
          !["sale", "booking"].includes(parent.kind) ||
          !UUID.test(recordId(parent.id)) ||
          recordId(parent.storeId) !== branchId ||
          !(parent.billNo === null || text(parent.billNo)) ||
          !(parent.shiftId === null || UUID.test(recordId(parent.shiftId)))
        )
          fail("EHELD_STATUS_PROTOCOL");
        if (
          parent.kind === "sale" &&
          (!ticket.billNo ||
            parent.billNo !== ticket.billNo ||
            (row.proofFrom === "accepted_parent" &&
              ticket.shiftId !== null &&
              recordId(parent.shiftId) !== recordId(ticket.shiftId)))
        )
          fail("EHELD_STATUS_PROTOCOL");
        if (
          parent.kind === "booking" &&
          (row.proofFrom === "accepted_parent" ||
            parent.billNo !== null ||
            ticket.shiftId === null ||
            recordId(parent.shiftId) !== recordId(ticket.shiftId))
        )
          fail("EHELD_STATUS_PROTOCOL");
      }
      return row;
    })
    .filter(Boolean);
}
function adoptionReceipt({
  databaseGuid,
  branchId,
  terminalId,
  record,
  beforeJson,
  oldStatus,
  sourceKey,
}) {
  const evidence = {
    id: record.id,
    status: record.status,
    proofFrom: record.proofFrom,
    rowVersion: record.rowVersion,
    updatedAt: record.updatedAt,
    identityJson: record.identityJson,
    parent: record.parent,
  };
  const beforeHash = hash(beforeJson),
    evidenceHash = hash(JSON.stringify({ source: hash(sourceKey), evidence }));
  const id = stableUuid({
    domain: RECEIPT_TYPE,
    databaseGuid,
    branchId,
    terminalId,
    heldId: record.id,
    beforeHash,
    evidenceHash,
  });
  // A compact status delta and integrity witness, not a full backup or a cloud
  // upload receipt. Every other business value remains unchanged at commit.
  const note = JSON.stringify({
    v: 1,
    g: databaseGuid,
    t: terminalId,
    s: oldStatus,
    to: record.status,
    h: beforeHash,
    p: record.parent?.id ?? null,
    e: evidenceHash,
    k: record.proofFrom,
  });
  if (note.length > 400) fail("EHELD_STATUS_RECEIPT");
  return { id, type: RECEIPT_TYPE, entity: hash(record.id), note };
}
// Lease one existing pool connection; no temporary pool or new sync channel.
async function pinned(manager, work) {
  const sql = manager.sql(),
    pool = manager.pool;
  const lease = await new Promise((yes, no) =>
    pool.acquire(new sql.Request(pool), (error, connection, config) =>
      error ? no(error) : yes({ connection, config }),
    ),
  );
  let active = false,
    discard = false,
    changed = false,
    baseline;
  const parent = {
    config: lease.config,
    connected: true,
    acquire(_request, callback) {
      if (active)
        return queueMicrotask(() =>
          callback(Object.assign(Error(MESSAGE), { code: "EREQINPROG" })),
        );
      active = true;
      queueMicrotask(() => callback(null, lease.connection, lease.config));
    },
    release(connection) {
      if (connection === lease.connection) active = false;
    },
  };
  const request = () => new sql.Request(parent);
  try {
    baseline = (
      await request().query(
        "SELECT @@TRANCOUNT transaction_count,CONVERT(int,@@OPTIONS&2) implicit_transactions,@@LOCK_TIMEOUT lock_timeout,transaction_isolation_level isolation_level,deadlock_priority FROM sys.dm_exec_sessions WHERE session_id=@@SPID;",
      )
    ).recordset?.[0];
    if (
      !baseline ||
      baseline.transaction_count !== 0 ||
      baseline.implicit_transactions !== 0 ||
      baseline.isolation_level !== 2 ||
      !Number.isInteger(baseline.lock_timeout) ||
      baseline.lock_timeout < -1 ||
      !Number.isInteger(baseline.deadlock_priority) ||
      Math.abs(baseline.deadlock_priority) > 10
    )
      fail("EHELD_STATUS_SESSION");
    await request().query("SET LOCK_TIMEOUT 1000;SET DEADLOCK_PRIORITY LOW;");
    changed = true;
    return await work({ request, parent, sql });
  } finally {
    try {
      const state = (await request().query("SELECT @@TRANCOUNT transaction_count;")).recordset?.[0];
      if (!state || state.transaction_count !== 0) discard = true;
      if (changed && !discard)
        await request().query(
          "SET TRANSACTION ISOLATION LEVEL READ COMMITTED;SET LOCK_TIMEOUT " +
            baseline.lock_timeout +
            ";SET DEADLOCK_PRIORITY " +
            baseline.deadlock_priority +
            ";",
        );
    } catch {
      discard = true;
    }
    try {
      if (discard) {
        lease.connection.hasError = true;
        await new Promise((done) => lease.connection.close(() => done()));
      }
    } finally {
      pool.release(lease.connection);
    }
  }
}
class HeldStatusRecovery {
  constructor({ manager, registry, cloud, publish = () => {}, loadPackage = packageFiles }) {
    Object.assign(this, { manager, registry, cloud, publish, loadPackage });
    this.table = registry.tables.find((table) => table.cloudTable === "held_orders");
    this.identityTable = {
      ...this.table,
      columns: this.table?.columns.filter((column) => IDENTITY_KEYS.includes(column.cloudColumn)),
    };
  }
  async reconcile({
    branchId,
    terminalId,
    profile,
    assertCurrent,
    sourceKey,
    expectedDatabaseGuid,
    expectedDatabaseName,
  }) {
    if (
      typeof assertCurrent !== "function" ||
      !text(branchId, 128) ||
      !UUID.test(recordId(terminalId)) ||
      !profile?.database ||
      !text(sourceKey, 256) ||
      !UUID.test(expectedDatabaseGuid) ||
      !text(expectedDatabaseName, 128) ||
      !this.table
    )
      fail("EHELD_STATUS_CONTEXT");
    branchId = recordId(branchId);
    terminalId = recordId(terminalId);
    assertCurrent();
    const pool = this.manager.pool;
    if (!pool) fail("EHELD_STATUS_CONTEXT");
    const bound = () => {
      assertCurrent();
      if (this.manager.pool !== pool) fail("EHELD_STATUS_CONTEXT");
    };
    return pinned(this.manager, async ({ request, parent, sql }) => {
      const select = projection(this.table, "h"),
        size =
          this.table.columns
            .filter((column) => /\(max\)/i.test(column.sqlServerType))
            .map((column) => "ISNULL(DATALENGTH(h.[" + column.sqlServerColumn + "]),0)")
            .join("+") || "0";
      const read = async ({
        tx = null,
        after = null,
        upper = null,
        maximum = MAX_IDS,
        ids = null,
      } = {}) => {
        bound();
        const q = tx ? new sql.Request(tx) : request();
        const keys = ids
          ?.map((id, index) => {
            q.input("held" + index, sql.NVarChar(450), id);
            return "@held" + index;
          })
          .join(",");
        const restrict = keys
          ? `AND h.id IN(${keys}) AND h.id COLLATE Latin1_General_100_BIN2 IN(${keys})`
          : "AND (@after IS NULL OR h.id COLLATE Latin1_General_100_BIN2>@after COLLATE Latin1_General_100_BIN2) AND h.id COLLATE Latin1_General_100_BIN2<=@upper COLLATE Latin1_General_100_BIN2";
        if (!ids)
          q.input("after", sql.NVarChar(450), after).input("upper", sql.NVarChar(450), upper);
        const result = await q
          .input("branch", sql.NVarChar(128), branchId)
          .input("maximum", sql.Int, maximum)
          .query(`SELECT TOP(@maximum) h.id,h.store_id,h.bill_no,h.shift_id,h.status,
      CASE WHEN ${size}<=${MAX_LOCAL_BYTES} THEN (SELECT ${select} FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER) END exact_json
      FROM dbo.held_orders h ${tx ? "WITH(UPDLOCK,HOLDLOCK)" : ""} WHERE h.store_id=@branch AND h.status IN(N'draft',N'held',N'waiting',N'ready') ${restrict} ORDER BY h.id COLLATE Latin1_General_100_BIN2;`);
        bound();
        return result.recordset ?? [];
      };
      const frame = (
        await request()
          .input("branch", sql.NVarChar(128), branchId)
          .query(
            "SELECT CONVERT(varchar(30),COUNT_BIG(*)) total,MAX(id COLLATE Latin1_General_100_BIN2) upper_id FROM dbo.held_orders WHERE store_id=@branch AND status IN(N'draft',N'held',N'waiting',N'ready');",
          )
      ).recordset?.[0];
      bound();
      if (
        !version(frame?.total) ||
        (frame.total !== "0" && (typeof frame.upper_id !== "string" || frame.upper_id.length > 450))
      )
        fail("EHELD_STATUS_IDENTITY");
      if (frame.total === "0")
        return { updated: 0, reviewRequired: 0, deferred: false, code: null };
      const guid = expectedDatabaseGuid,
        name = expectedDatabaseName;
      const witness = async (tx = null) => {
        const q = tx ? new sql.Request(tx) : request();
        const value = (
          await q.input("database", sql.NVarChar(128), profile.database)
            .query(`SELECT LOWER(CONVERT(varchar(36),database_guid)) database_guid,DB_NAME() database_name,DB_ID(@database) configured_id,DB_ID() actual_id,
     (SELECT tr.name,OBJECT_NAME(tr.parent_id) table_name,tr.is_disabled,tr.is_not_for_replication,OBJECT_DEFINITION(tr.object_id) definition FROM sys.triggers tr WHERE tr.parent_id IN(OBJECT_ID(N'dbo.held_orders'),OBJECT_ID(N'dbo.local_operation_receipts')) OR tr.object_id=OBJECT_ID(N'dbo.sales_complete_held_ticket') ORDER BY tr.name FOR JSON PATH,INCLUDE_NULL_VALUES) triggers_json,
     (SELECT c.name,ty.name type,c.max_length,c.precision,c.scale,c.is_nullable FROM sys.columns c JOIN sys.types ty ON c.user_type_id=ty.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.held_orders') ORDER BY c.column_id FOR JSON PATH,INCLUDE_NULL_VALUES) columns_json
     FROM sys.database_recovery_status WHERE database_id=DB_ID();`)
        ).recordset;
        bound();
        if (
          value?.length !== 1 ||
          value[0].database_guid !== guid ||
          value[0].database_name !== name ||
          value[0].configured_id !== value[0].actual_id
        )
          fail("EHELD_STATUS_CONTEXT");
        const triggers = JSON.parse(value[0].triggers_json);
        if (
          triggers.length !== 2 ||
          !triggers.some(
            (row) => row.name === "held_orders_lifecycle" && row.table_name === "held_orders",
          ) ||
          !triggers.some(
            (row) => row.name === "sales_complete_held_ticket" && row.table_name === "sales",
          ) ||
          triggers.some(
            (row) =>
              row.is_disabled || row.is_not_for_replication || typeof row.definition !== "string",
          )
        )
          fail("EHELD_STATUS_SCHEMA");
        return hash(value[0].triggers_json + "\n" + value[0].columns_json);
      };
      const schemaWitness = await witness();
      // Bind the packaged validation to this same schema before and after its
      // metadata reads; a swapped trigger cannot become a newly trusted witness.
      const manifest = this.loadPackage();
      bound();
      const proof = (await request().query(manifest.probe.text)).recordset;
      bound();
      if (
        proof?.length !== 1 ||
        proof[0].core_state !== "supported" ||
        !["absent", "prefix", "matching"].includes(proof[0].metadata_state) ||
        proof[0].transaction_count !== 0 ||
        proof[0].implicit_transactions !== 0 ||
        ![0, 1].includes(proof[0].transaction_state) ||
        proof[0].database_guid !== guid ||
        proof[0].database_name !== name ||
        !manifest.prefixes.some(
          (value) =>
            value.prefix === proof[0].prefix &&
            value.state === proof[0].metadata_state &&
            value.schemaFingerprint === proof[0].schema_fingerprint,
        ) ||
        (await witness()) !== schemaWitness
      )
        fail("EHELD_STATUS_SCHEMA");
      const merge = (left, right) => ({
        updated: left.updated + right.updated,
        reviewRequired: left.reviewRequired + right.reviewRequired,
        deferred: left.deferred || right.deferred,
        code: left.code ?? right.code,
      });
      const processRows = async (rows) => {
        const snapshots = new Map();
        for (const row of rows) {
          if (
            !text(row.id) ||
            recordId(row.store_id) !== branchId ||
            !(row.bill_no === null || text(row.bill_no)) ||
            !(row.shift_id === null || UUID.test(recordId(row.shift_id))) ||
            !ACTIVE.has(row.status) ||
            typeof row.exact_json !== "string" ||
            Buffer.byteLength(row.exact_json) > MAX_LOCAL_BYTES * 2
          )
            continue;
          try {
            const exact = JSON.parse(row.exact_json);
            snapshots.set(row.id, {
              row,
              exact,
              identity: projectIdentity(exact, { local: true }),
            });
          } catch {
            /* A malformed retained ticket is reviewed, never allowed to starve later IDs. */
          }
        }
        if (!snapshots.size)
          return {
            updated: 0,
            reviewRequired: rows.length,
            deferred: true,
            code: "EHELD_STATUS_IDENTITY",
          };
        const tickets = [...snapshots.values()].map(({ row }) => ({
          id: row.id,
          billNo: row.bill_no,
          shiftId: row.shift_id,
        }));
        bound();
        let response;
        try {
          response = await this.cloud.heldStatuses({
            organizationId: "default",
            branchId,
            tickets,
          });
        } catch (error) {
          bound();
          if (error?.code !== "54000" || error?.message !== "HELD_STATUS_TOO_LARGE") throw error;
          if (rows.length === 1)
            return {
              updated: 0,
              reviewRequired: 1,
              deferred: true,
              code: "EHELD_STATUS_OVERSIZED",
            };
          const middle = Math.ceil(rows.length / 2);
          return merge(
            await processRows(rows.slice(0, middle)),
            await processRows(rows.slice(middle)),
          );
        }
        let oversized = false;
        const remote = normalizeResponse(response, {
          branchId,
          terminalId,
          tickets,
          onOversized: () => {
            oversized = true;
          },
        });
        bound();
        if (!remote.length)
          return {
            updated: 0,
            reviewRequired: rows.length,
            deferred: true,
            code: oversized ? "EHELD_STATUS_OVERSIZED" : "EHELD_STATUS_REVIEW",
          };
        bound();
        const transaction = new sql.Transaction(parent);
        await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        let updated = 0,
          reviewRequired = rows.length - remote.length,
          code = oversized ? "EHELD_STATUS_OVERSIZED" : null;
        const blocked = (value) => {
          reviewRequired++;
          code ??= value;
        };
        try {
          // Business-before-evidence order matches the ordinary aggregate writer.
          const parents = new Map();
          for (const record of remote
            .filter((row) => row.parent)
            .sort((a, b) =>
              (a.parent.kind + ":" + a.parent.id).localeCompare(b.parent.kind + ":" + b.parent.id),
            )) {
            const p = record.parent,
              q = new sql.Request(transaction);
            q.input("branch", sql.NVarChar(128), branchId)
              .input("id", sql.UniqueIdentifier, p.id)
              .input("bill", sql.NVarChar(450), p.billNo);
            const found =
              (
                await q.query(
                  p.kind === "sale"
                    ? "SELECT id,store_id,bill_number,shift_id FROM dbo.sales WITH(UPDLOCK,HOLDLOCK) WHERE store_id=@branch AND bill_number=@bill;"
                    : "SELECT id,store_id,shift_id FROM dbo.bookings WITH(UPDLOCK,HOLDLOCK) WHERE id=@id AND store_id=@branch;",
                )
              ).recordset ?? [];
            parents.set(record.id, found);
          }
          const locked = new Map(
            (await read({ tx: transaction, ids: tickets.map((ticket) => ticket.id) })).map(
              (row) => [row.id, row],
            ),
          );
          const bounds = new Map();
          const exactHeldIds = remote.filter((row) => row.proofFrom === "held").map((row) => row.id);
          let independentlySafeHeld = new Set();
          const safeTable = async (name) => {
            if (bounds.has(name)) return bounds.get(name);
            if (!["held_orders", ...FAMILIES.sale, ...FAMILIES.booking].includes(name))
              fail("EHELD_STATUS_SCHEMA");
            const q = new sql.Request(transaction);
            q.input("branch", sql.NVarChar(128), branchId).input("entity", sql.NVarChar(128), name);
            const b = (
              await q.query(`SELECT CONVERT(varchar(30),CHANGE_TRACKING_CURRENT_VERSION()) current_version,CONVERT(varchar(30),CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.'+@entity))) minimum_version,
       (SELECT COUNT(*) FROM dbo.sync_checkpoints WITH(UPDLOCK,HOLDLOCK) WHERE organization_id=N'default' AND branch_id=@branch AND entity_type=@entity AND direction=N'push') checkpoint_count,
       (SELECT CONVERT(varchar(30),MAX(change_tracking_version)) FROM dbo.sync_checkpoints WHERE organization_id=N'default' AND branch_id=@branch AND entity_type=@entity AND direction=N'push') checkpoint_version,
       (SELECT COUNT(*) FROM dbo.sync_change_journal WITH(UPDLOCK,HOLDLOCK) WHERE (branch_id=@branch OR branch_id=N'global' OR branch_id IS NULL OR branch_id=N'') AND entity_type=@entity AND acknowledged_at IS NULL) pending_count;`)
            ).recordset?.[0];
            const current = version(b?.current_version),
              minimum = version(b?.minimum_version),
              since = version(b?.checkpoint_version);
            const valid = Boolean(
              current &&
              minimum &&
              since &&
              since !== "0" &&
              b.checkpoint_count === 1 &&
              BigInt(minimum) <= BigInt(since) &&
              BigInt(since) <= BigInt(current),
            );
            let safe = valid && b.pending_count === 0;
            if (safe) {
              const c =
                (
                  await new sql.Request(transaction)
                    .input("since", sql.VarChar(30), since)
                    .query(
                      `DECLARE @v bigint=CONVERT(bigint,@since);SELECT TOP(1) SYS_CHANGE_VERSION FROM CHANGETABLE(CHANGES dbo.[${name}],@v) changed WHERE SYS_CHANGE_CONTEXT IS NULL OR SYS_CHANGE_CONTEXT<>0x434C4F5544;`,
                    )
                ).recordset ?? [];
              safe = c.length === 0;
            }
            if (!safe && valid && name === "held_orders" && exactHeldIds.length) {
              // An unchanged cloud hold can prove a separate ticket despite an
              // unrelated local hold. Unknown journal keys still fence all tickets.
              const eligible = await new sql.Request(transaction)
                .input("since", sql.VarChar(30), since)
                .input("branch", sql.NVarChar(128), branchId)
                .input("ids", sql.NVarChar(sql.MAX), JSON.stringify(exactHeldIds))
                .query(`DECLARE @v bigint=CONVERT(bigint,@since);
                  WITH candidates AS (
                    SELECT h.id,h.bill_no FROM OPENJSON(@ids) requested
                    JOIN dbo.held_orders h WITH(UPDLOCK,HOLDLOCK)
                      ON h.id=CONVERT(nvarchar(450),requested.value)
                      AND h.id COLLATE Latin1_General_100_BIN2=requested.value
                    WHERE h.store_id=@branch AND DATALENGTH(h.bill_no)>0
                  ), pending AS (
                    SELECT j.branch_id,key_shape.field_count,key_shape.held_id
                    FROM dbo.sync_change_journal j WITH(UPDLOCK,HOLDLOCK)
                    CROSS APPLY (
                      SELECT COUNT(*) field_count,MAX(CASE WHEN [type]=1 AND DATALENGTH([key])=4
                        AND [key] COLLATE Latin1_General_100_BIN2=N'id' AND DATALENGTH(value) BETWEEN 2 AND 900
                        THEN CONVERT(nvarchar(450),value) END) held_id
                      FROM OPENJSON(CASE WHEN ISJSON(j.entity_id)=1 THEN j.entity_id ELSE N'{}' END)
                    ) key_shape
                    WHERE j.entity_type=N'held_orders' AND j.acknowledged_at IS NULL
                      AND (j.branch_id=@branch OR j.branch_id=N'global' OR j.branch_id IS NULL OR j.branch_id=N'')
                  )
                  SELECT c.id FROM candidates c
                  WHERE NOT EXISTS (
                    SELECT 1 FROM pending p
                    WHERE p.branch_id IS NULL OR p.branch_id IN(N'',N'global')
                      OR p.branch_id COLLATE Latin1_General_100_BIN2<>@branch
                      OR p.field_count<>1 OR p.held_id IS NULL
                      OR p.held_id COLLATE DATABASE_DEFAULT=c.id COLLATE DATABASE_DEFAULT
                      OR p.held_id COLLATE Latin1_General_100_CI_AS=c.id
                      OR NOT EXISTS (
                        SELECT 1 FROM dbo.held_orders h WITH(UPDLOCK,HOLDLOCK)
                        WHERE h.id=p.held_id AND h.id COLLATE Latin1_General_100_BIN2=p.held_id
                          AND h.store_id=@branch AND DATALENGTH(h.bill_no)>0
                      )
                  ) AND NOT EXISTS (
                    SELECT 1 FROM CHANGETABLE(CHANGES dbo.held_orders,@v) changed
                    LEFT JOIN dbo.held_orders h WITH(UPDLOCK,HOLDLOCK) ON h.id=changed.id
                    WHERE (changed.SYS_CHANGE_CONTEXT IS NULL OR changed.SYS_CHANGE_CONTEXT<>0x434C4F5544)
                      AND (changed.id=c.id OR changed.id COLLATE Latin1_General_100_CI_AS=c.id
                        OR changed.SYS_CHANGE_OPERATION=N'D' OR h.id IS NULL
                        OR h.store_id IS NULL OR h.store_id IN(N'',N'global')
                        OR h.store_id=@branch AND (h.bill_no IS NULL OR DATALENGTH(h.bill_no)=0))
                  ) AND NOT EXISTS (
                    SELECT 1 FROM dbo.held_orders sibling WITH(UPDLOCK,HOLDLOCK)
                    WHERE sibling.store_id=@branch
                      AND (sibling.bill_no=c.bill_no OR sibling.bill_no COLLATE Latin1_General_100_CI_AS=c.bill_no)
                      AND sibling.id COLLATE Latin1_General_100_BIN2<>c.id
                  );`);
              independentlySafeHeld = new Set((eligible.recordset ?? []).map((row) => row.id));
            }
            bounds.set(name, safe);
            bound();
            return safe;
          };
          const heldTableSafe = await safeTable("held_orders");
          if (!heldTableSafe && !independentlySafeHeld.size) fail("EHELD_STATUS_CT_REVIEW");
          if ((await witness(transaction)) !== schemaWitness) fail("EHELD_STATUS_SCHEMA");
          for (const record of remote) {
            if (!heldTableSafe && !independentlySafeHeld.has(record.id)) {
              blocked("EHELD_STATUS_CT_REVIEW");
              continue;
            }
            const before = snapshots.get(record.id),
              now = locked.get(record.id);
            if (!before || !now || before.row.exact_json !== now.exact_json) {
              blocked("EHELD_STATUS_CHANGED");
              continue;
            }
            if (
              record.proofFrom === "held" &&
              !exactRows(this.identityTable, [before.identity], [record.exact])
            ) {
              blocked("EHELD_STATUS_IDENTITY");
              continue;
            }
            if (record.status === "completed") {
              const p = record.parent,
                found = parents.get(record.id) ?? [];
              if (
                found.length !== 1 ||
                recordId(found[0].id) !== recordId(p.id) ||
                recordId(found[0].store_id) !== branchId ||
                recordId(found[0].shift_id ?? null) !== recordId(p.shiftId) ||
                (p.kind === "sale" && found[0].bill_number !== p.billNo) ||
                (p.kind === "booking" && before.exact.note !== "booking:" + p.id)
              ) {
                blocked("EHELD_STATUS_PARENT_REVIEW");
                continue;
              }
              let accepted = true;
              for (const name of FAMILIES[p.kind]) if (!(await safeTable(name))) accepted = false;
              if (!accepted) {
                blocked("EHELD_STATUS_PARENT_REVIEW");
                continue;
              }
            } else {
              const q = new sql.Request(transaction);
              q.input("branch", sql.NVarChar(128), branchId).input(
                "bill",
                sql.NVarChar(450),
                before.row.bill_no,
              );
              if (
                (
                  await q.query(
                    "SELECT TOP(1) id FROM dbo.sales WITH(UPDLOCK,HOLDLOCK) WHERE store_id=@branch AND bill_number=@bill;",
                  )
                ).recordset?.length
              ) {
                blocked("EHELD_STATUS_PARENT_REVIEW");
                continue;
              }
            }
            bound();
            const receipt = adoptionReceipt({
              databaseGuid: guid,
              branchId,
              terminalId,
              record,
              beforeJson: before.row.exact_json,
              oldStatus: before.row.status,
              sourceKey,
            });
            const prior =
              (
                await new sql.Request(transaction)
                  .input("operation", sql.UniqueIdentifier, receipt.id)
                  .query(
                    "SELECT operation_type,entity_id,note FROM dbo.local_operation_receipts WITH(UPDLOCK,HOLDLOCK) WHERE operation_id=@operation;",
                  )
              ).recordset ?? [];
            if (prior.length) {
              if (
                prior.length !== 1 ||
                prior[0].operation_type !== receipt.type ||
                prior[0].entity_id !== receipt.entity ||
                prior[0].note !== receipt.note
              )
                fail("EHELD_STATUS_RECEIPT");
              blocked("EHELD_STATUS_CHANGED");
              continue;
            }
            // Both the held row and the receipt key range are now locked. Reject
            // every extra attached write trigger, even one added after the probe.
            if ((await witness(transaction)) !== schemaWitness) fail("EHELD_STATUS_SCHEMA");
            // Preserve local version/time: an accepted-parent proof is not a cloud
            // held-row revision. This operation adopts only a verified terminal state.
            const result = await new sql.Request(transaction)
              .input("id", sql.NVarChar(450), record.id)
              .input("branch", sql.NVarChar(128), branchId)
              .input("status", sql.NVarChar(32), record.status)
              .query(
                "DECLARE @changed TABLE(id nvarchar(450));WITH CHANGE_TRACKING_CONTEXT(0x434C4F5544) UPDATE dbo.held_orders SET status=@status OUTPUT inserted.id INTO @changed WHERE id=@id AND store_id=@branch AND status IN(N'draft',N'held',N'waiting',N'ready');SELECT COUNT(*) matched FROM @changed;",
              );
            if (result.recordset?.[0]?.matched !== 1) fail("EHELD_STATUS_CHANGED");
            const after = (
              await new sql.Request(transaction)
                .input("id", sql.NVarChar(450), record.id)
                .input("branch", sql.NVarChar(128), branchId)
                .query(
                  `SELECT (SELECT ${select} FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER) exact_json FROM dbo.held_orders h WITH(HOLDLOCK) WHERE h.id=@id AND h.store_id=@branch;`,
                )
            ).recordset?.[0];
            if (!after?.exact_json) fail("EHELD_STATUS_CHANGED");
            const expected = { ...before.exact, status: record.status };
            if (JSON.stringify(JSON.parse(after.exact_json)) !== JSON.stringify(expected))
              fail("EHELD_STATUS_CHANGED");
            await new sql.Request(transaction)
              .input("operation", sql.UniqueIdentifier, receipt.id)
              .input("entity", sql.NVarChar(128), receipt.entity)
              .input("note", sql.NVarChar(400), receipt.note)
              .query(
                "INSERT dbo.local_operation_receipts(operation_id,operation_type,entity_id,note) VALUES(@operation,N'held_status_cloud_adoption_v1',@entity,@note);",
              );
            updated++;
          }
          bound();
          await transaction.commit();
        } catch (error) {
          await Promise.resolve(transaction.rollback()).catch(() => {});
          throw error;
        }
        bound();
        if (updated)
          this.publish({ kind: "general", branchId, source: "cloud", tables: ["held_orders"] });
        return {
          updated,
          reviewRequired,
          deferred: reviewRequired > 0,
          code: code ?? (reviewRequired ? "EHELD_STATUS_REVIEW" : null),
        };
      };
      let remaining = BigInt(frame.total),
        after = null,
        result = { updated: 0, reviewRequired: 0, deferred: false, code: null };
      // A finite read-only scan position, never an upload/feed checkpoint. The
      // initial count and binary maximum bound work against concurrent inserts.
      while (remaining > 0n) {
        bound();
        const rows = await read({
          after,
          upper: frame.upper_id,
          maximum: Number(remaining > BigInt(MAX_IDS) ? BigInt(MAX_IDS) : remaining),
        });
        if (!rows.length) break;
        after = rows.at(-1).id;
        remaining -= BigInt(rows.length);
        for (let offset = 0; offset < rows.length; offset += 4) {
          bound();
          result = merge(result, await processRows(rows.slice(offset, offset + 4)));
        }
      }
      return result;
    });
  }
}
module.exports = {
  HeldStatusRecovery,
  projectIdentity,
  normalizeResponse,
  adoptionReceipt,
  LINE_KEYS,
  COUPON_KEYS,
  IDENTITY_KEYS,
};
