import { createRequire } from "node:module";
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { loadRegistry } = require("../../../electron/db/schema-registry.cjs");
const {
  ShiftIntentStore,
  validateGraph,
  hashPayload,
  sameRow,
} = require("../../../electron/db/shift-intents.cjs");
const { prepareShiftGraphs, applyShiftGraphs } = require("../../../electron/sync/shift-graph.cjs");
const {
  assertShiftClosureAcknowledgement,
} = require("../../../electron/sync/shift-closure-ack.cjs");
const { CloudClient } = require("../../../electron/sync/cloud-client.cjs");
const { PullWorker } = require("../../../electron/sync/pull-worker.cjs");
const { PushWorker } = require("../../../electron/sync/push-worker.cjs");
const { readPage } = require("../../../electron/sync/page-policy.cjs");
const { refreshTable } = require("../../../electron/jobs/bootstrap.cjs");
const { matchingCoverage } = require("../../../scripts/lib/shift-coverage-fixture.cjs");
type Row = Record<string, any>;
const registry = loadRegistry(),
  branch = "branch-a",
  other = "branch-b",
  shift = "11111111-1111-4111-8111-111111111111";
const count = "22222222-2222-4222-8222-222222222222",
  recon = "33333333-3333-4333-8333-333333333333",
  intentId = "44444444-4444-4444-8444-444444444444";
const raw = "2026-11-02T03:00:00.123456+00:00",
  copy = <T>(value: T): T => structuredClone(value);
