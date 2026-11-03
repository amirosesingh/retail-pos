const { normalizeSyncPayload } = require("./uuid-payload.cjs");
const { recordId } = require("./uuid-fields.cjs");
const { policy } = require("./conflicts.cjs");
const { toLocalValue } = require("./row-codec.cjs");
const { tagBootstrapDiagnostic } = require("../diagnostics.cjs");

// Pending writes are guarded by the reader, not inferred from independent
// cloud/device counters. Closing graph rows also report the actual SQL outcome.
const SHIFT_GRAPH_TABLES = new Set(["shifts", "shift_cash_counts", "shift_reconciliations",
  "shift_close_events", "shift_notifications", "shift_variance_alerts"]);
function comparable(column, value) {
  if (value == null) return null;
  const type = String(column.cloudType ?? "").toLowerCase();
  if (type === "uuid") return recordId(String(value));
  if (type === "boolean") return [true, 1, "1"].includes(value) ? true : [false, 0, "0"].includes(value) ? false : value;
  if (/^(timestamp|date|time)/.test(type)) {
    if (type === "date") return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
    const time = value instanceof Date ? value.valueOf() : Date.parse(String(value));
    return Number.isFinite(time) ? time : String(value);
  }
  if (/^(numeric|decimal|smallint|integer|bigint|real|double precision|money)/.test(type)) {
    const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(String(value).trim());
    if (match && Math.abs(Number(match[4] ?? 0)) < 1000) {
      let digits = (match[2] + (match[3] ?? "")).replace(/^0+/, "") || "0";
      let exponent = Number(match[4] ?? 0) - (match[3]?.length ?? 0);
      while (digits.endsWith("0") && digits !== "0") { digits = digits.slice(0, -1); exponent++; }
      return digits === "0" ? "0" : `${match[1] === "-" ? "-" : ""}${digits}e${exponent}`;
    }
  }
  if (type === "jsonb" || type.endsWith("[]")) {
    const canonical = item => Array.isArray(item) ? item.map(canonical) : item && typeof item === "object"
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical(item[key])])) : item;
    try { return JSON.stringify(canonical(typeof value === "string" ? JSON.parse(value) : value)); } catch { return value; }
  }
  return value;
}
const DEVICE_COLUMN_ALLOWLIST = {
  app_users: new Set([
    "id", "user_id", "login_username", "full_name", "store_id", "role", "role_slug", "permissions",
    "is_active", "pin_hash", "offline_login_pin_hash", "pin_length", "pin_set_at", "pin_updated_by", "row_version",
    "email", "created_at", "updated_at", "deleted_at",
  ]),
  members: new Set([
    "id", "member_code", "full_name", "phone", "tier_id", "loyalty_points", "total_spent",
    "is_verified", "created_at", "updated_at", "deleted_at", "row_version",
    "membership_revision", "membership_status", "membership_member_id",
  ]),
};

