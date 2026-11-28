import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { PushWorker } = require("../../../electron/sync/push-worker.cjs");
const { ChangeReader } = require("../../../electron/sync/change-reader.cjs");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const branch = "A", terminal = uuid(1), saleId = uuid(2), movement = uuid(3);
const saleOperation = uuid(4), refundOperation = uuid(5), independent = uuid(6);
type Row = Record<string, unknown>;
const table = (name: string, key = "id", order = 1) => ({ sqlServerTable: name, cloudTable: name,
  direction: "both", scope: "branch", dependencyOrder: order, columns: [
    { sqlServerColumn: key, cloudColumn: key, primaryKey: true, sqlServerType: "uniqueidentifier", cloudType: "uuid" },
    { sqlServerColumn: "store_id", cloudColumn: "store_id", sqlServerType: "nvarchar(128)", cloudType: "text" },
  ] });
const sales = table("sales"), stock = table("stock_delta_applied", "movement_id", 2), audit = table("audit_logs", "id", 3);
const shifts = table("shifts");
const change = (entity_type: string, key: Row) => ({ entity_type, key, entity_id: JSON.stringify(key), operation: "insert" });

function workerFixture(mode: "metadata-error" | "approval-hold" | "history-pending" | "capture-race" | "ambiguous-business-ack") {
  const acknowledged = new Set<string>(), checkpoints = new Map<string, number>();
  let loseBusinessResponse = mode === "ambiguous-business-ack";
  const groups = [
    { aggregateId: saleOperation, changes: [change("sales", { id: saleId })] },
    { aggregateId: refundOperation, changes: [change("sales", { id: saleId }), change("stock_delta_applied", { movement_id: movement })] },
  ];
  const reader = {
    pendingAggregates: vi.fn(async (_branch: string, _limit: number, deferred: string[]) =>
      groups.filter(group => !acknowledged.has(group.aggregateId) && !deferred.includes(group.aggregateId))),
    financialAggregateRequired: async () => true,
    financialHistoryReady: async () => mode !== "history-pending",
    acknowledgeAggregate: vi.fn(async (id: string) => { acknowledged.add(id); }),
    failAggregate: vi.fn(),
    financialBusinessPending: vi.fn(async (value: { cloudTable: string }) =>
      mode !== "capture-race" && acknowledged.size < groups.length && ["sales", "stock_delta_applied"].includes(value.cloudTable)),
    acceptedFinancialBusinessChanges: async (value: { cloudTable: string }) =>
      acknowledged.size === groups.length ? new Set([value.cloudTable === "stock_delta_applied" ? movement : saleId]) : new Set(),
    changedIds: vi.fn(async (value: { cloudTable: string }, since: number) => since ? [] : [{ version: 1,
      operation: "I", key: value.cloudTable === "stock_delta_applied" ? { movement_id: movement }
        : { id: value.cloudTable === "sales" ? saleId : independent } }]),
    rows: vi.fn(async (value: { cloudTable: string }, _changes: unknown, options: { exactFinancial?: boolean }) => {
      if (mode === "capture-race" && !options.exactFinancial && value.cloudTable === "stock_delta_applied")
        throw Object.assign(new Error("Financial work committed after the CT precheck"), { code: "EFINANCIAL_BUSINESS_PENDING" });
      return value.cloudTable === "stock_delta_applied" ? [{ movement_id: movement, store_id: branch, delta: 2 }]
        : [{ id: value.cloudTable === "sales" ? saleId : independent, store_id: branch }];
    }),
  };
  const ack = async ({ batchId }: { batchId: string }) => ({ ok: true, batch_id: batchId });
  const cloud = { terminalId: () => terminal, pushBatch: vi.fn(async (batch: { batchId: string; table: string }) => ack(batch)), pushAggregate: vi.fn(async (batch: Row) => {
    if (mode === "approval-hold") throw Object.assign(new Error("Fresh refund approval is required"), { code: "ESYNC_REFUND_APPROVAL_REQUIRED" });
    if (loseBusinessResponse) { loseBusinessResponse = false;throw new TypeError("Lost business reply after server commit"); }
    return ack(batch as { batchId: string });
  }) };
  const save = vi.fn(async (_branch: string, name: string, _direction: string, value: { change_tracking_version: number }) => {
    checkpoints.set(name, value.change_tracking_version);
  });
  const worker = new PushWorker({ reader, cloud, checkpoints: { get: async (_branch: string, name: string) =>
    checkpoints.has(name) ? { change_tracking_version: checkpoints.get(name) } : null, save },
    registry: { tables: [sales, stock, audit] }, financialHistoryEnabled: true });
  worker.registerFinancialHistory = vi.fn(async () => {
    if (mode === "metadata-error" && worker.registerFinancialHistory.mock.calls.length > 1)
      throw Object.assign(new Error("Rejected original SALE metadata"), { status: 400, code: "FIN62_OPERATION_FACT_INVALID" });
  });
  worker.retry = async (run: () => unknown) => run();
  return { worker, reader, cloud, acknowledged, checkpoints, save };
}

