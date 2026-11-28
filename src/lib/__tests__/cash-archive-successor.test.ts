import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { cashSuccessorFixture } = require("../../../scripts/lib/cash-successor-fixture.cjs");
const { preservesCashBirth } = require("../../../electron/sync/grouped-cash-successor.cjs");
const { applyGroupedCashInTransaction } = require("../../../electron/sync/grouped-cash-receipt.cjs");
const grouped = require("../../../electron/sync/grouped-store-settings.cjs");
type Row = Record<string, unknown>;
function fixture(kind = "refund_v1") {
  const f = cashSuccessorFixture(kind), statements: string[] = [];
  const transaction = { request: () => {
    const inputs: Row = {};
    return { input(name: string, value: unknown) { inputs[name] = value;return this; }, async query(text: string) {
      statements.push(text);
      if (text.includes("AS ready")) return { recordset: [{ ready: 1 }] };
      if (text.includes("DECLARE @baseline")) return { recordset: [{ state: "clear" }] };
      const name = /FROM dbo\.\[([a-z_]+)\] source/.exec(text)?.[1];
      if (!name) throw Error("Unexpected fixture query");
      if (text.includes("source.sale_id=@cashSuccessorSale")) return { recordset: f.localRows[name]
        .filter((row: Row) => row.sale_id === inputs.cashSuccessorSale).map((row: Row) => ({ id: row.id })) };
      const table = f.registry.tables.find((table: { cloudTable: string }) => table.cloudTable === name);
      const rows = f.localRows[name].filter((row: Row) => row.id === inputs.cashSuccessorKey).map((row: Row) => Object.fromEntries(table.columns.map((column: { cloudColumn: string; sqlServerColumn: string; sqlServerType: string }) => {
        const value = row[column.cloudColumn];return [column.sqlServerColumn, value !== null && /^(int|decimal)/.test(column.sqlServerType) ? String(value) : value];
      })));
      return { recordset: rows };
    } };
  } };
  const loader = vi.fn(async () => f.correction);
  const context = { branch: f.branch, extended: true, cashSuccessor: loader, databaseGuid: f.cashGroup.acceptance.database_guid,
    source: { terminal: { tokenId: f.terminal } } };
  const worker = { registry: f.registry, cloud: { applyLocalBatch: vi.fn() }, reader: { unacknowledged: vi.fn(async () => new Set()) } };
  return { ...f, transaction, context, worker, loader, statements };
}
afterEach(() => vi.restoreAllMocks());