// Configuration is edited from both hosted Web and offline-capable tills.
// Row versions can diverge when two writers start from the same snapshot, so
// they are only a deterministic tie-breaker. The actual last-write-wins clock
// is updated_at, matching the renderer's settings merge contract.
const CONFIGURATION_LWW_TABLES = new Set([
  "integration_settings",
  "pos_settings",
  "pos_store_settings",
  "settings_overrides",
  "settings_scoped",
]);

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
  backendUrl() {
    const terminal = this.terminalStore.read() ?? {};
    return String(this.configStore.get("backendUrl") || terminal.backendUrl || "")
      .trim()
      .replace(/\/+$/, "");
  }
  async health({ timeoutMs = 8000 } = {}) {
    const base = this.backendUrl();
    if (!base || !/^https:\/\/.+/i.test(base))
      return { online: false, ready: false, code: "EBACKEND", error: "The hosted POS backend is not configured." };
    let response;
    try {
      response = await fetch(`${base}/api/public/sync-health`, {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(Math.max(1000, Number(timeoutMs) || 8000)),
      });
    } catch (error) {
      return { online: false, ready: false, code: "EOFFLINE", error: String(error?.message ?? error) };
    }
    const data = await response.json().catch(() => null);
    const ready = response.ok && data?.serviceKey === true && data?.posUrl === true;
    return {
      online: true,
      ready,
      code: ready ? null : `HTTP_${response.status}`,
      error: ready ? null : data?.error ?? data?.message ?? "The hosted POS backend cannot reach the central database.",
    };
  }
  async request(payload, operation = "") {
    const terminal = this.terminalStore.read() ?? {};
    // An empty config-store value must not mask the HTTPS recovery copy sealed
    // with the terminal activation (nullish coalescing treats "" as present).
    const base = this.backendUrl();
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
      "pos_settings",
      "pos_store_settings",
      "authorization_actions",
      "authorization_action_history",
    ]);
    const sharedPosField = (row) => String(row?.scope ?? "").toLowerCase() === "global" &&
      String(row?.scope_id ?? "") === "" && String(row?.key ?? "").startsWith("pos_field:");
    const hasSharedPosField = (operation) => operation?.table === "settings_scoped" &&
      ((operation.rows ?? []).some(sharedPosField) ||
        (operation.changes ?? []).some((change) => {
          if (sharedPosField(change?.key)) return true;
          try { return sharedPosField(JSON.parse(change?.entityId ?? change?.entity_id)); }
          catch { return false; }
        }));
    const governance =
      governanceTables.has(payload?.sqlServerBatch?.table) ||
      hasSharedPosField(payload?.sqlServerBatch) ||
      payload?.sqlServerAggregate?.operations?.some((operation) =>
        governanceTables.has(operation.table) || hasSharedPosField(operation),
      );
    const personProof = governance ? (this.authorizationProof ?? {}) : {};
    const suffix = operation ? `?operation=${encodeURIComponent(operation)}` : "";
    let response;
    let data;
    let bodyReadError;
    let nonJsonResponse = false;
    try { response = await fetch(`${base}/api/v1/pos/sync${suffix}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...normalizeSyncPayload(payload), ...personProof, terminalToken: recordId(terminalToken), deviceBindingProof:terminal.deviceBindingProof, ...(terminal.deviceUse === "management" ? { deviceClaimProof: terminal.deviceClaimProof } : {}) }),
      signal: AbortSignal.timeout(30_000),
    });
      try {
        data = await response.json();
      } catch (error) {
        // A body can time out after fetch has delivered successful headers.
        // Preserve transport failures instead of inventing an HTTP 200 error.
        // A known HTTP refusal still wins when its body cannot be read.
        if (response.ok && error?.name !== "SyntaxError") throw error;
        bodyReadError = error;
        nonJsonResponse = error?.name === "SyntaxError";
        data = { ok: false, error: `HTTP ${response.status}` };
      }
    } catch (error) {
      if (["TimeoutError","AbortError"].includes(error?.name)) {
        throw Object.assign(new Error("Cloud synchronization timed out. Local changes remain pending; the next sync will safely retry the same upload."),
          {code:"ETIMEDOUT",cause:error});
      }
      throw error;
    }
    if (!response.ok || data?.ok === false) {
      // PostgREST reports raised SQL errors in `message`, while the POS relay
      // uses `error`. Preserve both so diagnostics show SYNC_BRANCH_FORBIDDEN
      // instead of an unhelpful generic HTTP 400.
      const message = data?.error ?? data?.message ?? `HTTP ${response.status}`;
      throw tagBootstrapDiagnostic(Object.assign(new Error(message), {
        code: data?.code ?? `HTTP_${response.status}`,
        status: response.status,
        detail: data?.details ?? data?.detail ?? null,
        ...(bodyReadError ? { cause: bodyReadError } : {}),
      }), { httpStatus: response.status, nonJsonResponse });
    }
    return normalizeSyncPayload(data);
  }
  managementBranches() { return this.request({ managementSyncBranches: true }); }
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
    const payload = {
      sqlServerAggregate: {
        batchId: batch.batchId,
        organizationId: batch.organizationId ?? "default",
        branchId: batch.branchId,
        ...(batch.shiftIntent ? {shiftIntent:batch.shiftIntent} : {operations:batch.operations}),
        ...(batch.shiftAuthor ? {shiftAuthor:batch.shiftAuthor} : {}),
        ...(batch.shiftClosingStart ? {shiftClosingStart:batch.shiftClosingStart} : {}),
      },
    };
    return batch.shiftIntent ? this.shiftProtocolRequest(payload) : this.request(payload);
  }
  shiftGraph({organizationId="default",branchId,shiftId}) {
    return this.shiftProtocolRequest({sqlServerShiftGraph:{organizationId,branchId,shiftId}});
  }
  async shiftProtocolRequest(payload) {
    try{return await this.request(payload);}
    catch(error){
      if(["PGRST202","42883"].includes(error?.code) || Number(error?.status)===404)
        throw Object.assign(new Error("The configured backend has not installed the closing-convergence protocol. Saved local work remains pending; ask an administrator to review the matching backend upgrade."),{code:"ESHIFT_PROTOCOL_UNAVAILABLE",table:"shifts",cause:error});
      throw error;
    }
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
    const localColumns = new Map((table.columns ?? []).map(column => [column.sqlServerColumn, column]));
    const primary = table.columns
      .filter((column) => column.primaryKey)
      .map((column) => column.sqlServerColumn);
    if (!primary.length)
      throw new Error(`No primary key is registered for ${table.sqlServerTable}.`);
    const protectedGraph = SHIFT_GRAPH_TABLES.has(table.cloudTable);
    const result = { applied: 0, alreadyMatching: 0, deferred: 0, conflicts: 0, outcomes: [] };
    const outcome = (change, status, reason, localVersion) => {
      if (!protectedGraph) return;
      result[status === "already_matching" ? "alreadyMatching" : status === "conflict" ? "conflicts" : status]++;
      result.outcomes.push({ entityId: change.entity_id ?? JSON.stringify(this.parseKey(table, change)), status,
        ...(reason ? { reason } : {}), localVersion: localVersion ?? null, remoteVersion: change.row_data?.row_version ?? null });
    };
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
        const deleted = await request.query(
          `WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544) DELETE FROM dbo.[${table.sqlServerTable}] WHERE ${where};`,
        );
        outcome(change, (deleted.rowsAffected?.[0] ?? 0) > 0 ? "applied" : "already_matching");
        continue;
      }
      const deviceColumns = DEVICE_COLUMN_ALLOWLIST[table.cloudTable];
      const deviceRow = table.cloudTable === "app_users"
        ? {
            ...row,
            // Staff email is not needed by the till, but the compatibility
            // SQL schema requires a non-null value. Keep PII out of the device
            // while allowing a fresh bootstrap to complete reliably.
            email: `${String(row.user_id ?? row.id ?? "staff").replace(/[^a-z0-9._-]/gi, "_")}@terminal.invalid`,
          }
        : row;
      const entries = Object.entries(deviceRow)
        .filter(([name]) => allowed.has(name) && (!deviceColumns || deviceColumns.has(name)))
        .map(([name, value]) => {
          const column = allowed.get(name);
          return [column.sqlServerColumn, toLocalValue(column, value)];
        });
      if (!entries.length || primary.some((name) => !entries.some(([column]) => column === name))) {
        outcome(change, "conflict", "The cloud row has no complete registered primary key.");
        continue;
      }
      // user_roles is uniquely identified by the role assignment itself. Old
      // installs can hold the same (user_id, role) under a different generated
      // UUID; matching only the UUID makes a replay violate UQ_user_roles_0.
      // Pull is authoritative, so update that harmless local UUID to the cloud
      // UUID while preserving one assignment row.
      const mergeKey = table.cloudTable === "user_roles" ? ["user_id", "role"] : primary;
      if (mergeKey.some((name) => !entries.some(([column]) => column === name))) {
        outcome(change, "conflict", "The cloud row has no complete registered merge key."); continue;
      }
      const request = new sql.Request(transaction);
      const names = [];
      entries.forEach(([name, value], index) => {
        const parameter = `v${index}`;
        request.input(parameter, value);
        names.push([name, parameter]);
      });
      if (protectedGraph) {
        const branch = recordId(String(batch.branchId ?? "").trim());
        const scope = recordId(String(deviceRow.store_id ?? "").trim());
        if (!branch || scope !== branch) {
          outcome(change, "conflict", "The closing row does not match the verified download branch."); continue;
        }
        const where = primary.map(name => `[${name}]=@${names.find(([column]) => column === name)[1]}`).join(" AND ");
        const prior = await request.query(`SELECT TOP (1) * FROM dbo.[${table.sqlServerTable}] WITH (UPDLOCK,HOLDLOCK) WHERE ${where};`);
        const saved = prior.recordset?.[0];
        if (saved) {
          if (recordId(String(saved.store_id ?? "")) !== branch || (table.cloudTable !== "shifts" &&
              recordId(String(saved.shift_id ?? "")) !== recordId(String(deviceRow.shift_id ?? "")))) {
            outcome(change, "conflict", "The saved closing row belongs to another branch or shift.", saved.row_version); continue;
          }
          const matching = entries.every(([name, value]) => name === "row_version" ||
            comparable(localColumns.get(name), saved[name]) === comparable(localColumns.get(name), value));
          if (matching) { outcome(change, "already_matching", null, saved.row_version); continue; }
          const closed = value => value.status === "CLOSED" || value.state === "CLOSED" || value.closed_at != null;
          if ((table.cloudTable !== "shifts" && (table.conflictRule ?? policy(table.cloudTable)) === "immutable_reversal") ||
              (table.cloudTable === "shifts" && closed(saved) && !closed(deviceRow))) {
            outcome(change, "conflict", table.cloudTable === "shifts"
              ? "A cloud opening cannot replace a saved closing. Resolve the accepted closing revision before retrying."
              : "Saved closing history differs from the cloud row. Resolve the immutable record before retrying.", saved.row_version); continue;
          }
          if (Number(saved.row_version) > Number(deviceRow.row_version)) {
            outcome(change, "deferred", "The cloud closing/update was not applied: independent revisions require an authoritative graph and correction revision.", saved.row_version); continue;
          }
        }
      }
      const on = mergeKey.map((name) => `target.[${name}]=source.[${name}]`).join(" AND ");
      const updates = names
        .filter(([name]) => !mergeKey.includes(name))
        .map(([name]) => `target.[${name}]=source.[${name}]`);
      const versioned = names.some(([name]) => name === "row_version");
      const timestampedConfiguration =
        CONFIGURATION_LWW_TABLES.has(table.cloudTable) &&
        names.some(([name]) => name === "updated_at");
      const conflictPolicy = table.conflictRule ?? policy(table.cloudTable);
      const correction =
        table.cloudTable === "sales" && names.some(([name]) => name === "is_refunded")
          ? "target.[is_refunded]=CASE WHEN target.[is_refunded]=1 OR source.[is_refunded]=1 THEN 1 ELSE 0 END,target.[row_version]=CASE WHEN source.[row_version]>target.[row_version] THEN source.[row_version] ELSE target.[row_version] END"
          : table.cloudTable === "sale_items" && names.some(([name]) => name === "refunded_qty")
            ? "target.[refunded_qty]=CASE WHEN source.[refunded_qty]>target.[refunded_qty] THEN source.[refunded_qty] ELSE target.[refunded_qty] END,target.[row_version]=CASE WHEN source.[row_version]>target.[row_version] THEN source.[row_version] ELSE target.[row_version] END"
            : null;
      const mayUpdate = conflictPolicy !== "immutable_reversal" && updates.length;
      const cloudWinsEqual = conflictPolicy === "highest_version" || conflictPolicy === "scoped_version";
      const authorizationOrder = timestampedConfiguration
        ? versioned
          ? " AND (target.[updated_at] IS NULL OR source.[updated_at]>target.[updated_at] OR (source.[updated_at]=target.[updated_at] AND source.[row_version]>=target.[row_version]))"
          : " AND (target.[updated_at] IS NULL OR source.[updated_at]>=target.[updated_at])"
        : versioned
          ? ` AND source.[row_version]${cloudWinsEqual ? ">=" : ">"}target.[row_version]`
          : "";
      // Only authoritative cloud corrections may amend posted receipt fields.
      // Terminal uploads still obey the immutable sale/refund contract.
      const correctedReceipt = correction && versioned && names.some(([name]) => name === "corrected_at") && deviceRow.corrected_at;
      const correctionAllowed = `source.[corrected_at] IS NOT NULL AND source.[row_version]>target.[row_version] AND ${table.cloudTable === "sales" ? "COALESCE(target.[is_refunded],0)=0 AND COALESCE(source.[is_refunded],0)=0" : "COALESCE(target.[refunded_qty],0)=0 AND COALESCE(source.[refunded_qty],0)=0"}`;
      const correctedUpdates = correctedReceipt ? names.filter(([name]) => !mergeKey.includes(name)).map(([name]) => {
        const fallback = name === "row_version" ? "CASE WHEN source.[row_version]>target.[row_version] THEN source.[row_version] ELSE target.[row_version] END"
          : name === "is_refunded" ? "CASE WHEN target.[is_refunded]=1 OR source.[is_refunded]=1 THEN 1 ELSE 0 END"
          : name === "refunded_qty" ? "CASE WHEN source.[refunded_qty]>target.[refunded_qty] THEN source.[refunded_qty] ELSE target.[refunded_qty] END" : `target.[${name}]`;
        return `target.[${name}]=CASE WHEN ${correctionAllowed} THEN source.[${name}] ELSE ${fallback} END`;
      }).join(",") : null;
      const matched = correction
        ? `WHEN MATCHED THEN UPDATE SET ${correctedUpdates ?? correction}`
        : mayUpdate
          ? `WHEN MATCHED${authorizationOrder} THEN UPDATE SET ${updates.join(",")}`
          : "";
      const source = names.map(([name, parameter]) => `@${parameter} AS [${name}]`).join(",");
      // OUTPUT INTO also works when an installed schema has DML triggers.
      const capture = protectedGraph ? "DECLARE @sync_actions TABLE(sync_action nvarchar(10)); " : "";
      const output = protectedGraph ? " OUTPUT $action INTO @sync_actions; SELECT sync_action FROM @sync_actions;" : ";";
      const merged = await request.query(
        `${capture}WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544) MERGE dbo.[${table.sqlServerTable}] WITH(HOLDLOCK) AS target USING(SELECT ${source}) AS source ON ${on} ${matched} WHEN NOT MATCHED THEN INSERT(${names.map(([name]) => `[${name}]`).join(",")}) VALUES(${names.map(([name]) => `source.[${name}]`).join(",")})${output}`,
      );
      const applied = (merged.recordset?.length ?? merged.rowsAffected?.[0] ?? 0) > 0;
      let confirmed = true;
      if (protectedGraph) {
        const where = primary.map(name => `[${name}]=@${names.find(([column]) => column === name)[1]}`).join(" AND ");
        const saved = (await request.query(`SELECT TOP (1) * FROM dbo.[${table.sqlServerTable}] WITH (UPDLOCK,HOLDLOCK) WHERE ${where};`)).recordset?.[0];
        confirmed = saved && entries.every(([name, value]) => name === "row_version" ||
          comparable(localColumns.get(name), saved[name]) === comparable(localColumns.get(name), value));
      }
      outcome(change, applied && confirmed ? "applied" : "deferred", applied && confirmed ? null : "The registered merge policy did not confirm this cloud row locally.");
      // A newer default-row timestamp must not mask cloud company identity.
      // Repair only empty fields; genuine pending edits are protected by the
      // snapshot/pull journal guard before this merge is called.
      const idParameter = names.find(([name]) => name === "id")?.[1];
      if (table.cloudTable === "pos_settings" && idParameter) {
        for (const field of ["company_name","logo_data_url","tax_number","reg_number","phone","website","header_text","footer_text"]) {
          const parameter = names.find(([name]) => name === field)?.[1];
          if (!parameter || typeof deviceRow[field] !== "string" || !deviceRow[field].trim()) continue;
          await request.query(
            `WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544) UPDATE dbo.[pos_settings] SET [${field}]=@${parameter} WHERE [id]=@${idParameter} AND NULLIF(LTRIM(RTRIM([${field}])),N'') IS NULL;`,
          );
        }
      }
    }
    return protectedGraph ? result : undefined;
  }
  async applyLocalBatchToPool(connectionManager, table, rows, { branchId } = {}) {
    this.connectionManager = connectionManager;
    const sql = connectionManager.sql();
    const transaction = new sql.Transaction(connectionManager.pool);
    await transaction.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);
    try {
      if (SHIFT_GRAPH_TABLES.has(table.cloudTable)) {
        const { ChangeReader } = require("./change-reader.cjs");
        const { loadRegistry } = require("../db/schema-registry.cjs");
        const reader = new ChangeReader(connectionManager, loadRegistry());
        const pending = await reader.unacknowledged(table, rows.map(row => row.entity_id ?? JSON.stringify(this.parseKey(table, row))), transaction, { branchId, changes: rows });
        if (pending.size) throw Object.assign(new Error("Cloud download is waiting for pending or unverified local closing changes."), { code: "ELOCAL_UPLOAD_PENDING", table: table.cloudTable });
      }
      const result = await this.applyLocalBatch(transaction, table, { rows, tombstones: [], branchId });
      if (SHIFT_GRAPH_TABLES.has(table.cloudTable) && (result.deferred || result.conflicts))
        throw Object.assign(new Error(result.outcomes.find(item => ["deferred", "conflict"].includes(item.status))?.reason), {
          code: result.conflicts ? "ESYNC_APPLY_CONFLICT" : "ESYNC_APPLY_DEFERRED", table: table.cloudTable, outcomes: result.outcomes,
        });
      await transaction.commit();
      return result;
    } catch (error) {
      await Promise.resolve(transaction.rollback()).catch(() => undefined);
      throw error;
    }
  }
}
module.exports = { CloudClient };