describe("financial journal ownership of untagged stock CT", () => {
  it("retains the refund's extra movement table when an earlier shared sale fails metadata", async () => {
    const f = workerFixture("metadata-error");
    await expect(f.worker.run({ branchId: branch })).rejects.toMatchObject({ code: "FIN62_OPERATION_FACT_INVALID" });
    expect(f.worker.blockedTables.has("stock_delta_applied")).toBe(true);
    expect(f.cloud.pushBatch.mock.calls.map(([batch]: [{ table: string }]) => batch.table)).toEqual(["audit_logs"]);
    expect(f.checkpoints.has("stock_delta_applied")).toBe(false);
    expect(f.acknowledged.size).toBe(0);
  });
  it.each(["approval-hold", "history-pending"] as const)("keeps %s effects in the journal and CT while independent work continues", async mode => {
    const f = workerFixture(mode), result = await f.worker.run({ branchId: branch });
    expect(result.deferredTables).toContain("stock_delta_applied");
    expect(f.cloud.pushBatch.mock.calls.map(([batch]: [{ table: string }]) => batch.table)).toEqual(["audit_logs"]);
    expect(f.checkpoints.has("stock_delta_applied")).toBe(false);
    expect(f.acknowledged.size).toBe(0);
    if (mode === "approval-hold") expect(result).toMatchObject({ allUploaded: false, refundUploadHeld: { code: "ESYNC_REFUND_APPROVAL_REQUIRED" } });
  });
  it("retains a newly committed financial effect found during the serializable row capture", async () => {
    const f = workerFixture("capture-race");
    // The financial journal page may be empty before the new local commit.
    f.reader.pendingAggregates.mockResolvedValue([]);
    const result = await f.worker.run({ branchId: branch });
    expect(result.deferredTables).toContain("stock_delta_applied");
    expect(f.checkpoints.has("stock_delta_applied")).toBe(false);
    expect(f.cloud.pushBatch.mock.calls.some(([batch]: [{ table: string }]) => batch.table === "stock_delta_applied")).toBe(false);
  });
  it("checks durable ownership even when no financial group was in this journal page", async () => {
    const f = workerFixture("history-pending");f.reader.pendingAggregates.mockResolvedValue([]);
    const result = await f.worker.run({ branchId: branch });
    expect(result.deferredTables).toContain("stock_delta_applied");
    expect(f.checkpoints.has("stock_delta_applied")).toBe(false);
  });
  it("retains every effect after a lost business ACK and clears only exact accepted movement CT on replay", async () => {
    const f = workerFixture("ambiguous-business-ack");
    await expect(f.worker.run({ branchId: branch })).rejects.toThrow("Lost business reply");
    expect(f.acknowledged.size).toBe(0);expect(f.checkpoints.has("stock_delta_applied")).toBe(false);
    expect(f.cloud.pushBatch.mock.calls.map(([batch]: [{ table: string }]) => batch.table)).toEqual(["audit_logs"]);
    await expect(f.worker.run({ branchId: branch })).resolves.toMatchObject({ deferredTables: [] });
    expect(f.acknowledged.size).toBe(2);expect(f.checkpoints.get("stock_delta_applied")).toBe(1);
    expect(f.cloud.pushBatch.mock.calls.map(([batch]: [{ table: string }]) => batch.table)).toEqual(["audit_logs"]);
    expect(f.cloud.pushAggregate.mock.calls[0][0]).toEqual(f.cloud.pushAggregate.mock.calls[1][0]);
  });
});

