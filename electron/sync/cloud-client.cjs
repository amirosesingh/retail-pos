const { policy } = require("./conflicts.cjs");
const { toLocalValue } = require("./row-codec.cjs");

// A cloud row is authoritative when its version matches a cached terminal
// row. A genuinely pending terminal edit has already advanced its version and
// therefore remains untouched until its upload is accepted or rejected.
const DEVICE_COLUMN_ALLOWLIST = {
  app_users: new Set([
    "id", "user_id", "full_name", "store_id", "role", "role_slug", "permissions",
    "is_active", "pin_hash", "pin_length", "pin_set_at", "pin_updated_by", "row_version",
    "created_at", "updated_at", "deleted_at",
  ]),
  members: new Set([
    "id", "member_code", "full_name", "phone", "tier_id", "loyalty_points", "total_spent",
    "is_verified", "created_at", "updated_at", "deleted_at", "row_version",
    "membership_revision", "membership_status", "membership_member_id",
  ]),
};

class CloudClient {
  constructor({ configStore, terminalStore, connectionManager = null }) {
    this.configStore = configStore;
    this.terminalStore = terminalStore;
    this.connectionManager = connectionManager;
    this.authorizationProof = null;
  }
  setAuthorizationProof(proof) {
    this.authorizationProof = proof && typeof proof === "object" ? { ...proof } : null;
  }
  clearAuthorizationProof() {
    this.authorizationProof = null;
  }
  hasAuthorizationProof() {
    return Boolean(this.authorizationProof && Object.values(this.authorizationProof).some(Boolean));
  }
  terminalId() {
    return String(this.terminalStore.read()?.tokenId ?? "").trim();
  }
  async request(payload, operation = "") {
    const terminal = this.terminalStore.read() ?? {};
    // An empty config-store value must not mask the HTTPS recovery copy sealed
    // with the terminal activation (nullish coalescing treats "" as present).
    const base = String(this.configStore.get("backendUrl") || terminal.backendUrl || "")
      .trim()
      .replace(/\/+$/, "");
    const terminalToken = String(terminal.tokenId ?? "").trim();
    if (!base)
      throw Object.assign(
        new Error(
          "The terminal is activated, but its hosted POS backend address has not been restored. Open Database & Cloud Connection and save the hosted POS address once.",
        ),
        { code: "EBACKEND" },
      );
    if (!/^https:\/\/.+/i.test(base))
      throw Object.assign(
        new Error(
          "The hosted POS backend must be a full HTTPS address. Open Database & Cloud Connection and save the POS website address again.",
        ),
        { code: "EBACKEND_HTTPS" },
      );
    if (!terminalToken)
      throw Object.assign(
        new Error(
          "The renderer activation has not reached the desktop synchronization service yet. Close and reopen Settings, then retry synchronization.",
        ),
        { code: "EACTIVATION_MIRROR" },
      );
    // The OS-sealed activation token is authoritative. Put it last so no
    // caller-supplied payload can replace the device identity or its branch.
    const governanceTables = new Set([
      "pos_store_settings",
      "authorization_actions",
      "authorization_action_history",
    ]);
    const governance =
      governanceTables.has(payload?.sqlServerBatch?.table) ||
      payload?.sqlServerAggregate?.operations?.some((operation) =>
        governanceTables.has(operation.table),
      );
    const personProof = governance ? (this.authorizationProof ?? {}) : {};
    const suffix = operation ? `?operation=${encodeURIComponent(operation)}` : "";
    const response = await fetch(`${base}/api/v1/pos/sync${suffix}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, ...personProof, terminalToken }),
    });
    const data = await response
      .json()
      .catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
    if (!response.ok || data?.ok === false) {
      // PostgREST reports raised SQL errors in `message`, while the POS relay
      // uses `error`. Preserve both so diagnostics show SYNC_BRANCH_FORBIDDEN
      // instead of an unhelpful generic HTTP 400.
      const message = data?.error ?? data?.message ?? `HTTP ${response.status}`;
      throw Object.assign(new Error(message), {
        code: data?.code ?? `HTTP_${response.status}`,
        status: response.status,
        detail: data?.details ?? data?.detail ?? null,
      });
    }
    return data;
  }
  pushBatch(batch) {
    return this.request({
      sqlServerBatch: {
        batchId: batch.batchId,
        organizationId: batch.organizationId ?? "default",
        branchId: batch.branchId,
        table: batch.table,
        rows: batch.rows,
        changes: batch.changes,
      },
    });
  }
  pushAggregate(batch) {
    return this.request({
      sqlServerAggregate: {
        batchId: batch.batchId,
        organizationId: batch.organizationId ?? "default",
        branchId: batch.branchId,
        operations: batch.operations,
      },
    });
  }
  pullBatch({ organizationId = "default", branchId, cursor, limit }) {
    return this.request({
      sqlServerPull: { organizationId, branchId, cursor: Number(cursor ?? 0), limit },
    }).then((rows) => {
      const list = Array.isArray(rows) ? rows : [];
      return {
        rows: list.filter((row) => !row.tombstone),
        tombstones: list.filter((row) => row.tombstone),
        cursor: list.length ? list.at(-1).cursor : cursor,
        count: list.length,
      };
    });
  }
  bootstrapPage({ organizationId = "default", table, branchId, historyDays, cursor, limit }) {
    return this.request({
      sqlServerBootstrap: {
        organizationId,
        table,
        branchId,
        historyDays,
        cursor: cursor ?? null,
        limit,
      },
    });
  }
  counts({ organizationId = "default", branchId, historyDays = 90 }) {
    return this.request({ sqlServerCounts: { organizationId, branchId, historyDays } });
  }
  membershipDirectory({ afterRevision = 0, limit = 500 } = {}) {
    return this.request({ afterRevision:Number(afterRevision)||0, limit }, "membership_directory");
  }
  oldReceipt(lookup, branchId, proof = {}) {
    return this.request({ ...proof, oldReceipt: { lookup, branchId } });
  }
  parseKey(table, change) {
    if (change.row_data) return change.row_data;
    try {
      return JSON.parse(change.entity_id);
    } catch {
      return { id: change.entity_id };
    }
  }
  async applyLocalBatch(transaction, table, batch) {
    const sql = this.connectionManager?.sql?.() ?? require("mssql/msnodesqlv8");
    const allowed = new Map((table.columns ?? []).map((column) => [column.cloudColumn, column]));
    const primary = table.columns
      .filter((column) => column.primaryKey)
      .map((column) => column.sqlServerColumn);
    if (!primary.length)
      throw new Error(`No primary key is registered for ${table.sqlServerTable}.`);
    for (const change of [...(batch.rows ?? []), ...(batch.tombstones ?? [])]) {
      const row = change.row_data ?? {};
      const key = this.parseKey(table, change);
      if (change.tombstone) {
        const request = new sql.Request(transaction);
        const where = primary
          .map((name, index) => {
            request.input(`k${index}`, key[name]);
            return `[${name}]=@k${index}`;
          })
          .join(" AND ");
        await request.query(
          `WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544) DELETE FROM dbo.[${table.sqlServerTable}] WHERE ${where};`,
        );
        continue;
      }
      const deviceColumns = DEVICE_COLUMN_ALLOWLIST[table.cloudTable];
      const entries = Object.entries(row)
        .filter(([name]) => allowed.has(name) && (!deviceColumns || deviceColumns.has(name)))
        .map(([name, value]) => {
          const column = allowed.get(name);
          return [column.sqlServerColumn, toLocalValue(column, value)];
        });
      if (!entries.length || primary.some((name) => !entries.some(([column]) => column === name)))
        continue;
      // user_roles is uniquely identified by the role assignment itself. Old
      // installs can hold the same (user_id, role) under a different generated
      // UUID; matching only the UUID makes a replay violate UQ_user_roles_0.
      // Pull is authoritative, so update that harmless local UUID to the cloud
      // UUID while preserving one assignment row.
      const mergeKey = table.cloudTable === "user_roles" ? ["user_id", "role"] : primary;
      if (mergeKey.some((name) => !entries.some(([column]) => column === name))) continue;
      const request = new sql.Request(transaction);
      const names = [];
      entries.forEach(([name, value], index) => {
        const parameter = `v${index}`;
        request.input(parameter, value);
        names.push([name, parameter]);
      });
      const on = mergeKey.map((name) => `target.[${name}]=source.[${name}]`).join(" AND ");
      const updates = names
        .filter(([name]) => !mergeKey.includes(name))
        .map(([name]) => `target.[${name}]=source.[${name}]`);
      const versioned = names.some(([name]) => name === "row_version");
      const conflictPolicy = table.conflictRule ?? policy(table.cloudTable);
      const correction =
        table.cloudTable === "sales" && names.some(([name]) => name === "is_refunded")
          ? "target.[is_refunded]=CASE WHEN target.[is_refunded]=1 OR source.[is_refunded]=1 THEN 1 ELSE 0 END,target.[row_version]=CASE WHEN source.[row_version]>target.[row_version] THEN source.[row_version] ELSE target.[row_version] END"
          : table.cloudTable === "sale_items" && names.some(([name]) => name === "refunded_qty")
            ? "target.[refunded_qty]=CASE WHEN source.[refunded_qty]>target.[refunded_qty] THEN source.[refunded_qty] ELSE target.[refunded_qty] END,target.[row_version]=CASE WHEN source.[row_version]>target.[row_version] THEN source.[row_version] ELSE target.[row_version] END"
            : null;
      const mayUpdate = conflictPolicy !== "immutable_reversal" && updates.length;
      const cloudWinsEqual = conflictPolicy === "highest_version" || conflictPolicy === "scoped_version";
      const authorizationOrder = versioned
        ? ` AND source.[row_version]${cloudWinsEqual ? ">=" : ">"}target.[row_version]`
        : "";
      const matched = correction
        ? `WHEN MATCHED THEN UPDATE SET ${correction}`
        : mayUpdate
          ? `WHEN MATCHED${authorizationOrder} THEN UPDATE SET ${updates.join(",")}`
          : "";
      const source = names.map(([name, parameter]) => `@${parameter} AS [${name}]`).join(",");
      await request.query(
        `WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544) MERGE dbo.[${table.sqlServerTable}] WITH(HOLDLOCK) AS target USING(SELECT ${source}) AS source ON ${on} ${matched} WHEN NOT MATCHED THEN INSERT(${names.map(([name]) => `[${name}]`).join(",")}) VALUES(${names.map(([name]) => `source.[${name}]`).join(",")});`,
      );
    }
  }
  async applyLocalBatchToPool(connectionManager, table, rows) {
    this.connectionManager = connectionManager;
    const sql = connectionManager.sql();
    const transaction = new sql.Transaction(connectionManager.pool);
    await transaction.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);
    try {
      await this.applyLocalBatch(transaction, table, { rows, tombstones: [] });
      await transaction.commit();
    } catch (error) {
      await Promise.resolve(transaction.rollback()).catch(() => undefined);
      throw error;
    }
  }
}
module.exports = { CloudClient };