const key = (id: string) => JSON.stringify({ id });
function graphFixture() {
  const row = (table: string, facts: Row) =>
    Object.assign(
      Object.fromEntries(
        registry.tables
          .find((tableData: Row) => tableData.cloudTable === table)
          .columns.map((column: Row) => [column.cloudColumn, null]),
      ),
      facts,
    );
  const facts = {
    counted_cash: 100,
    counted_card: null,
    counted_digital: null,
    expected_cash: 100,
    expected_card: 0,
    expected_digital: 0,
    variance_cash: 0,
    variance_card: null,
    variance_digital: null,
    variance_total: 0,
    variance_status: "NO_VARIANCE",
  };
  return {
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
            state: "CLOSED",
            status: "CLOSED",
            closed_at: raw,
            opened_at: raw,
            created_at: raw,
            row_version: 5,
            final_counted_cash: 100,
            ...facts,
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
            counted_card: null,
            counted_digital: null,
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
            ...facts,
            created_at: raw,
          }),
        ],
      },
      ...["shift_close_events", "shift_notifications", "shift_variance_alerts"].map((table) => ({
        table,
        rows: [],
      })),
    ],
  };
}
function fixture() {
  let state: Row = {
    tables: Object.fromEntries(registry.tables.map((table: Row) => [table.cloudTable, []])),
    baselines: [],
    intents: [],
  };
  state.tables.shifts.push({
    ...graphFixture().tables[0].rows[0],
    status: "OPEN",
    state: "ACTIVE",
    closed_at: null,
    row_version: 99,
  });
  const queries: string[] = [];
  let fault: string | null = null;
  class Transaction {
    image!: Row;
    async begin() {
      this.image = copy(state);
    }
    async commit() {
      state = this.image;
    }
    async rollback() {}
  }
  class Request {
    inputs: Row = {};
    constructor(readonly owner: Transaction | Row) {}
    input(name: string, ...values: unknown[]) {
      this.inputs[name] = values.at(-1);
      return this;
    }
    async query(statement: string) {
      queries.push(statement);
      const data = this.owner instanceof Transaction ? this.owner.image : state;
      if (fault && statement.includes(fault)) throw new Error("Injected local failure");
      if (statement.startsWith("MERGE dbo.pos_sync_shift_baselines")) {
        data.baselines = [
          {
            branch_id: this.inputs.branch,
            shift_id: this.inputs.shift,
            graph_token: this.inputs.token,
            closed_at_raw: this.inputs.closed,
            graph_json: this.inputs.graph,
            observation_generation: this.inputs.generation,
          },
        ];
        return { recordset: [], rowsAffected: [1] };
      }
      if (statement.includes("intent_sequence<CONVERT(bigint,@before)")) {
        const ids = [this.inputs.shift],
          latest = new Map();
        for (const row of data.intents
          .filter(
            (row: Row) =>
              row.branch_id === this.inputs.branch &&
              row.acknowledged_at &&
              row.ack_coverage_json &&
              row.intent_sequence < Number(this.inputs.before) &&
              ids.includes(row.shift_id),
          )
          .sort((a: Row, b: Row) => b.intent_sequence - a.intent_sequence))
          if (!latest.has(row.shift_id)) latest.set(row.shift_id, row);
        return { recordset: copy([...latest.values()]) };
      }
      if (statement.includes("FROM dbo.pos_sync_shift_intents"))
        return {
          recordset: copy(
            data.intents.filter(
              (row: Row) =>
                row.branch_id === this.inputs.branch &&
                row.shift_id === this.inputs.shift &&
                !row.acknowledged_at,
            ),
          ),
        };
      const table = /dbo\.\[([a-z_]+)\]/.exec(statement)?.[1];
      if (!table) throw new Error("Unhandled isolated SQL: " + statement);
      if (statement.includes(" MERGE ")) {
        const row = Object.fromEntries(
          [...statement.matchAll(/@v(\d+) AS \[([a-z_]+)\]/g)].map((match) => [
            match[2],
            this.inputs[`v${match[1]}`],
          ]),
        );
        const prior = data.tables[table].find((saved: Row) => saved.id === row.id);
        if (prior) Object.assign(prior, row);
        else data.tables[table].push(row);
        return { recordset: [], rowsAffected: [1] };
      }
      if (statement.startsWith("SELECT *") || statement.includes("FROM OPENJSON(@ids)"))
        return {
          recordset: copy(
            data.tables[table].filter((row: Row) =>
              this.inputs.ids
                ? row.store_id === this.inputs.branch &&
                  JSON.parse(this.inputs.ids).includes(row.id)
                : (table === "shifts" ? row.id : row.shift_id) === this.inputs.shift,
            ),
          ),
        };
      throw new Error("Unhandled isolated SQL: " + statement);
    }
  }
  const sql = { Request, Transaction, ISOLATION_LEVEL: { SERIALIZABLE: 4 } },
    manager = { sql: () => sql, pool: { request: () => new Request({}) } },
    reader = { unacknowledged: vi.fn(async () => new Set()) };
  const adopt = async (graph: Row = graphFixture()) => {
    const tx = new Transaction();
    await tx.begin();
    try {
      const result = await applyShiftGraphs({
        transaction: tx,
        connectionManager: manager,
        registry,
        reader,
        branchId: branch,
        prepared: { graphs: new Map([[shift, graph]]) },
      });
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  };
  return {
    manager,
    reader,
    adopt,
    queries,
    data: () => state,
    assumeReceipt: (graph: Row, sequence: number, omitted: Row = {}) => {
      const receiptId = `99999999-9999-4999-8999-${String(sequence).padStart(12, "0")}`;
      const operations = graph.tables.map((entry: Row) => ({
        table: entry.table,
        rows: entry.rows,
        changes: [],
        deletePhase: false,
      }));
      const payload = JSON.stringify({
        version: 1,
        intentId: receiptId,
        branchId: branch,
        shiftId: shift,
        kind: "RECOUNT",
        baseToken: null,
        predecessorIntentId: null,
        predecessorIntentHash: null,
        operations,
      });
      const receipt = {
        intent_id: receiptId,
        intent_sequence: sequence,
        branch_id: branch,
        shift_id: shift,
        payload_json: payload,
        payload_hash: hashPayload(payload),
        acknowledged_at: "accepted",
        ack_coverage_json: JSON.stringify(matchingCoverage(registry, operations, omitted)),
      };
      state.intents.push(receipt);
      return receipt;
    },
    setFault: (value: string) => {
      fault = value;
    },
  };
}

describe("native causal closing transfer", () => {
  it("ships the same additive 022 metadata in fresh and installed database artifacts", () => {
    const source = readFileSync(
      "database/sqlserver/migrations/022_shift_causal_intents.sql",
      "utf8",
    ).replaceAll("\r\n", "\n");
    for (const file of [
      "schema.sql",
      "migrations/001_initial.sql",
      "retail-pos-local-database.sql",
    ])
      expect(readFileSync("database/sqlserver/" + file, "utf8").replaceAll("\r\n", "\n")).toContain(
        source.split("-- SHIFT36_HISTORY_BEGIN")[0],
      );
    const sections = require("../../../electron/db/installer-source.cjs").installerSections();
    expect(sections.migrations.map((entry: Row) => entry.version)).toEqual(
      Array.from({ length: 21 }, (_, index) => index + 2),
    );
    expect(sections.migrations.at(-1).name).toBe("022_shift_causal_intents.sql");
    expect(sections.validation).toContain("WHERE version = 22");
    expect(source).not.toMatch(
      /\b(?:DELETE|UPDATE|TRUNCATE)\s+(?:FROM\s+)?dbo\.\[?(?:shifts|shift_cash_counts|sync_checkpoints)\b/i,
    );
  });
  it("adopts complete CLOSED5 over OPEN99 and stores exact raw graph/token atomically", async () => {
    const f = fixture(),
      graph = graphFixture();
    await expect(f.adopt(graph)).resolves.toBe(3);
    expect(f.data().tables.shifts[0]).toMatchObject({
      status: "CLOSED",
      state: "CLOSED",
      row_version: 5,
      closed_at: raw,
    });
    expect(f.data().tables.shift_cash_counts).toHaveLength(1);
    expect(f.data().tables.shift_reconciliations).toHaveLength(1);
    expect(f.data().baselines[0]).toMatchObject({
      graph_token: graph.graphToken,
      closed_at_raw: raw,
      graph_json: JSON.stringify(graph),
    });
    expect(f.reader.unacknowledged).toHaveBeenCalledOnce();
    expect(
      f.queries.findIndex((query) => query.includes("pos_sync_shift_baselines")),
    ).toBeGreaterThan(
      f.queries.length -
        1 -
        [...f.queries].reverse().findIndex((query) => query.includes("shift_reconciliations]")),
    );
  });
  it.each([
    "pending journal/CT",
    "pending intent",
    "SQL failure",
    "missing saved history",
    "changed immutable history",
  ])("preserves local graph and baseline on %s", async (failure) => {
    const f = fixture(),
      graph = graphFixture();
    if (failure === "pending journal/CT")
      f.reader.unacknowledged.mockResolvedValueOnce(new Set([key(shift)]));
    if (failure === "pending intent")
      f.data().intents.push({ branch_id: branch, shift_id: shift, acknowledged_at: null });
    if (failure === "SQL failure") f.setFault("MERGE dbo.[shift_reconciliations]");
    if (failure === "missing saved history")
      f.data().tables.shift_close_events.push({ id: intentId, shift_id: shift, store_id: branch });
    if (failure === "changed immutable history")
      f.data().tables.shift_cash_counts.push({ ...graph.tables[1].rows[0], counted_cash: 999 });
    const before = copy(f.data());
    await expect(f.adopt(graph)).rejects.toBeDefined();
    expect(f.data()).toEqual(before);
  });
  it.each(["owner", "token", "tables", "closed time", "count link", "effective facts"])(
    "refuses malformed atomic graph: %s",
    async (invalid) => {
      const f = fixture(),
        graph: Row = graphFixture();
      if (invalid === "owner") graph.tables[1].rows[0].store_id = other;
      if (invalid === "token") graph.graphToken = "js-rounded-time";
      if (invalid === "tables") graph.tables.pop();
      if (invalid === "closed time") graph.closedAtRaw = "2026-11-02T03:00:00.123Z";
      if (invalid === "count link") graph.tables[2].rows[0].count_id = intentId;
      if (invalid === "effective facts") {
        graph.tables[0].rows[0].counted_cash = 101;
        graph.tables[0].rows[0].final_counted_cash = 101;
      }
      const before = copy(f.data());
      await expect(f.adopt(graph)).rejects.toBeDefined();
      expect(f.data()).toEqual(before);
    },
  );
  it("fetches one atomic read for a child-only/split page and never derives its token locally", async () => {
    const f = fixture(),
      graph = graphFixture(),
      cloud = { shiftGraph: vi.fn(async () => graph) };
    const changes = graph.tables.slice(1, 3).flatMap((entry) =>
      entry.rows.map((row) => ({
        table_name: entry.table,
        entity_id: key(String(row.id)),
        row_data: row,
        tombstone: false,
      })),
    );
    const prepared = await prepareShiftGraphs({
      cloud,
      connectionManager: f.manager,
      branchId: branch,
      changes,
    });
    expect(cloud.shiftGraph).toHaveBeenCalledExactlyOnceWith({ branchId: branch, shiftId: shift });
    expect(changes.every((change) => prepared.covers(change))).toBe(true);
    expect(prepared.graphs.get(shift)).toBe(graph);
  });
  it("reduces a memory-heavy page instead of permanently rejecting the same graph set", async () => {
    const first = graphFixture(),
      second = JSON.parse(JSON.stringify(first).replaceAll(shift, intentId)),
      bytes = Buffer.byteLength(JSON.stringify(first), "utf8"),
      limits: number[] = [];
    const cloud = {
      shiftGraph: async ({ shiftId }: { shiftId: string }) => (shiftId === shift ? first : second),
    };
    const page = await readPage(async (limit: number) => {
      limits.push(limit);
      const graphs = limit > 10 ? [first, second] : [first];
      const changes = graphs.map((graph) => ({
        table_name: "shifts",
        entity_id: key(graph.shiftId),
        row_data: graph.tables[0].rows[0],
      }));
      await prepareShiftGraphs({
        cloud,
        connectionManager: {},
        branchId: branch,
        changes,
        byteBudget: Math.floor(bytes * 1.5),
      });
      return { rows: changes, tombstones: [], count: changes.length, cursor: changes.length };
    }, 20);
    expect(limits).toEqual([20, 10]);
    expect(page.batch.count).toBe(1);
  });
  it("bootstrap graph retry retains a mutating row filter's selected key", async () => {
    const f = fixture(),
      graph = graphFixture(),
      missing = new Set([shift]),
      filter = vi.fn((row: Row) => {
        const selected = missing.has(row.id);
        missing.delete(row.id);
        return selected;
      });
    const cloud = {
      bootstrapPage: vi.fn(async () => ({ rows: graph.tables[0].rows, cursor: null })),
      shiftGraph: vi
        .fn()
        .mockRejectedValueOnce(
          Object.assign(new Error("Page graph budget"), { code: "EOVERSIZED" }),
        )
        .mockResolvedValue(graph),
      applyLocalBatch: vi.fn(),
    };
    await expect(
      refreshTable({
        registry,
        cloud,
        connectionManager: f.manager,
        reader: f.reader,
        branchId: branch,
        tableName: "shifts",
        rowFilter: filter,
      }),
    ).resolves.toEqual({ completed: 3 });
    expect(filter).toHaveBeenCalledOnce();
    expect(cloud.bootstrapPage).toHaveBeenCalledTimes(2);
    expect(cloud.applyLocalBatch).not.toHaveBeenCalled();
    expect(f.data().baselines).toHaveLength(1);
  });
  it("uses legacy guarded nonclosed path only with explicit null token/raw time and an unequivocal nonclosed parent", async () => {
    const graph: Row = graphFixture();
    Object.assign(graph, { graphToken: null, closedAtRaw: null });
    Object.assign(graph.tables[0].rows[0], {
      state: "VARIANCE_REVIEW_REQUIRED",
      status: "OPEN",
      closed_at: null,
    });
    expect(() => validateGraph(graph, branch, shift, { allowUnclosed: true })).not.toThrow();
    graph.tables[0].rows[0].closed_at = raw;
    expect(() => validateGraph(graph, branch, shift, { allowUnclosed: true })).toThrow();
  });
  it("retains pull cursor when atomic graph adoption is interrupted, and advances only after retry succeeds", async () => {
    const f = fixture(),
      graph = graphFixture(),
      save = vi.fn(),
      publish = vi.fn();
    let failed = true;
    const cloud = {
      shiftGraph: vi.fn(async () => {
        if (failed) throw new Error("Interrupted graph read");
        return graph;
      }),
      pullBatch: vi.fn(async () => ({
        rows: [{ table_name: "shifts", entity_id: key(shift), row_data: graph.tables[0].rows[0] }],
        tombstones: [],
        count: 1,
        cursor: 10,
      })),
    };
    const worker = new PullWorker({
      connectionManager: f.manager,
      cloud,
      registry,
      reader: f.reader,
      checkpoints: { get: async () => ({ committed_cursor: 5 }), save },
      publish,
    });
    worker.ensureTicketDependencies = async () => {};
    await expect(worker.run({ branchId: branch, skipMembership: true })).rejects.toThrow(
      "Interrupted",
    );
    expect(save).not.toHaveBeenCalled();
    expect(f.data().tables.shifts[0].status).toBe("OPEN");
    failed = false;
    await expect(worker.run({ branchId: branch, skipMembership: true })).resolves.toMatchObject({
      merged: 3,
    });
    expect(save).toHaveBeenCalledWith(
      branch,
      "__feed__",
      "pull",
      { committed_cursor: 10 },
      expect.anything(),
    );
    expect(publish).toHaveBeenCalledOnce();
  });
  it("covers only the exact accepted CT facts, preserving changed versions, unrelated edits and tombstones", async () => {
    const f = fixture(),
      graph = graphFixture();
    await f.adopt(graph);
    const table = registry.tables.find((table: Row) => table.cloudTable === "shifts"),
      store = new ShiftIntentStore(f.manager, registry);
    const payload = JSON.stringify({
      intentId,
      branchId: branch,
      shiftId: shift,
      operations: graph.tables.map((entry) => ({ table: entry.table, rows: entry.rows })),
    });
    f.data().intents.push({
      intent_id: intentId,
      branch_id: branch,
      shift_id: shift,
      intent_sequence: 1,
      payload_json: payload,
      payload_hash: hashPayload(payload),
      acknowledged_at: "accepted",
      ack_coverage_json: JSON.stringify(matchingCoverage(registry, graph.tables)),
    });
    const changes = [
      { key: { id: shift }, operation: "U" },
      { key: { id: count }, operation: "U" },
    ];
    await expect(store.coveredChanges(table, changes, branch)).resolves.toEqual(new Set([shift]));
    f.data().tables.shifts[0].row_version = 6;
    await expect(store.coveredChanges(table, changes, branch)).resolves.toEqual(new Set());
    f.data().tables.shifts[0].row_version = 5;
    await expect(
      store.coveredChanges(table, [{ key: { id: shift }, operation: "D" }], branch),
    ).resolves.toEqual(new Set());
  });
  it("preserves raw PostgreSQL microseconds when freezing a new intent from the adopted SQL projection", async () => {
    const f = fixture(),
      graph = graphFixture();
    await f.adopt(graph);
    const store = new ShiftIntentStore(f.manager, registry),
      saved: Row[] = [];
    store.query = async (_tx: unknown, _statement: string, inputs: Row) => {
      saved.push(inputs);
      return {};
    };
    const sqlProjection = new Map(
      graph.tables.map((entry) => [
        entry.table,
        entry.rows.map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
              key,
              typeof value === "string" && value === raw ? new Date(raw).toISOString() : value,
            ]),
          ),
        ),
      ]),
    );
    const frozen = await store.freeze({}, intentId, "RECOUNT", sqlProjection, {
      branchId: branch,
      shiftId: shift,
      baseline: f.data().baselines[0],
      tail: null,
    });
    expect(frozen.baseToken).toBe(graph.graphToken);
    expect(frozen.operations[0].rows[0].closed_at).toBe(raw);
    expect(
      frozen.operations.find((operation: Row) => operation.table === "shift_cash_counts").rows[0]
        .created_at,
    ).toBe(raw);
    expect(saved[0].hash).toBe(hashPayload(frozen.payloadJson));
  });
  it("retains received redacted historical detail through adoption and a later frozen recount", async () => {
    const f = fixture(),
      graph = graphFixture();
    const metadata = registry.tables.find(
      (table: Row) => table.cloudTable === "shift_close_events",
    );
    graph.tables
      .find((entry) => entry.table === "shift_close_events")!
      .rows.push(
        Object.assign(
          Object.fromEntries(metadata.columns.map((column: Row) => [column.cloudColumn, null])),
          {
            id: intentId,
            store_id: branch,
            shift_id: shift,
            event: "fixture_audit",
            created_at: raw,
            detail: {
              table_name: "terminal_tokens",
              row_data: { id: "redacted", claim_proof: "[redacted]", secret_hash: "[redacted]" },
            },
          },
        ),
      );
    await f.adopt(graph);
    const store = new ShiftIntentStore(f.manager, registry);
    store.query = async () => ({});
    const frozen = await store.freeze(
      {},
      recon,
      "RECOUNT",
      new Map(graph.tables.map((entry) => [entry.table, entry.rows])),
      { branchId: branch, shiftId: shift, baseline: f.data().baselines[0], tail: null },
    );
    expect(
      frozen.operations.find((op: Row) => op.table === "shift_close_events").rows[0].detail,
    ).toEqual(graph.tables.find((entry) => entry.table === "shift_close_events")!.rows[0].detail);
    expect(frozen.baseToken).toBe(graph.graphToken);
  });
  it("skips only accepted CT copies at their bounded window while uploading an unrelated opening", async () => {
    const f = fixture(),
      graph = graphFixture();
    await f.adopt(graph);
    const table = registry.tables.find((table: Row) => table.cloudTable === "shifts"),
      store = new ShiftIntentStore(f.manager, registry);
    const payload = JSON.stringify({
      intentId,
      branchId: branch,
      shiftId: shift,
      operations: graph.tables.map((entry) => ({ table: entry.table, rows: entry.rows })),
    });
    f.data().intents.push({
      intent_id: intentId,
      branch_id: branch,
      shift_id: shift,
      intent_sequence: 1,
      payload_json: payload,
      payload_hash: hashPayload(payload),
      acknowledged_at: "accepted",
      ack_coverage_json: JSON.stringify(matchingCoverage(registry, graph.tables)),
    });
    const opening = {
      ...graph.tables[0].rows[0],
      id: count,
      status: "OPEN",
      state: "ACTIVE",
      closed_at: null,
      row_version: 1,
    };
    f.data().tables.shifts.push(opening);
    const window = [
        { key: { id: shift }, operation: "U", version: 40 },
        { key: { id: count }, operation: "I", version: 41 },
      ],
      save = vi.fn(),
      pushBatch = vi.fn(async () => ({ ok: true }));
    const reader = {
      pendingAggregates: async () => [],
      changedIds: vi.fn().mockResolvedValueOnce(window).mockResolvedValue([]),
      acceptedShiftChanges: (metadata: Row, changes: Row[], scope: string) =>
        store.coveredChanges(metadata, changes, scope),
      rows: async (_metadata: Row, changes: Row[]) =>
        f
          .data()
          .tables.shifts.filter((row: Row) => changes.some((change) => change.key.id === row.id)),
    };
    const worker = new PushWorker({
      reader,
      registry: { tables: [table] },
      cloud: { pushBatch },
      checkpoints: { list: async () => [], save },
    });
    await worker.run({ branchId: branch });
    expect(pushBatch).toHaveBeenCalledOnce();
    expect((pushBatch.mock.calls[0] as unknown as Row[])[0].rows).toEqual([opening]);
    expect(save).toHaveBeenCalledWith(branch, "shifts", "push", { change_tracking_version: 41 });
  });
  it("compares decimal facts exactly without JavaScript large-number rounding", () => {
    const table = { columns: [{ cloudColumn: "amount", cloudType: "numeric" }] };
    expect(sameRow(table, { amount: "100.000" }, { amount: 100 })).toBe(true);
    expect(
      sameRow(table, { amount: "999999999999999999.01" }, { amount: "999999999999999999.02" }),
    ).toBe(false);
  });
  it("does not clear an unuploaded note observed by a closing intent when the server omitted that parent", async () => {
    const f = fixture(),
      graph = graphFixture();
    graph.tables[0].rows[0].note = "server note";
    await f.adopt(graph);
    Object.assign(f.data().tables.shifts[0], {
      note: "unuploaded local note",
      row_version: 6,
      updated_at: "2026-11-02T04:00:00.000Z",
    });
    const observed = copy(graph);
    observed.tables[0].rows[0] = copy(f.data().tables.shifts[0]);
    f.assumeReceipt(observed, 1, { shifts: [shift] });
    const table = registry.tables.find((table: Row) => table.cloudTable === "shifts"),
      store = new ShiftIntentStore(f.manager, registry);
    await expect(
      store.coveredChanges(table, [{ key: { id: shift }, operation: "U" }], branch),
    ).resolves.toEqual(new Set());
    const acknowledged = vi.fn(),
      save = vi.fn(),
      pushAggregate = vi.fn(),
      pushBatch = vi.fn(),
      group = {
        aggregateId: count,
        changes: [
          { entity_type: "shifts", entity_id: key(shift), key: { id: shift }, operation: "update" },
        ],
      };
    const reader = {
      pendingAggregates: async (_branch: string, _limit: number, excluded: string[] = []) =>
        excluded.includes(count) ? [] : [group],
      protectedIntent: async () => null,
      frozenOpeningRows: async () => [],
      protectedShiftIds: async () => new Set([shift]),
      acceptedShiftChanges: (metadata: Row, changes: Row[], scope: string) =>
        store.coveredChanges(metadata, changes, scope),
      rows: async () => copy(f.data().tables.shifts),
      acknowledgeAggregate: acknowledged,
      failAggregate: vi.fn(),
      changedIds: vi
        .fn()
        .mockResolvedValueOnce([{ key: { id: shift }, operation: "U", version: 50 }])
        .mockResolvedValue([]),
    };
    const worker = new PushWorker({
      reader,
      registry: { tables: [table] },
      cloud: { pushAggregate, pushBatch },
      checkpoints: { list: async () => [], save },
    });
    await expect(worker.run({ branchId: branch })).resolves.toMatchObject({
      deferredTables: ["shifts"],
    });
    expect(acknowledged).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(pushAggregate).not.toHaveBeenCalled();
    expect(pushBatch).not.toHaveBeenCalled();
    expect(f.data().tables.shifts[0].note).toBe("unuploaded local note");
    expect(f.data().baselines[0].graph_token).toBe(graph.graphToken);
  });
  it.each([false, true])(
    "uses a historical fully matched alert receipt only when no fresh local metadata edit exists: edited=%s",
    async (edited) => {
      const f = fixture(),
        graph = graphFixture(),
        alertId = "66666666-6666-4666-8666-666666666666",
        metadata = registry.tables.find(
          (table: Row) => table.cloudTable === "shift_variance_alerts",
        );
      graph.tables
        .find((entry) => entry.table === "shift_variance_alerts")!
        .rows.push(
          Object.assign(
            Object.fromEntries(metadata.columns.map((column: Row) => [column.cloudColumn, null])),
            {
              id: alertId,
              shift_id: shift,
              store_id: branch,
              reconciliation_id: recon,
              delivery_status: "pending",
              attempts: 0,
              created_at: raw,
              updated_at: raw,
            },
          ),
        );
      await f.adopt(graph);
      f.assumeReceipt(graph, 1);
      if (edited)
        Object.assign(f.data().tables.shift_variance_alerts[0], {
          attempts: 2,
          updated_at: "2026-11-02T05:00:00.000Z",
        });
      const later = copy(graph);
      later.tables.find((entry) => entry.table === "shift_variance_alerts")!.rows = copy(
        f.data().tables.shift_variance_alerts,
      );
      f.assumeReceipt(later, 2, { shift_variance_alerts: [alertId] }); // WEB sent/changed the alert before the later SQL write; server preserves it.
      const store = new ShiftIntentStore(f.manager, registry),
        before = copy(f.data());
      await expect(
        store.coveredChanges(metadata, [{ key: { id: alertId }, operation: "U" }], branch),
      ).resolves.toEqual(new Set(edited ? [] : [alertId]));
      expect(f.data()).toEqual(before);
      expect(f.queries.filter((query) => query.includes("intent_sequence<CONVERT"))).toHaveLength(
        edited ? 3 : 2,
      );
    },
  );
});

