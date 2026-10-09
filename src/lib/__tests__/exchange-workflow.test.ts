import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CartLine, Sale } from "@/core/types/pos-types";
import {
  exchangeBlockReason,
  exchangeLineEligible,
  exchangeUnitCredit,
  findExchangeSale,
} from "@/lib/register/use-exchange";

const line = (over: Partial<CartLine> = {}): CartLine => ({
  productId: "product-1",
  name: "Racket",
  price: 100,
  qty: 1,
  taxRate: 0,
  discount: 0,
  ...over,
});

const sale = (receiptNo: string, over: Partial<Sale> = {}): Sale => ({
  id: crypto.randomUUID(),
  receiptNo,
  storeId: "branch-1",
  shiftId: "shift-1",
  lines: [line()],
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
  createdAt: "2026-10-04T00:00:00.000Z",
  ...over,
});

describe("exchange workflow safeguards", () => {
  it("credits the original discounted price, including the bill-level discount", () => {
    const item = line({ discount: 10 });
    const original = sale("B-DISCOUNT", { lines:[item], subtotal:100, discount:28, total:72 });
    expect(exchangeUnitCredit(original, item)).toBe(72);
  });
  it("prefers an exact bill and refuses an ambiguous partial receipt", () => {
    const sales = [
      sale("LC-PC01-20261004-0001"),
      sale("LC-PC01-20261004-0011"),
    ];
    expect(findExchangeSale(sales, "LC-PC01-20261004-0001")).toMatchObject({
      sale: { receiptNo: "LC-PC01-20261004-0001" },
      error: null,
    });
    expect(findExchangeSale(sales, "20261004")).toEqual({
      sale: null,
      error: "More than one bill matches. Enter or scan the complete bill number.",
    });
  });

  it("blocks refunded, already exchanged and return-only bills", () => {
    expect(exchangeBlockReason(sale("B-1", { refunded: true }))).toContain("refunded");
    expect(exchangeBlockReason(sale("B-2", { exchangedToReceiptNo: "B-3" }))).toContain(
      "already exchanged",
    );
    expect(
      exchangeBlockReason(sale("B-4", { lines: [line({ qty: -1, credit: true })] })),
    ).toContain("no exchangeable");
    expect(exchangeBlockReason(sale("B-5"))).toBeNull();
  });

  it("only accepts positive sold lines as return credit candidates", () => {
    expect(exchangeLineEligible(line())).toBe(true);
    expect(exchangeLineEligible(line({ qty: 0 }))).toBe(false);
    expect(exchangeLineEligible(line({ qty: -1, credit: true }))).toBe(false);
  });

  it("routes every exchange opener and checkout through the permission gate", () => {
    const register = readFileSync("src/routes/index.tsx", "utf8");
    const checkout = readFileSync("src/lib/register/use-checkout.ts", "utf8");
    expect(register).toContain('"exchange.open": () => void beginExchange()');
    expect(register).not.toContain('"exchange.open": () => setExchangeOpen(true)');
    expect(checkout).toContain(
      'if (exchangeRef && !(await deps.requirePermission("can_process_exchange"))) return;',
    );
  });

  it("keeps cloud exchange lineage serialized and immutable", () => {
    const migration = readFileSync(
      "supabase/migrations/20261004200000_enforce_exchange_integrity.sql",
      "utf8",
    );
    expect(migration).toContain("sales_one_exchange_per_original_idx");
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toContain("EXCHANGE_ALREADY_USED");
    expect(migration).toContain("EXCHANGE_LINK_IMMUTABLE");
  });

  it("replays the original bill exchange link during Electron cloud sync", () => {
    const migration = readFileSync(
      "supabase/migrations/20261004226000_order_original_sales_before_exchanges.sql",
      "utf8",
    );
    expect(migration).toContain('"exchange_credit",NULL::text');
    expect(migration).toContain('UPDATE public."sales" AS target');
    expect(migration).toContain('FROM jsonb_populate_recordset');
    expect(migration).toContain('target."exchanged_to_bill_number" IS NULL');
    expect(migration).toContain('ORDER BY COALESCE("is_exchange", false), "created_at", "id"');
  });
});
