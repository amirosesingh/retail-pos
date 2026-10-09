/**
 * Checkout, end to end at the database boundary.
 *
 * A completed bill must land as one consistent set of rows (bill, lines,
 * tenders, stock movements, member points), and a retried attempt must never
 * bill the customer twice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const platform = vi.hoisted(() => ({ offlineFirst: false }));
const live = vi.fn();
const localWrite = vi.fn();
const localAggregate = vi.fn();
const attemptRows = vi.fn(() => ({ data: [] as unknown[] | null, error: null as unknown }));

vi.mock("@/lib/sync-engine", () => ({
  runOpLive: (...a: unknown[]) => live(...a),
  drainOutbox: async () => {},
}));
vi.mock("@/platform-config/features", () => ({
  hasFeature: (name: string) => name === "offlineFirst" && platform.offlineFirst,
}));
vi.mock("@/core/local-db/local-db", () => ({
  localDb: () => ({
    write: (...a: unknown[]) => localWrite(...a),
    writeBatch: (...a: unknown[]) => localWrite(...a),
    commitAggregate: (...a: unknown[]) => localAggregate(...a),
    database: { getState: async () => ({ enabled: true, connected: true, state: "ready" }) },
  }),
  electronDb: () => null,
  readBranch: () => ({ branchId: null, branchName: null }),
}));
vi.mock("@/integrations/supabase/external-client", () => ({
  supabaseExternal: {
    from: () => ({
      select: () => ({ eq: () => ({ limit: () => attemptRows() }) }),
    }),
  },
}));

import {
  db,
  receivingPriceOps,
  receivingCorrectionOps,
  type ReceivingInvoice,
} from "@/core/api/pos-db";
import { setPreferredDatabaseMode } from "@/core/local-db/db-mode";
import type { Member, Product, Sale } from "@/core/types/pos-types";

const sale = (over: Partial<Sale> = {}): Sale =>
  ({
    id: "sale-1",
    clientTxnId: "txn-1",
    receiptNo: "B101-PC01-20260811-0001",
    storeId: "store-1",
    shiftId: "shift-1",
    lines: [
      { productId: "p1", name: "Racket", price: 100, qty: 1, taxRate: 0, discount: 0, cost: 60 },
    ],
    subtotal: 100,
    discount: 0,
    tax: 0,
    total: 100,
    paid: 100,
    change: 0,
    method: "cash",
    memberId: null,
    pointsEarned: 0,
    cashier: "Cashier",
    createdAt: new Date().toISOString(),
    ...over,
  }) as Sale;

const opsSent = () =>
  live.mock.calls.map(
    (c) =>
      c[1] as {
        kind: string;
        table: string;
        rows?: unknown[];
        args?: Record<string, unknown>;
      },
  );
const saleArgs = () => opsSent().find((o) => o.kind === "rpc" && o.table === "sales")?.args;

describe("checkout commit", () => {
  beforeEach(() => {
    platform.offlineFirst = false;
    live.mockReset();
    localWrite.mockReset();
    localAggregate.mockReset();
    attemptRows.mockClear();
    attemptRows.mockReturnValue({ data: [], error: null });
    live.mockResolvedValue(undefined);
    localWrite.mockResolvedValue({ ok: true });
    localAggregate.mockResolvedValue({ ok: true });
    setPreferredDatabaseMode("online");
  });
  afterEach(() => setPreferredDatabaseMode("local"));

  it("writes bill, lines, tender ledger and stock movement together", async () => {
    await db.commitSale(sale(), [], null);
    expect(opsSent().map((o) => `${o.kind}:${o.table}`)).toContain("rpc:sales");
    expect(saleArgs()?.["_sale"]).toBeTruthy();
    expect(saleArgs()?.["_items"]).toHaveLength(1);
    expect(saleArgs()?.["_payments"]).toHaveLength(1);
    expect(saleArgs()?.["_movements"]).toHaveLength(1);
  });

  it("records only the old-POS exchange difference and both stock movements", async () => {
    const exchange = sale({exchangeOfReceiptNo:"OLDPOS:RECEIPT-7", exchangeCredit:70, subtotal:12, total:12, paid:12,
      lines:[{productId:"returned",name:"Returned",qty:-1,price:70,taxRate:0,discount:0,credit:true},
        {productId:"replacement",name:"Replacement",qty:1,price:82,taxRate:0,discount:0}]});
    await db.commitSale(exchange,[],null);
    const args = saleArgs()!;
    expect(args._exchange_bill).toBeNull();
    expect(args._sale).toMatchObject({total_amount:12,paid_amount:12,original_bill_number:"OLDPOS:RECEIPT-7",is_exchange:true});
    expect(args._movements).toEqual(expect.arrayContaining([
      expect.objectContaining({product_id:"returned",quantity_delta:1}),
      expect.objectContaining({product_id:"replacement",quantity_delta:-1})]));
    platform.offlineFirst = true;
    setPreferredDatabaseMode("local");
    await db.commitSale(exchange,[],null);
    const operations=localAggregate.mock.calls[0][0].operations;
    expect(operations.filter((op: {table:string;kind:string}) => op.table === "sales")).toHaveLength(1);
    expect(operations.find((op: {table:string}) => op.table === "sales").rows[0].total_amount).toBe(12);
  });

  it("records one ledger row per tender on a split payment", async () => {
    await db.commitSale(
      sale({
        payments: [
          { method: "cash", amount: 60 },
          { method: "card", amount: 40 },
        ],
      } as never),
      [],
      null,
    );
    const tenders = saleArgs()?.["_payments"] as { amount: number }[];
    expect(tenders).toHaveLength(2);
    expect(tenders.reduce((a, r) => a + r.amount, 0)).toBe(100);
  });

  it("skips a zero-value tender line", async () => {
    await db.commitSale(
      sale({
        payments: [
          { method: "cash", amount: 100 },
          { method: "card", amount: 0 },
        ],
      } as never),
      [],
      null,
    );
    expect(saleArgs()?.["_payments"]).toHaveLength(1);
  });

  it("does not bill twice when the same attempt is retried", async () => {
    attemptRows.mockReturnValue({ data: [{ id: "sale-1" }], error: null });
    const target = await db.commitSale(sale(), [], null);
    expect(target).toBe("cloud");
    expect(opsSent()).toHaveLength(1);
    expect(opsSent()[0]?.kind).toBe("rpc");
  });

  it("still saves when the duplicate check itself cannot run", async () => {
    attemptRows.mockReturnValue({ data: null, error: { message: "offline" } });
    await db.commitSale(sale(), [], null);
    expect(saleArgs()?.["_sale"]).toBeTruthy();
  });

  it("links an exchange back to the original bill", async () => {
    await db.commitSale(
      sale({ exchangeOfReceiptNo: "B101-PC01-20260810-0007" } as never),
      [],
      null,
    );
    expect(saleArgs()?.["_exchange_bill"]).toBe("B101-PC01-20260810-0007");
  });

  it("atomically claims the original bill in Electron local SQL", async () => {
    platform.offlineFirst = true;
    await db.commitSale(
      sale({
        exchangeOfReceiptNo: "B101-PC01-20260810-0007",
        exchangeOfSaleId: "77777777-7777-4777-8777-777777777777",
      } as never),
      [],
      null,
    );
    const aggregate = localAggregate.mock.calls[0][0] as {
      operations: Array<Record<string, unknown>>;
    };
    expect(aggregate.operations.at(-1)).toMatchObject({
      kind: "update",
      table: "sales",
      match: {
        id: "77777777-7777-4777-8777-777777777777",
        bill_number: "B101-PC01-20260810-0007",
        exchanged_to_bill_number: null,
        is_refunded: false,
      },
      requireMatch: true,
    });
  });

  it("commits cash, card, member and loyalty rows to Electron SQL Server before sync", async () => {
    platform.offlineFirst = true;
    const member: Member = {
      id: "11111111-1111-4111-8111-111111111111",
      code: "MEM-1",
      name: "Member One",
      phone: "1234567",
      email: "member@example.com",
      tier: "Silver",
      points: 25,
      totalSpend: 500,
      joinedAt: "2026-01-01T00:00:00.000Z",
    };
    const product: Product = {
      id: "p1",
      name: "Racket",
      sku: "RACKET-1",
      barcode: "10001",
      category: "Sports",
      price: 100,
      cost: 60,
      stockByStore: { "store-1": 9 },
      reorderLevel: 2,
      taxRate: 0,
    };
    const target = await db.commitSale(
      sale({
        memberId: member.id,
        payments: [
          { method: "cash", amount: 60 },
          { method: "card", amount: 40, reference: "CARD-1" },
        ],
        roundingAdjustment: 0,
        roundingLabel: "No rounding",
      } as never),
      [product],
      member,
    );

    expect(target).toBe("local");
    expect(live).not.toHaveBeenCalled();
    expect(attemptRows).not.toHaveBeenCalled();
    expect(localAggregate).toHaveBeenCalledOnce();
    const aggregate = localAggregate.mock.calls[0][0] as {
      kind: string;
      operations: Array<{ table: string; rows?: Array<Record<string, unknown>> }>;
    };
    const ipcGuard = await import("../../../electron/ipc-guard.cjs");
    expect(() => ipcGuard.aggregate(aggregate)).not.toThrow();
    expect(aggregate.kind).toBe("sale");
    const saleRow = aggregate.operations.find((op) => op.table === "sales")?.rows?.[0];
    const paymentRows =
      aggregate.operations.find((op) => op.table === "payment_transactions")?.rows ?? [];
    const memberRow = aggregate.operations.find((op) => op.table === "members")?.rows?.[0];
    expect(saleRow).toMatchObject({ member_id: member.id, shift_id: "shift-1" });
    expect(paymentRows).toHaveLength(2);
    expect(paymentRows.map((row) => row.member_id)).toEqual([member.id, member.id]);
    expect(paymentRows.map((row) => row.client_transaction_id)).toEqual([
      "txn-1:pay:0",
      "txn-1:pay:1",
    ]);
    expect(memberRow).toMatchObject({ id: member.id, loyalty_points: 25, total_spent: 500 });
    const tableOrder = aggregate.operations.map((operation) => operation.table);
    expect(tableOrder.indexOf("products")).toBeLessThan(tableOrder.indexOf("sale_items"));
    expect(tableOrder.indexOf("members")).toBeLessThan(tableOrder.indexOf("sales"));
    expect(tableOrder.indexOf("sales")).toBeLessThan(tableOrder.indexOf("payment_transactions"));

    const registry = JSON.parse(
      readFileSync("database/sqlserver/schema-registry.json", "utf8"),
    ) as {
      tables: Array<{ cloudTable: string; columns: Array<{ cloudColumn: string }> }>;
    };
    const allowed = new Map(
      registry.tables.map((table) => [
        table.cloudTable,
        new Set(table.columns.map((column) => column.cloudColumn)),
      ]),
    );
    for (const operation of aggregate.operations) {
      for (const row of operation.rows ?? []) {
        expect(
          Object.keys(row).filter((column) => !allowed.get(operation.table)?.has(column)),
          `${operation.table} includes fields rejected by Electron SQL Server`,
        ).toEqual([]);
      }
    }
  });

  it("refuses checkout when the Electron SQL transaction does not commit", async () => {
    platform.offlineFirst = true;
    localAggregate.mockResolvedValueOnce({
      ok: false,
      code: "ESQLSERVER_WRITE",
      error: "Local SQL Server sale commit failed while writing payment_transactions.",
      table: "payment_transactions",
    });

    await expect(db.commitSale(sale(), [], null)).rejects.toMatchObject({
      code: "ESQLSERVER_WRITE",
      table: "payment_transactions",
    });
    expect(localAggregate).toHaveBeenCalledOnce();
    expect(live).not.toHaveBeenCalled();
  });

  it("marks returned lines as returns in the stock ledger", async () => {
    await db.commitSale(
      sale({
        lines: [
          { productId: "p1", name: "Racket", price: 100, qty: 1, taxRate: 0, discount: 0 },
          {
            productId: "p2",
            name: "Grip",
            price: 40,
            qty: -1,
            taxRate: 0,
            discount: 0,
            credit: true,
          },
        ],
      } as never),
      [],
      null,
    );
    const moves = saleArgs()?.["_movements"] as { activity_type: string; quantity_delta: number }[];
    expect(moves.map((m) => m.activity_type)).toEqual(["sale", "return"]);
    expect(moves[1].quantity_delta).toBe(1);
  });
});

describe("receiving stock ownership", () => {
  const previous = {
    id: "aaaaaaaa-bbbb-4ccc-addd-eeeeeeeeeeee",
    status: "posted",
    storeId: "branch-1",
    invoiceNo: "PO-1",
    operator: "Manager",
    lines: [{ productId: "product-1", name: "Item", qty: 4, cost: 2, price: 3 }],
  } as ReceivingInvoice;
  it("changes pricing without writing absolute quantities", () => {
    const ops = receivingPriceOps(previous, true);
    expect(ops).toEqual([
      {
        kind: "update",
        table: "products",
        match: { id: "product-1" },
        values: { cost_price: 2, selling_price: 3 },
      },
    ]);
  });
  it("finalizes a saved desktop draft with its movements in the paired branch", async () => {
    const { receivingLocation } = await import("../receiving-location");
    const paired = { id: "branch-1", name: "Branch", code: "B1", address: "", phone: "" };
    const hub = { ...paired, id: "central", isCentral: true };
    const destination = receivingLocation([hub, paired], hub, true, paired.id);
    const invoice = { ...previous, storeId: destination.id };
    localAggregate.mockReset().mockResolvedValue({ ok: true });
    await db.saveReceivingDraft(invoice);
    await db.updateReceivingInvoice(invoice, [], destination.id);
    const draft = localAggregate.mock.calls[0][0];
    const posted = localAggregate.mock.calls[1][0];
    expect(draft.operations.some((op: { table: string }) => op.table === "item_activity_logs")).toBe(false);
    expect(posted.kind).toBe("receiving");
    expect(posted.branchId).toBe(paired.id);
    const header = posted.operations.find((op: { table: string }) => op.table === "purchase_orders");
    const movement = posted.operations.find((op: { table: string }) => op.table === "item_activity_logs");
    expect(header.rows[0]).toMatchObject({ id: invoice.id, status: "posted", store_id: paired.id });
    expect(movement.rows[0]).toMatchObject({ store_id: paired.id, quantity_delta: 4 });
    // Retrying Finalize reuses the movement id, rather than receiving twice.
    await db.updateReceivingInvoice(invoice, [], destination.id);
    const retry = localAggregate.mock.calls[2][0];
    expect(retry.operations.find((op: { table: string }) => op.table === "item_activity_logs").rows[0].id)
      .toBe(movement.rows[0].id);
  });
  it("posts only the correction delta and reuses IDs on retry", () => {
    const next = { ...previous, lines: [{ ...previous.lines[0], qty: 7 }] };
    const attempt = "bbbbbbbb-cccc-4ddd-aeee-ffffffffffff";
    const first = receivingCorrectionOps(next, previous, attempt)[0];
    const retry = receivingCorrectionOps(next, previous, attempt)[0];
    if (first.kind !== "upsert" || retry.kind !== "upsert")
      throw new Error("Expected movement upsert");
    expect(first.rows[0].quantity_delta).toBe(3);
    expect(first.rows[0].id).toBe(retry.rows[0].id);
    expect(first.rows[0].store_id).toBe("branch-1");
  });
  it("reverses a removed product and leaves drafts without price writes", () => {
    const next = { ...previous, lines: [] };
    const op = receivingCorrectionOps(next, previous, "bbbbbbbb-cccc-4ddd-aeee-ffffffffffff")[0];
    if (op.kind !== "upsert") throw new Error("Expected movement upsert");
    expect(op.rows[0].quantity_delta).toBe(-4);
    expect(receivingPriceOps({ ...previous, status: "draft" })).toEqual([]);
    expect(receivingPriceOps(previous, false)).toEqual([]);
  });
});
