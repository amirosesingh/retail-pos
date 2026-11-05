const { createHash, randomUUID } = require("node:crypto");
const { canonical } = require("./repositories/aggregates.cjs");
const { toCloudRow } = require("../sync/row-codec.cjs");
const { recordId } = require("../sync/uuid-fields.cjs");
const { validateCoverage } = require("../sync/shift-coverage.cjs");

const GRAPH_TABLES = [
  "shifts",
  "shift_cash_counts",
  "shift_reconciliations",
  "shift_close_events",
  "shift_notifications",
  "shift_variance_alerts",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN = /^[0-9a-f]{64}$/;
const hashPayload = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const fail = (message, code = "ESHIFT_INTENT") => {
  throw Object.assign(new Error(message), { code, table: "shifts" });
};
const id = (value) => recordId(String(value ?? "").trim());
const json = (value) => JSON.stringify(canonical(value));
function localValue(column, value) {
  if (value == null) return null;
  const type = String(column.cloudType ?? "");
  if (/^(timestamp|date|time)/.test(type)) return new Date(value).valueOf();
  if (/^(numeric|decimal|integer|bigint|smallint|real|double precision|money)/.test(type)) {
    const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(String(value).trim());
    if (match && Math.abs(Number(match[4] ?? 0)) < 1000) {
      let digits = (match[2] + (match[3] ?? "")).replace(/^0+/, "") || "0";
      let exponent = Number(match[4] ?? 0) - (match[3]?.length ?? 0);
      while (digits.endsWith("0") && digits !== "0") {
        digits = digits.slice(0, -1);
        exponent++;
      }
      return digits === "0" ? "0" : `${match[1] === "-" ? "-" : ""}${digits}e${exponent}`;
    }
  }
  if (type === "uuid") return id(value);
  if (type === "boolean") return [true, 1, "1"].includes(value);
  if (type === "jsonb" || type.endsWith("[]")) {
    try {
      return json(typeof value === "string" ? JSON.parse(value) : value);
    } catch {
      return value;
    }
  }
  return value;
}
function sameRow(table, left, right) {
  return table.columns.every(
    (column) =>
      localValue(column, left[column.cloudColumn]) ===
      localValue(column, right[column.cloudColumn]),
  );
}
function validateGraph(value, branchId, shiftId, { allowUnclosed = false } = {}) {
  const branch = id(branchId),
    shift = id(shiftId);
  if (
    !branch ||
    !UUID.test(shift) ||
    value?.ok !== true ||
    value.shiftGraphVersion !== 1 ||
    id(value.branchId) !== branch ||
    id(value.shiftId) !== shift ||
    !Array.isArray(value.tables) ||
    value.tables.length !== GRAPH_TABLES.length
  )
    fail("The cloud closing graph is incomplete or has another owner.", "ESYNC_GRAPH");
  const tables = new Map();
  let total = 0;
  for (const entry of value.tables) {
    if (
      !GRAPH_TABLES.includes(entry?.table) ||
      tables.has(entry.table) ||
      !Array.isArray(entry.rows)
    )
      fail("The cloud closing graph has invalid tables.", "ESYNC_GRAPH");
    const seen = new Set();
    for (const row of entry.rows) {
      const key = id(row?.id);
      if (
        !UUID.test(key) ||
        seen.has(key) ||
        id(row.store_id) !== branch ||
        id(entry.table === "shifts" ? row.id : row.shift_id) !== shift
      )
        fail(
          "The cloud closing graph crosses its verified branch or shift.",
          "SYNC_BRANCH_FORBIDDEN",
        );
      seen.add(key);
    }
    total += entry.rows.length;
    tables.set(entry.table, entry.rows);
  }
  const parents = tables.get("shifts"),
    counts = tables.get("shift_cash_counts"),
    reconciliations = tables.get("shift_reconciliations");
  if (
    total > 2000 ||
    Buffer.byteLength(JSON.stringify(value), "utf8") > 6 * 1024 * 1024 ||
    parents.length !== 1
  )
    fail("The cloud closing graph is incomplete or exceeds its safe limit.", "ESYNC_GRAPH");
  const closed =
    parents[0].status === "CLOSED" || parents[0].state === "CLOSED" || parents[0].closed_at != null;
  if (!closed && allowUnclosed && value.graphToken === null && value.closedAtRaw === null)
    return tables;
  if (
    !TOKEN.test(value.graphToken ?? "") ||
    typeof value.closedAtRaw !== "string" ||
    !value.closedAtRaw ||
    parents[0].status !== "CLOSED" ||
    parents[0].state !== "CLOSED" ||
    parents[0].closed_at !== value.closedAtRaw ||
    !Number.isFinite(Date.parse(value.closedAtRaw)) ||
    !counts.length ||
    !reconciliations.length ||
    counts.filter((row) => row.kind === "ORIGINAL").length !== 1 ||
    reconciliations.some(
      (row) => row.count_id != null && !counts.some((count) => id(count.id) === id(row.count_id)),
    ) ||
    !reconciliations.some(
      (row) =>
        counts.some(
          (count) =>
            id(count.id) === id(row.count_id) &&
            ["cash", "card", "digital"].every(
              (tender) =>
                localValue({ cloudType: "numeric" }, count[`counted_${tender}`]) ===
                localValue({ cloudType: "numeric" }, row[`counted_${tender}`]),
            ),
        ) &&
        [
          "counted_card",
          "counted_digital",
          "expected_cash",
          "expected_card",
          "expected_digital",
          "variance_cash",
          "variance_card",
          "variance_digital",
          "variance_total",
        ].every(
          (field) =>
            localValue({ cloudType: "numeric" }, row[field]) ===
            localValue({ cloudType: "numeric" }, parents[0][field]),
        ) &&
        localValue({ cloudType: "numeric" }, row.counted_cash) ===
          localValue(
            { cloudType: "numeric" },
            parents[0].final_counted_cash ?? parents[0].counted_cash,
          ) &&
        row.variance_status === parents[0].variance_status,
    ) ||
    tables
      .get("shift_variance_alerts")
      .some(
        (row) =>
          row.reconciliation_id != null &&
          !reconciliations.some((recon) => id(recon.id) === id(row.reconciliation_id)),
      )
  )
    fail("The cloud closing graph is not a complete confirmed closure.", "ESYNC_GRAPH");
  return tables;
}

class ShiftIntentStore {
  constructor(connectionManager, registry) {
    this.manager = connectionManager;
    this.registry = registry;
  }
  query(transaction, statement, inputs = {}) {
    const request = new (this.manager.sql().Request)(transaction ?? this.manager.pool);
    for (const [name, value] of Object.entries(inputs)) request.input(name, value);
    return request.query(statement);
  }
  async context(transaction, branchId, shiftId) {
    const inputs = { branch: id(branchId), shift: id(shiftId) };
    const parent = (
      await this.query(
        transaction,
        "SELECT * FROM dbo.[shifts] WITH (UPDLOCK,HOLDLOCK) WHERE id=@shift AND store_id=@branch;",
        inputs,
      )
    ).recordset?.[0];
    if (!parent)
      fail("The protected shift does not belong to this terminal branch.", "SYNC_BRANCH_FORBIDDEN");
    const baseline =
      (
        await this.query(
          transaction,
          "SELECT * FROM dbo.pos_sync_shift_baselines WITH (UPDLOCK,HOLDLOCK) WHERE branch_id=@branch AND shift_id=@shift;",
          inputs,
        )
      ).recordset?.[0] ?? null;
    const tail =
      (
        await this.query(
          transaction,
          "SELECT TOP (1) * FROM dbo.pos_sync_shift_intents WITH (UPDLOCK,HOLDLOCK) WHERE branch_id=@branch AND shift_id=@shift ORDER BY intent_sequence DESC;",
          inputs,
        )
      ).recordset?.[0] ?? null;
    const table = this.registry.tables.find((table) => table.cloudTable === "shifts");
    return {
      branchId: inputs.branch,
      shiftId: inputs.shift,
      parent: JSON.parse(JSON.stringify(toCloudRow(table, parent))),
      baseline,
      tail,
    };
  }
  async observe(branchId, shiftId) {
    const sql = this.manager.sql(),
      tx = new sql.Transaction(this.manager.pool);
    await tx.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);
    try {
      const result = await this.context(tx, branchId, shiftId);
      await tx.commit();
      return result;
    } catch (error) {
      await Promise.resolve(tx.rollback()).catch(() => undefined);
      throw error;
    }
  }
  async verify(transaction, observation) {
    if (!observation)
      fail("Reload the shift before saving its closing observation.", "ESHIFT_LOCAL_CHANGED");
    const current = await this.context(transaction, observation.branchId, observation.shiftId);
    if (
      json(current.parent) !== json(observation.parent) ||
      current.baseline?.observation_generation !== observation.baseline?.observation_generation ||
      id(current.tail?.intent_id) !== id(observation.tail?.intent_id) ||
      current.tail?.payload_hash !== observation.tail?.payload_hash
    )
      fail(
        "The shift changed while this closing was being prepared. Reload and review it before retrying.",
        "ESHIFT_LOCAL_CHANGED",
      );
    return current;
  }
  async freeze(transaction, intentId, kind, graph, context) {
    const generation = context.baseline?.observation_generation ?? null;
    const predecessor =
      context.tail && (context.tail.baseline_generation ?? null) === generation
        ? context.tail
        : null;
    const source = predecessor
      ? JSON.parse(predecessor.payload_json).operations
      : context.baseline
        ? JSON.parse(context.baseline.graph_json).tables
        : [];
    const sourceTables = new Map(source.map((entry) => [entry.table, entry.rows]));
    const operations = [];
    for (const [name, rows] of graph) {
      const table = this.registry.tables.find((table) => table.cloudTable === name),
        saved = new Map((sourceTables.get(name) ?? []).map((row) => [id(row.id), row]));
      let frozen = rows.map((row) => {
        const old = saved.get(id(row.id));
        if (!old) return row;
        if (name !== "shifts") {
          if (sameRow(table, row, old)) return old;
          if (["shift_cash_counts", "shift_reconciliations", "shift_close_events"].includes(name))
            fail(
              "Saved immutable closing history changed before the new intent was frozen.",
              "EIDEMPOTENCY",
            );
          return row;
        }
        const result = { ...row };
        for (const field of ["opened_at", "closed_at", "created_at"])
          if (
            old[field] != null &&
            new Date(old[field]).valueOf() === new Date(row[field]).valueOf()
          )
            result[field] = old[field];
        return result;
      });
      if (name === "activity_events") {
        const { unconfirmedShiftClosureActivityRow } =
          await import("../shift-closure-activity.mjs");
        frozen = frozen.map(unconfirmedShiftClosureActivityRow);
      }
      if (GRAPH_TABLES.includes(name) || frozen.length)
        operations.push({ table: name, rows: frozen, changes: [], deletePhase: false });
    }
    operations.sort(
      (left, right) =>
        this.registry.tables.find((table) => table.cloudTable === left.table).dependencyOrder -
        this.registry.tables.find((table) => table.cloudTable === right.table).dependencyOrder,
    );
    const payload = {
      version: 1,
      intentId: id(intentId),
      branchId: context.branchId,
      shiftId: context.shiftId,
      kind,
      baseToken: predecessor ? null : (context.baseline?.graph_token ?? null),
      predecessorIntentId: predecessor ? id(predecessor.intent_id) : null,
      predecessorIntentHash: predecessor ? predecessor.payload_hash : null,
      operations,
    };
    const payloadJson = JSON.stringify(payload),
      payloadHash = hashPayload(payloadJson);
    if (
      Buffer.byteLength(payloadJson, "utf8") > 6 * 1024 * 1024 ||
      Buffer.byteLength(JSON.stringify(payloadJson), "utf8") > 8 * 1024 * 1024 - 16384
    )
      fail("The protected closing intent exceeds the safe transport limit.", "EOVERSIZED");
    await this.query(
      transaction,
      `INSERT dbo.pos_sync_shift_intents(intent_id,branch_id,shift_id,intent_kind,baseline_generation,base_token,
      predecessor_intent_id,predecessor_intent_hash,payload_json,payload_hash)
      VALUES(@intent,@branch,@shift,@kind,@generation,@base,@predecessor,@predecessor_hash,@payload,@hash);`,
      {
        intent: payload.intentId,
        branch: payload.branchId,
        shift: payload.shiftId,
        kind,
        generation,
        base: payload.baseToken,
        predecessor: payload.predecessorIntentId,
        predecessor_hash: payload.predecessorIntentHash,
        payload: payloadJson,
        hash: payloadHash,
      },
    );
    const start = payload.kind === "ORIGINAL" ? (await this.query(transaction,'SELECT proof_json FROM dbo.pos_sync_shift_closing_starts WHERE shift_id=@shift AND branch_id=@branch;',{shift:payload.shiftId,branch:payload.branchId})).recordset?.[0] : null;
    if(start){
      const startStore=require('./shift-closing-start.cjs');
      startStore.assertGraph(startStore.parse(start.proof_json,payload.branchId,payload.shiftId),graph);
      await this.query(transaction,'INSERT dbo.pos_sync_shift_intent_starts(intent_id,proof_json) VALUES(@intent,@proof);',{intent:payload.intentId,proof:start.proof_json});
    }
    return { ...payload, payloadJson, payloadHash };
  }
  async get(intentId, branchId, transaction = null) {
    const row = (
      await this.query(
        transaction,
        "SELECT * FROM dbo.pos_sync_shift_intents WHERE intent_id=@intent AND branch_id=@branch;",
        { intent: id(intentId), branch: id(branchId) },
      )
    ).recordset?.[0];
    if (!row) return null;
    const payload = JSON.parse(row.payload_json);
    if (
      hashPayload(row.payload_json) !== row.payload_hash ||
      id(payload.intentId) !== id(intentId) ||
      id(payload.branchId) !== id(branchId)
    )
      fail("The saved closing intent no longer matches its immutable payload.", "EIDEMPOTENCY");
    const savedAuthor=(await this.query(transaction,
      "SELECT attestation_json FROM dbo.pos_sync_shift_authors WHERE intent_id=@intent;",
      {intent:id(intentId)})).recordset?.[0];
    let shiftAuthor=null;
    if(savedAuthor){
      try{shiftAuthor=require("../security/shift-author-protocol.cjs").normalizeAttestation(JSON.parse(savedAuthor.attestation_json));}
      catch{fail("The saved protected author proof is invalid.","ESYNC_SHIFT_AUTHOR_INVALID");}
      if(shiftAuthor.intentId!==id(intentId)||shiftAuthor.shiftId!==payload.shiftId||shiftAuthor.branchId!==payload.branchId||shiftAuthor.action!==payload.kind||shiftAuthor.payloadHash!==row.payload_hash)
        fail("The saved author proof does not match the frozen closing intent.","ESYNC_SHIFT_AUTHOR_INVALID");
    }
    const savedStart=(await this.query(transaction,'SELECT proof_json FROM dbo.pos_sync_shift_intent_starts WHERE intent_id=@intent;',{intent:id(intentId)})).recordset?.[0];
    if(savedStart && payload.kind !== "ORIGINAL") fail("The saved start proof belongs only to the original closing; retain this intent for review.","ESYNC_SHIFT_START_INVALID");
    const shiftClosingStart=savedStart?require('./shift-closing-start.cjs').parse(savedStart.proof_json,payload.branchId,payload.shiftId):null;
    return {
      ...payload,
      shiftClosingStart,
      payloadJson: row.payload_json,
      payloadHash: row.payload_hash,
      acknowledged: Boolean(row.acknowledged_at),
      shiftAuthor,
    };
  }
  async freezeOpening(transaction, aggregateId, branchId, shiftId, {exactFinancial=false}={}) {
    const table = this.registry.tables.find((table) => table.cloudTable === "shifts");
    const projection=exactFinancial?table.columns.map(column=>/^(?:decimal|numeric)\b/i.test(column.sqlServerType)?`CONVERT(nvarchar(80),[${column.sqlServerColumn}]) AS [${column.sqlServerColumn}]`:`[${column.sqlServerColumn}]`).join(','):'*';
    const rows =
      (
        await this.query(
          transaction,
          `SELECT ${projection} FROM dbo.[shifts] WITH(UPDLOCK,HOLDLOCK) WHERE id=@shift AND store_id=@branch;`,
          { shift: id(shiftId), branch: id(branchId) },
        )
      ).recordset ?? [];
    const row = rows[0] && JSON.parse(JSON.stringify(toCloudRow(table, rows[0])));
    if (
      rows.length !== 1 ||
      row.status !== "OPEN" ||
      ![null, undefined, "ACTIVE"].includes(row.state) ||
      row.closed_at != null
    )
      fail("The original opening postimage was not confirmed.", "ESHIFT_OPENING_UNVERIFIED");
    const payload = JSON.stringify(row);
    await this.query(
      transaction,
      "INSERT dbo.pos_sync_shift_openings(aggregate_id,shift_id,branch_id,row_json,row_hash) VALUES(@aggregate,@shift,@branch,@row,@hash);",
      {
        aggregate: id(aggregateId),
        shift: id(shiftId),
        branch: id(branchId),
        row: payload,
        hash: hashPayload(payload),
      },
    );
  }
  async openingRows(aggregateId, branchId) {
    const rows =
      (
        await this.query(
          null,
          "SELECT * FROM dbo.pos_sync_shift_openings WHERE aggregate_id=@aggregate AND branch_id=@branch;",
          { aggregate: id(aggregateId), branch: id(branchId) },
        )
      ).recordset ?? [];
    return rows.map((saved) => {
      const row = JSON.parse(saved.row_json);
      if (
        hashPayload(saved.row_json) !== saved.row_hash ||
        id(row.id) !== id(saved.shift_id) ||
        id(row.store_id) !== id(branchId) ||
        row.status !== "OPEN" ||
        row.closed_at != null ||
        ![null, undefined, "ACTIVE"].includes(row.state)
      )
        fail("The immutable opening postimage has different facts.", "EIDEMPOTENCY");
      return row;
    });
  }
  async hasIntents(shiftIds, branchId) {
    if (!shiftIds.length) return new Set();
    const rows =
      (
        await this.query(
          null,
          "SELECT DISTINCT shift_id FROM dbo.pos_sync_shift_intents WHERE branch_id=@branch AND shift_id IN(SELECT TRY_CONVERT(uniqueidentifier,[value]) FROM OPENJSON(@ids));",
          { branch: id(branchId), ids: JSON.stringify(shiftIds) },
        )
      ).recordset ?? [];
    return new Set(rows.map((row) => id(row.shift_id)));
  }
  async acknowledge(transaction, intent, proof) {
    const current = await this.get(intent.intentId, intent.branchId, transaction);
    if (
      !current ||
      current.payloadHash !== intent.payloadHash ||
      proof.intent_id !== intent.intentId ||
      proof.intent_hash !== intent.payloadHash ||
      !TOKEN.test(proof.accepted_token ?? "") ||
      !TOKEN.test(proof.current_token ?? "") ||
      typeof proof.superseded !== "boolean" ||
      proof.superseded !== (proof.accepted_token !== proof.current_token)
    )
      fail(
        "The cloud has not bound acknowledgement to this exact closing intent.",
        "ESHIFT_CLOSURE_UNCONFIRMED",
      );
    validateCoverage(proof.coverage, intent, this.registry);
    await this.query(
      transaction,
      `UPDATE dbo.pos_sync_shift_intents SET accepted_token=@accepted,current_token=@current,superseded=@superseded,
      acknowledged_at=SYSDATETIMEOFFSET(),ack_coverage_json=@coverage WHERE intent_id=@intent AND branch_id=@branch AND payload_hash=@hash;`,
      {
        accepted: proof.accepted_token,
        current: proof.current_token,
        superseded: proof.superseded,
        intent: intent.intentId,
        branch: intent.branchId,
        hash: intent.payloadHash,
        coverage: JSON.stringify(proof.coverage),
      },
    );
    // A receipt acknowledges history only. It never installs a cloud baseline,
    // resets the committed tail, or changes a later local closing intent.
  }
  async verifySavedHistory(transaction, intent) {
    const parent = (
      await this.query(
        transaction,
        "SELECT * FROM dbo.[shifts] WITH(UPDLOCK,HOLDLOCK) WHERE id=@shift AND store_id=@branch;",
        { shift: intent.shiftId, branch: intent.branchId },
      )
    ).recordset?.[0];
    if (!parent || parent.status !== "CLOSED" || parent.state !== "CLOSED" || !parent.closed_at)
      fail("The saved closing receipt has no confirmed current closing parent.", "EIDEMPOTENCY");
    for (const name of ["shift_cash_counts", "shift_reconciliations", "shift_close_events"]) {
      const expected = intent.operations.find((operation) => operation.table === name)?.rows ?? [];
      const actual =
        (
          await this.query(
            transaction,
            `SELECT TOP(2001) * FROM dbo.[${name}] WITH(UPDLOCK,HOLDLOCK) WHERE shift_id=@shift;`,
            { shift: intent.shiftId },
          )
        ).recordset ?? [];
      const table = this.registry.tables.find((table) => table.cloudTable === name);
      if (
        actual.length > 2000 ||
        expected.some(
          (row) =>
            !actual.some(
              (saved) =>
                id(saved.id) === id(row.id) && sameRow(table, toCloudRow(table, saved), row),
            ),
        )
      )
        fail("The saved closing receipt has missing or changed historical facts.", "EIDEMPOTENCY");
    }
  }
  async missingSavedCount(transaction, kind, intent) {
    const inputs = { branch: id(intent.branchId), shift: id(intent.shiftId) };
    const tail = (
      await this.query(
        transaction,
        "SELECT TOP(1) payload_json,payload_hash FROM dbo.pos_sync_shift_intents WITH(UPDLOCK,HOLDLOCK) WHERE branch_id=@branch AND shift_id=@shift ORDER BY intent_sequence DESC;",
        inputs,
      )
    ).recordset?.[0];
    let source;
    if (tail) {
      if (hashPayload(tail.payload_json) !== tail.payload_hash)
        fail("Saved closing metadata has different immutable facts.", "EIDEMPOTENCY");
      source = JSON.parse(tail.payload_json).operations;
    } else {
      const baseline = (
        await this.query(
          transaction,
          "SELECT graph_json FROM dbo.pos_sync_shift_baselines WITH(UPDLOCK,HOLDLOCK) WHERE branch_id=@branch AND shift_id=@shift;",
          inputs,
        )
      ).recordset?.[0];
      source = baseline ? JSON.parse(baseline.graph_json).tables : [];
    }
    return (source.find((entry) => entry.table === "shift_cash_counts")?.rows ?? []).some(
      (row) => row.kind === kind && (kind === "ORIGINAL" || row.client_key === intent.clientKey),
    );
  }
  async coveredChanges(table, changes, branchId, transaction = null) {
    if (!GRAPH_TABLES.includes(table.cloudTable) || !changes.length) return new Set();
    const live = changes.filter((change) => !["D", "delete"].includes(change.operation));
    if (!live.length) return new Set();
    const keys = live.map((change) => id(change.key?.id ?? change.id));
    if (keys.some((key) => !UUID.test(key)) || keys.length > 2000) return new Set();
    const projection = table.columns
      .map((column) =>
        /^(decimal|numeric|money|smallmoney|bigint)\b/i.test(column.sqlServerType)
          ? `CONVERT(nvarchar(100),source.[${column.sqlServerColumn}]) AS [${column.sqlServerColumn}]`
          : `source.[${column.sqlServerColumn}]`,
      )
      .join(",");
    const rows =
      (
        await this.query(
          transaction,
          `SELECT ${projection} FROM dbo.[${table.sqlServerTable}] source ${transaction ? "WITH(UPDLOCK,HOLDLOCK)" : ""}
      WHERE store_id=@branch AND id IN(SELECT TRY_CONVERT(uniqueidentifier,[value]) FROM OPENJSON(@ids));`,
          { branch: id(branchId), ids: JSON.stringify(keys) },
        )
      ).recordset ?? [];
    const shifts = [
      ...new Set(rows.map((row) => id(table.cloudTable === "shifts" ? row.id : row.shift_id))),
    ];
    const covered = new Set();
    // Keep one bounded payload in memory, rather than multiplying a 6 MiB
    // history snapshot by every distinct shift in a CT window.
    for (const shift of shifts) {
      let before = "9223372036854775807",
        scanned = 0;
      const candidates = rows.filter(
        (row) => id(table.cloudTable === "shifts" ? row.id : row.shift_id) === shift,
      );
      while (candidates.some((row) => !covered.has(id(row.id)))) {
        if (scanned++ >= 2000)
          fail(
            "Closing receipt coverage exceeded its bounded history window. Copies remain pending.",
            "ESHIFT_COVERAGE_UNCONFIRMED",
          );
        const receipt = (
          await this.query(
            transaction,
            `SELECT TOP(1) intent_id,intent_sequence,shift_id,payload_json,payload_hash,ack_coverage_json
        FROM dbo.pos_sync_shift_intents ${transaction ? "WITH(UPDLOCK,HOLDLOCK)" : ""}
        WHERE branch_id=@branch AND shift_id=@shift AND acknowledged_at IS NOT NULL AND ack_coverage_json IS NOT NULL
          AND intent_sequence<CONVERT(bigint,@before) ORDER BY intent_sequence DESC;`,
            { branch: id(branchId), shift, before },
          )
        ).recordset?.[0];
        if (!receipt) break;
        const sequence = Number(receipt.intent_sequence);
        if (!Number.isSafeInteger(sequence) || sequence < 1 || BigInt(sequence) >= BigInt(before))
          fail("Closing receipt sequence could not be proved safely.", "EIDEMPOTENCY");
        before = String(sequence);
        if (hashPayload(receipt.payload_json) !== receipt.payload_hash)
          fail("Accepted closing metadata has different saved facts.", "EIDEMPOTENCY");
        const payload = JSON.parse(receipt.payload_json);
        if (
          id(payload.branchId) !== id(branchId) ||
          id(payload.shiftId) !== id(receipt.shift_id) ||
          id(payload.intentId) !== id(receipt.intent_id)
        )
          fail("Accepted closing metadata has another scope.", "EIDEMPOTENCY");
        const coverage = validateCoverage(
          JSON.parse(receipt.ack_coverage_json),
          payload,
          this.registry,
        );
        const proven = new Set(
          coverage.tables
            .find((entry) => entry.table === table.cloudTable)
            .rows.map((row) => id(row.id)),
        );
        const saved = new Map(
          (payload.operations.find((op) => op.table === table.cloudTable)?.rows ?? []).map(
            (row) => [id(row.id), row],
          ),
        );
        for (const row of candidates)
          if (
            proven.has(id(row.id)) &&
            saved.has(id(row.id)) &&
            sameRow(table, toCloudRow(table, row), saved.get(id(row.id)))
          )
            covered.add(id(row.id));
      }
    }
    return covered;
  }
  async adopt(transaction, graph) {
    await this.query(
      transaction,
      `MERGE dbo.pos_sync_shift_baselines WITH(HOLDLOCK) target
      USING(SELECT @branch branch_id,@shift shift_id) source ON target.branch_id=source.branch_id AND target.shift_id=source.shift_id
      WHEN MATCHED THEN UPDATE SET graph_token=@token,closed_at_raw=@closed,graph_json=@graph,observation_generation=@generation
      WHEN NOT MATCHED THEN INSERT(branch_id,shift_id,graph_token,closed_at_raw,graph_json,observation_generation)
        VALUES(@branch,@shift,@token,@closed,@graph,@generation);`,
      {
        branch: id(graph.branchId),
        shift: id(graph.shiftId),
        token: graph.graphToken,
        closed: graph.closedAtRaw,
        graph: JSON.stringify(graph),
        generation: randomUUID(),
      },
    );
  }
}
module.exports = {
  ShiftIntentStore,
  GRAPH_TABLES,
  hashPayload,
  sameRow,
  validateGraph,
  TOKEN,
  UUID,
};