describe("cash birth retained under a verified later archived correction", () => {
  it.each(["refund_v1", "tender_v1"])("accepts the exact current registered %s graph while preserving immutable birth fields", async kind => {
    const f = fixture(kind);
    expect(await preservesCashBirth(f.worker, f.transaction, f.context, f.cash)).toBe(true);
    expect(f.statements.every((text: string) => text.includes("WITH(UPDLOCK,HOLDLOCK)"))).toBe(true);
    expect(f.statements.some((text: string) => /\b(UPDATE|INSERT|DELETE|MERGE)\b/.test(text))).toBe(false);
  });
  it.each(["missing", "ordinary-feed", "earlier", "unlinked", "partial-tender"])("holds %s successor evidence", async mode => {
    const f = fixture();
    if (mode === "missing") f.loader.mockResolvedValue(null);
    if (mode === "ordinary-feed") f.context.extended = false;
    if (mode === "earlier") f.correction.seq = "1";
    if (mode === "unlinked") f.correction.sale.id = f.product;
    if (mode === "partial-tender") delete f.correction.receiptGraph;
    expect(await preservesCashBirth(f.worker, f.transaction, f.context, f.cash)).toBe(false);
  });
  it.each(["amount", "product", "timestamp", "foreign-branch"])("does not authorize an unrelated %s change even when current rows match the later graph", async mode => {
    const f = fixture();
    if (mode === "amount") f.graph.sale.total_amount = "10.000000000001";
    if (mode === "product") f.graph.items[0].product_name = "Unrelated edit";
    if (mode === "timestamp") f.graph.sale.created_at = "2026-11-18T00:00:00.1234568Z";
    if (mode === "foreign-branch") f.graph.sale.store_id = "B";
    f.localRows.sales[0] = structuredClone(f.graph.sale);f.localRows.sale_items[0] = structuredClone(f.graph.items[0]);
    f.loader.mockResolvedValue(f.refresh());
    if (mode === "foreign-branch") await expect(preservesCashBirth(f.worker, f.transaction, f.context, f.cash)).rejects.toMatchObject({ code: "ESYNC_GROUPED_REVIEW_REQUIRED" });
    else expect(await preservesCashBirth(f.worker, f.transaction, f.context, f.cash)).toBe(false);
  });
  it("requires complete exact local registered rows and rejects a changed graph digest", async () => {
    const f = fixture();f.localRows.payment_transactions[0].amount = "9.000000000000";
    expect(await preservesCashBirth(f.worker, f.transaction, f.context, f.cash)).toBe(false);
    f.correction.receiptGraph.payload_sha256 = "0".repeat(64);
    await expect(preservesCashBirth(f.worker, f.transaction, f.context, f.cash)).rejects.toMatchObject({ code: "ESYNC_GROUPED_REVIEW_REQUIRED" });
  });
  it.each(["extra-refunded-item", "extra-foreign-tender", "missing-item"])("requires complete local child sets: %s", async mode => {
    const f = fixture();
    if (mode === "extra-refunded-item") f.localRows.sale_items.push({ ...f.localRows.sale_items[0], id: f.product, branch_id: "foreign", refunded_qty: 1 });
    if (mode === "extra-foreign-tender") f.localRows.payment_transactions.push({ ...f.localRows.payment_transactions[0], id: f.product, store_id: "foreign" });
    if (mode === "missing-item") f.localRows.sale_items = [];
    expect(await preservesCashBirth(f.worker, f.transaction, f.context, f.cash)).toBe(false);
  });
  it.each(["amount", "id", "extra-field", "order"])("allows a tender method correction without allowing embedded payment %s edits", async mode => {
    const f = fixture("tender_v1"), payments = JSON.parse(f.graph.sale.payments);
    if (mode === "amount") payments[0].amount = "999.000000000000";
    if (mode === "id") payments[0].id = f.product;
    if (mode === "extra-field") payments[0].unapproved = true;
    if (mode === "order") payments.push({ ...payments[0], id: f.product });
    f.graph.sale.payments = JSON.stringify(payments);f.graph.sale.payments = f.graph.sale.payments.replaceAll(",", ", ");
    f.correction.sale.payments_count = payments.length;
    f.wire.changes[0].row_data.payments_count = payments.length;
    f.localRows.sales[0] = structuredClone(f.graph.sale);f.loader.mockResolvedValue(f.refresh());
    expect(await preservesCashBirth(f.worker, f.transaction, f.context, f.cash)).toBe(false);
  });
  it("preserves pending journal refusal and does not rewrite the refunded receipt", async () => {
    const f = fixture();
    vi.spyOn(grouped, "readLocalRow").mockImplementation(async (...args: unknown[]) => {
      const table = args[1] as { cloudTable: string };
      return { matching: ["sales", "sale_items"].includes(table.cloudTable) ? 0 : 1, row_version: 2 };
    });
    f.worker.reader.unacknowledged.mockResolvedValue(new Set([f.cash.rows[0].change.entity_id]));
    await expect(applyGroupedCashInTransaction(f.worker, f.transaction, f.context, f.cash)).rejects.toMatchObject({ code: "ELOCAL_UPLOAD_PENDING" });
    expect(f.loader).not.toHaveBeenCalled();
    f.worker.reader.unacknowledged.mockResolvedValue(new Set());
    await expect(applyGroupedCashInTransaction(f.worker, f.transaction, f.context, f.cash)).resolves.toEqual([]);
    expect(f.worker.cloud.applyLocalBatch).not.toHaveBeenCalled();
  });
});