describe("native v3 closing proof/wire binding", () => {
  const fixture = () => {
    const operations = graphFixture().tables.map((entry) => ({
      table: entry.table,
      rows: entry.rows,
    }));
    const payloadJson = JSON.stringify({
      version: 1,
      intentId,
      branchId: branch,
      shiftId: shift,
      kind: "RECOUNT",
      baseToken: "a".repeat(64),
      predecessorIntentId: null,
      predecessorIntentHash: null,
      operations,
    });
    const intent = {
      ...JSON.parse(payloadJson),
      payloadJson,
      payloadHash: hashPayload(payloadJson),
    };
    const proof = {
      id: shift,
      store_id: branch,
      row_version: 4,
      requested_row_version: 5,
      intent_id: intentId,
      intent_hash: intent.payloadHash,
      accepted_token: "a".repeat(64),
      current_token: "b".repeat(64),
      superseded: true,
      coverage: matchingCoverage(registry, operations),
    };
    return {
      intent,
      proof,
      ack: { ok: true, shift_closure_ack_version: 3, shift_closures: [proof] },
    };
  };
  it("accepts a bound historical/superseded receipt, including an independent lower server counter", () => {
    const f = fixture();
    expect(
      assertShiftClosureAcknowledgement(f.ack, f.intent.operations, branch, f.intent, registry),
    ).toBe(f.proof);
  });
  it.each([
    "intent_id",
    "intent_hash",
    "requested_row_version",
    "store_id",
    "accepted_token",
    "superseded",
  ])("rejects invalid %s proof", (field) => {
    const f = fixture();
    (f.proof as Row)[field] =
      field === "superseded" ? false : field === "requested_row_version" ? 99 : "wrong";
    expect(() =>
      assertShiftClosureAcknowledgement(f.ack, f.intent.operations, branch, f.intent, registry),
    ).toThrow();
  });
  it("never accepts v2 for a frozen v3 intent", () => {
    const f = fixture();
    f.ack.shift_closure_ack_version = 2;
    expect(() =>
      assertShiftClosureAcknowledgement(f.ack, f.intent.operations, branch, f.intent, registry),
    ).toThrow();
  });
  it.each([
    "unknown field",
    "missing business field",
    "clock as business override",
    "duplicate row",
    "unbound row",
    "business server value",
    "missing managed clock",
    "missing table",
    "missing coverage",
  ])("keeps malformed %s coverage pending", (invalid) => {
    const f = fixture(),
      entry = f.proof.coverage.tables.find((entry: Row) => entry.table === "shifts");
    if (invalid === "unknown field") entry.unrecognized = true;
    if (invalid === "missing business field")
      entry.fields = entry.fields.filter((field: string) => field !== "note");
    if (invalid === "clock as business override") entry.serverManagedFields.push("note");
    if (invalid === "duplicate row") entry.rows.push(copy(entry.rows[0]));
    if (invalid === "unbound row") entry.rows[0].id = count;
    if (invalid === "business server value") entry.rows[0].serverValues.note = "forged";
    if (invalid === "missing managed clock") delete entry.rows[0].serverValues.row_version;
    if (invalid === "missing table") f.proof.coverage.tables.pop();
    if (invalid === "missing coverage") delete (f.proof as Row).coverage;
    expect(() =>
      assertShiftClosureAcknowledgement(f.ack, f.intent.operations, branch, f.intent, registry),
    ).toThrow();
  });
  it("omits outer operations and preserves exact payloadJson bytes on transport", async () => {
    const f = fixture(),
      client = new CloudClient({}),
      request = vi.fn(async (_payload: Row) => ({ ok: true }));
    client.request = request;
    await client.pushAggregate({
      batchId: intentId,
      branchId: branch,
      shiftIntent: { ...f.intent, operations: undefined, payloadHash: undefined },
    });
    expect(request.mock.calls[0][0].sqlServerAggregate.operations).toBeUndefined();
    expect(request.mock.calls[0][0].sqlServerAggregate.shiftIntent.payloadJson).toBe(
      f.intent.payloadJson,
    );
  });
  it.each(["PGRST202", "42883", "404"])(
    "reports protocol %s unavailable without fallback",
    async (code) => {
      const client = new CloudClient({}),
        request = vi.fn(async () => {
          throw Object.assign(new Error("Missing RPC"), {
            code,
            status: code === "404" ? 404 : 400,
          });
        });
      client.request = request;
      await expect(client.shiftGraph({ branchId: branch, shiftId: shift })).rejects.toMatchObject({
        code: "ESHIFT_PROTOCOL_UNAVAILABLE",
      });
      expect(request).toHaveBeenCalledOnce();
    },
  );
});