describe("native pending-financial key and capture contract", () => {
  function readerFixture({ financialEnabled = true, sourceTerminal = terminal } = {}) {
    const events: string[] = [], queries: { text: string; inputs: Row; transaction: unknown }[] = [];
    const state = { pending: true, owned: true, openingDuringCapture: false, hasOpeningTable: true, canSeeSchema: true, receipt: null as Row | null };
    const physical = { movement_id: movement, store_id: branch };
    const saleParent = { id: saleId, store_id: branch };
    const shift = { id: uuid(17), store_id: branch };
    class Transaction { begin = async () => { events.push("begin"); }; commit = async () => { events.push("commit"); }; rollback = async () => { events.push("rollback"); }; }
    class Request {
      inputs: Row = {};
      constructor(readonly transaction?: Transaction) {}
      input(name: string, value: unknown) { this.inputs[name] = value; return this; }
      async query(text: string) {
        queries.push({ text, inputs: { ...this.inputs }, transaction: this.transaction });
        if (text.includes("DECLARE @pending bit=0")) {
          events.push("legacy-opening-check");
          const pending = state.pending && !state.canSeeSchema ? null : state.hasOpeningTable && state.pending ? 1 : 0;
          return { recordset: [{ pending }] };
        }
        if (text.includes("FROM dbo.sync_change_journal j WITH(HOLDLOCK)")) {
          const pendingOnly = text.includes("j.acknowledged_at IS NULL");
          events.push(pendingOnly ? "pending" : "ownership");
          return { recordset: (pendingOnly ? state.pending : state.owned) ? [{ change_id: 1 }] : [] };
        }
        if (text.includes("FROM dbo.sales WITH(HOLDLOCK)")) {
          events.push("ticket-parent");
          return { recordset: [{ id: saleId.toUpperCase(), store_id: branch, bill_number: this.inputs.reference }] };
        }
        if (text.includes("FROM dbo.[sales] source WITH(UPDLOCK,HOLDLOCK)")) {
          events.push("financial-sale");
          return { recordset: [saleParent] };
        }
        if (text.includes("SELECT operation_id,operation_type,entity_id,note FROM dbo.local_operation_receipts")) {
          events.push("business-receipt");
          return { recordset: state.receipt ? [state.receipt] : [] };
        }
        if (text.includes("FROM dbo.[shifts] source")) {
          events.push("shift-row");
          if (state.openingDuringCapture) state.pending = true;
          return { recordset: [shift] };
        }
        if (text.includes("__financial_row_json")) { events.push("rows");return { recordset: [{ ...physical, __financial_row_json: JSON.stringify(physical) }] }; }
        throw Error("Unexpected fixture query");
      }
    }
    const manager = { sql: () => ({ Request, Transaction, ISOLATION_LEVEL: { SERIALIZABLE: 4 } }), pool: { request: () => new Request() } };
    const source = { identity: { branchId: branch, terminalId: sourceTerminal, databaseGuid: uuid(7), projectOrigin: "https://fixture.test",
      backend: "https://fixture-pos.test", activation: "synthetic", profile: "fixture" }, assertSource: vi.fn() };
    const reader = new ChangeReader(manager, { tables: [sales, stock, shifts] }, {
      financialOperations: { enabled: financialEnabled, schema: async () => {} },
      financialCoverageSource: financialEnabled ? source : null,
    });
    const changes = [{ key: { movement_id: movement }, operation: "I" }];
    return { reader, state, changes, events, queries, source, saleParent, shift };
  }
  it("matches movement_id and current branch/terminal against pending aggregate financial evidence", async () => {
    const f = readerFixture();expect(await f.reader.financialBusinessPending(stock, f.changes, branch, terminal)).toBe(true);
    expect(f.queries[0].inputs).toMatchObject({ branch, terminal, table: "stock_delta_applied", ids: JSON.stringify([movement]) });
    expect(f.queries[0].text).toContain("'$.movement_id'");
    expect(f.queries[0].text).toContain("j.acknowledged_at IS NULL");
    expect(f.queries[0].text).toContain("pos_sync_shift_financial_sale_lineage");
    expect(f.events).toEqual(["begin", "pending", "commit"]);
  });
  it("holds ordinary movement reads within the same serializable capture, while the protected writer can capture them", async () => {
    const f = readerFixture();
    await expect(f.reader.rows(stock, f.changes, { branchId: branch })).rejects.toMatchObject({ code: "EFINANCIAL_BUSINESS_PENDING" });
    expect(f.events).toEqual(["begin", "rows", "pending", "rollback"]);
    expect(f.queries[0].transaction).toBe(f.queries[1].transaction);
    expect(f.queries[0].text).toContain("source.[movement_id]");
    await expect(f.reader.rows(stock, f.changes, { branchId: branch, exactFinancial: true })).resolves.toEqual([{ movement_id: movement, store_id: branch }]);
    f.state.pending = false;
    await expect(f.reader.rows(stock, f.changes, { branchId: branch })).resolves.toEqual([{ movement_id: movement, store_id: branch }]);
  });
  it("does not introduce a SQL query on legacy, disabled financial paths", async () => {
    const reader = new ChangeReader({}, { tables: [stock] });
    expect(await reader.financialBusinessPending(stock, [{ key: { movement_id: movement } }], branch, terminal)).toBe(false);
  });
  it("holds an opening that appears after tracking was sampled within the scoped capture", async () => {
    const f = readerFixture();
    const changes = [{ key: { id: f.shift.id }, operation: "I" }];
    f.state.pending = false;
    expect(await f.reader.financialBusinessPending(shifts, changes, branch, terminal)).toBe(false);
    f.state.openingDuringCapture = true;
    await expect(f.reader.rows(shifts, changes, { branchId: branch })).rejects.toMatchObject({
      code: "EFINANCIAL_BUSINESS_PENDING", table: "shifts",
    });
    expect(f.events.slice(-4)).toEqual(["begin", "shift-row", "pending", "rollback"]);
    const [capture, ownership] = f.queries.slice(-2);
    expect(capture.transaction).toBe(ownership.transaction);
    expect(capture.text).toContain("FROM dbo.[shifts] source WITH(HOLDLOCK)");
    expect(ownership.text).toContain("o.origin_kind=N'OPEN' AND o.branch_id=@branch");
    expect(ownership.text).toContain("o.shift_id=TRY_CONVERT(uniqueidentifier,wanted.[value]) AND o.local_aggregate_id=j.aggregate_id");
    expect(ownership.inputs).toMatchObject({ branch, terminal, table: "shifts", ids: JSON.stringify([f.shift.id]) });
    f.state.openingDuringCapture = false;
    await expect(f.reader.rows(shifts, changes, { branchId: branch, exactFinancial: true })).resolves.toEqual([f.shift]);
    f.state.pending = false;
    await expect(f.reader.rows(shifts, changes, { branchId: branch })).resolves.toEqual([f.shift]);
  });
  it("holds another same-branch terminal's opening when both use the same SQL database", async () => {
    const nextTerminal = uuid(18);
    const f = readerFixture({ sourceTerminal: nextTerminal });
    const changes = [{ key: { id: f.shift.id }, operation: "I" }];
    await expect(f.reader.rows(shifts, changes, { branchId: branch })).rejects.toMatchObject({ code: "EFINANCIAL_BUSINESS_PENDING" });
    const ownership = f.queries.at(-1)!;
    expect(ownership.inputs).toMatchObject({ branch, terminal: nextTerminal });
    expect(ownership.text).toContain("o.shift_id=TRY_CONVERT(uniqueidentifier,wanted.[value]) AND o.local_aggregate_id=j.aggregate_id");
    expect(ownership.text).not.toContain("o.terminal_id=@terminal\n            AND o.shift_id");
  });
  it("holds pending openings with financial transport disabled and reads shifts on an old schema", async () => {
    const f = readerFixture({ financialEnabled: false });
    const changes = [{ key: { id: f.shift.id }, operation: "I" }];
    await expect(f.reader.rows(shifts, changes, { branchId: branch })).rejects.toMatchObject({ code: "EFINANCIAL_BUSINESS_PENDING" });
    expect(f.events).toEqual(["begin", "shift-row", "legacy-opening-check", "rollback"]);
    expect(f.queries[0].transaction).toBe(f.queries[1].transaction);
    expect(f.queries[1].text).toContain("IF OBJECT_ID(N'dbo.pos_sync_shift_financial_origins',N'U') IS NOT NULL");
    expect(f.queries[1].text).toContain("j.aggregate_id=o.local_aggregate_id");
    expect(f.queries[1].inputs).toMatchObject({ branch, ids: JSON.stringify([f.shift.id]) });
    f.state.hasOpeningTable = false;
    await expect(f.reader.rows(shifts, changes, { branchId: branch })).resolves.toEqual([f.shift]);
    f.state.canSeeSchema = false;
    await expect(f.reader.rows(shifts, changes, { branchId: branch })).rejects.toMatchObject({
      code: "EFINANCIAL_HISTORY_UNCONFIRMED", table: "shifts",
    });
    f.state.pending = false;
    await expect(f.reader.rows(shifts, changes, { branchId: branch })).resolves.toEqual([f.shift]);
  });
  it("holds an independent completed ticket until its exact financial sale is proved present", async () => {
    const f = readerFixture();
    const completed = { store_id: branch, bill_no: "stock-report-bill", status: "completed" };
    await expect(f.reader.ticketCompletionParents([completed], branch, terminal))
      .rejects.toMatchObject({ code: "EFINANCIAL_BUSINESS_PENDING", table: "sales" });
    expect(f.events).toEqual(["begin", "ticket-parent", "pending", "rollback"]);
    expect(f.queries[0].transaction).toBe(f.queries[1].transaction);
    expect(f.queries[0].inputs).toEqual({ branch, reference: completed.bill_no });
    expect(f.queries[1].inputs).toMatchObject({ branch, terminal, table: "sales", ids: JSON.stringify([saleId]) });
    expect(f.queries[1].text).toContain("j.acknowledged_at IS NULL");
    f.state.pending = false;
    await expect(f.reader.ticketCompletionParents([completed], branch, terminal))
      .rejects.toMatchObject({ code: "EFINANCIAL_BUSINESS_PENDING", table: "sales" });
    expect(f.events.slice(-7)).toEqual(["begin", "ticket-parent", "pending", "ownership", "financial-sale", "business-receipt", "rollback"]);
    const key = f.reader.financialCoverageKey(sales, f.saleParent, f.source);
    f.state.receipt = {
      operation_id: key.id, operation_type: "financial_business_row_accepted", entity_id: key.entity,
      note: `${key.rowHash}:${key.schemaHash}:${saleOperation}`,
    };
    await expect(f.reader.ticketCompletionParents([completed], branch, terminal)).resolves.toEqual([]);
    expect(f.events.slice(-7)).toEqual(["begin", "ticket-parent", "pending", "ownership", "financial-sale", "business-receipt", "commit"]);
    expect(new Set(f.queries.slice(-5).map(query => query.transaction)).size).toBe(1);
  });
  it("still attaches the ordinary legacy sale parent for a completed ticket", async () => {
    const f = readerFixture();
    f.state.pending = false;
    f.state.owned = false;
    const completed = { store_id: branch, bill_no: "legacy-bill", status: "completed" };
    await expect(f.reader.ticketCompletionParents([completed], branch, terminal))
      .resolves.toEqual([{ table: "sales", rows: [{ id: saleId, store_id: branch, bill_number: completed.bill_no }] }]);
    expect(f.events).toEqual(["begin", "ticket-parent", "pending", "ownership", "commit"]);
  });
});
