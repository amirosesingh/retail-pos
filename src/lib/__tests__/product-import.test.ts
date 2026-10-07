import { describe, expect, it } from "vitest";
import {
  batches,
  describeOutcome,
  importFailureReason,
  isSystemicImportFailure,
  outcomeReportRows,
  planImport,
  planImportReview,
  persistBatchWithIsolation,
  readNumber,
  resolveReviewConflict,
  reviewRowToImport,
  updateReviewRow,
} from "@/lib/product-import";
import type { Product } from "@/core/types/pos-types";

const product = (over: Partial<Product> = {}): Product => ({
  id: "p1",
  name: "Existing item",
  sku: "SKU1",
  barcode: "111",
  category: "Coffee",
  price: 10,
  cost: 5,
  stockByStore: { s1: 3 },
  reorderLevel: 10,
  taxRate: 0.05,
  ...over,
});

const row = (over: Record<string, unknown> = {}) => ({
  barcode: "222",
  name: "New item",
  price: "9.50",
  cost: "4",
  category: "Drinks",
  stock_quantity: "12",
  custom_points: "1",
  ...over,
});

describe("readNumber", () => {
  it("reads money-formatted values and leaves blanks empty", () => {
    expect(readNumber("RM 1,200.50")).toBe(1200.5);
    expect(readNumber("")).toBeNull();
    expect(readNumber(undefined)).toBeNull();
    expect(readNumber("abc")).toBeNull();
  });
});

describe("planImport", () => {
  it("accepts a good row and marks it as new", () => {
    const plan = planImport([row()], [product()]);
    expect(plan.skipped).toEqual([]);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]).toMatchObject({ barcode: "222", existing: false, stock: 12, line: 2 });
  });

  it("marks a row that matches the catalogue as a restock", () => {
    const plan = planImport([row({ barcode: "111" })], [product()]);
    expect(plan.rows[0].existing).toBe(true);
  });

  it("also matches on an alias barcode", () => {
    const plan = planImport([row({ barcode: "999" })], [product({ barcodes: ["999"] })]);
    expect(plan.rows[0].existing).toBe(true);
  });

  it("names a reason for every row it will not save", () => {
    const plan = planImport(
      [
        row({ barcode: "" }),
        row({ barcode: "333", name: "" }),
        row({ barcode: "444", price: "" }),
        row({ barcode: "555", price: "-2" }),
        row({ barcode: "666", cost: "-1" }),
      ],
      [],
    );
    expect(plan.rows).toHaveLength(0);
    expect(plan.skipped.map((s) => s.reason)).toEqual([
      "Missing barcode",
      "Missing product name",
      "Missing price",
      "Price cannot be negative",
      "Cost cannot be negative",
    ]);
  });

  it("keeps the first of two identical barcodes and explains the second", () => {
    const plan = planImport([row({ barcode: "777" }), row({ barcode: "777" })], []);
    expect(plan.rows).toHaveLength(1);
    expect(plan.skipped[0].reason).toContain("line 2");
  });

  it("ignores a completely blank trailing line", () => {
    const plan = planImport([row(), { barcode: "", name: "" }], []);
    expect(plan.rows).toHaveLength(1);
    expect(plan.skipped).toHaveLength(0);
  });

  it("accounts for every line of the file", () => {
    const records = Array.from({ length: 50 }, (_, i) => row({ barcode: `b${i}` }));
    records.push(row({ barcode: "", name: "no code" }));
    const plan = planImport(records, []);
    expect(plan.rows.length + plan.skipped.length).toBe(plan.total);
  });

  it("tolerates untidy headers", () => {
    const plan = planImport([{ " Barcode ": "888", Product: "x", NAME: "Tea", Price: 3 }], []);
    expect(plan.rows[0]).toMatchObject({ barcode: "888", name: "Tea", price: 3 });
  });

  it("falls back to a cost when the file has none", () => {
    const plan = planImport([row({ cost: "", price: "10" })], []);
    expect(plan.rows[0].cost).toBe(6);
  });
});

describe("reviewable product imports", () => {
  it("fills blank source fields from an existing database product", () => {
    const review = planImportReview(
      [row({ barcode: "111", name: "", price: "", cost: "", category: "" })],
      [product()],
    );
    expect(review.rows[0]).toMatchObject({
      existingProductId: "p1",
      name: "Existing item",
      price: 10,
      cost: 5,
      category: "Coffee",
      status: "ready",
    });
  });

  it("keeps incomplete new products available for inline correction", () => {
    const staged = planImportReview([row({ name: "", price: "" })], []).rows[0];
    expect(staged.status).toBe("missing_information");
    expect(staged.missingFields).toEqual(["name", "price"]);
    const fixed = updateReviewRow(staged, { name: "Tea", price: 8 });
    expect(fixed.status).toBe("new_product");
    expect(reviewRowToImport(fixed)).toMatchObject({ name: "Tea", price: 8, existing: false });
  });

  it("flags contradictory database values until the operator resolves them", () => {
    const staged = planImportReview(
      [row({ barcode: "111", name: "Different", price: "12" })],
      [product()],
    ).rows[0];
    expect(staged.status).toBe("conflict");
    expect(staged.conflictFields).toEqual(expect.arrayContaining(["name", "price"]));
    const resolved = resolveReviewConflict(staged, "database");
    expect(resolved).toMatchObject({ status: "ready", name: "Existing item", price: 10 });
  });

  it("retains duplicate rows as conflicts instead of silently dropping them", () => {
    const review = planImportReview([row({ barcode: "same" }), row({ barcode: "same" })], []);
    expect(review.rows).toHaveLength(2);
    expect(review.rows[1].status).toBe("conflict");
    expect(review.rows[1].issue).toContain("line 2");
  });

  it("requires a positive quantity for receiving but not catalogue imports", () => {
    const record = row({ stock_quantity: "0" });
    expect(planImportReview([record], []).rows[0].missingFields).not.toContain("stock");
    const receiving = planImportReview([record], [], { quantityRequired: true }).rows[0];
    expect(receiving.status).toBe("missing_information");
    expect(receiving.missingFields).toContain("stock");
  });

  it("keeps tax at zero when supplied and leaves a blank rate for Settings", () => {
    const explicit = reviewRowToImport(
      planImportReview([row({ tax_rate_percent: "0" })], []).rows[0],
    );
    const inherited = reviewRowToImport(
      planImportReview([row({ tax_rate_percent: "" })], []).rows[0],
    );
    expect(explicit?.taxRate).toBe(0);
    expect(inherited?.taxRate).toBeUndefined();
  });

  it("rejects imported tax percentages outside 0 to 100", () => {
    const staged = planImportReview([row({ tax_rate_percent: "101" })], []).rows[0];
    expect(staged.status).toBe("missing_information");
    expect(staged.missingFields).toContain("taxRate");
  });
});

describe("batches", () => {
  it("splits into whole groups without dropping anything", () => {
    const groups = batches([1, 2, 3, 4, 5], 2);
    expect(groups).toEqual([[1, 2], [3, 4], [5]]);
    expect(groups.flat()).toHaveLength(5);
  });

  it("never produces a zero-sized group", () => {
    expect(batches([1, 2], 0)).toEqual([[1], [2]]);
  });

  it("isolates one rejected record while saving the rest of its batch", async () => {
    const saved: number[] = [];
    const failed: number[] = [];
    await persistBatchWithIsolation(
      [1, 2, 3, 4],
      async (rows) => {
        if (rows.includes(3)) throw new Error("invalid row");
      },
      (rows) => {
        saved.push(...rows);
      },
      (rows) => {
        failed.push(...rows);
      },
    );
    expect(saved).toEqual([1, 2, 4]);
    expect(failed).toEqual([3]);
  });

  it("does not retry an authentication failure one product at a time", async () => {
    const attempts: number[][] = [];
    const failed: number[][] = [];
    await persistBatchWithIsolation(
      [1, 2, 3, 4],
      async (rows) => {
        attempts.push(rows);
        throw Object.assign(new Error("JWT expired"), { status: 401 });
      },
      () => undefined,
      (rows) => {
        failed.push(rows);
      },
    );
    expect(attempts).toEqual([[1, 2, 3, 4]]);
    expect(failed).toEqual([[1, 2, 3, 4]]);
  });
});

describe("importFailureReason", () => {
  it("turns database errors into something an operator can act on", () => {
    expect(importFailureReason(new Error("permission denied for table products"))).toBe(
      "Not allowed to add products here",
    );
    expect(importFailureReason(new Error("duplicate key value"))).toContain("already used");
    expect(importFailureReason(new Error("Failed to fetch"))).toContain("Connection lost");
    expect(importFailureReason(undefined)).toContain("without saying why");
  });

  it("classifies authentication, permission, connectivity, and bridge failures as systemic", () => {
    expect(isSystemicImportFailure(Object.assign(new Error("JWT expired"), { status: 401 }))).toBe(
      true,
    );
    expect(
      isSystemicImportFailure(Object.assign(new Error("permission denied"), { code: "42501" })),
    ).toBe(true);
    expect(isSystemicImportFailure(new Error("Failed to fetch"))).toBe(true);
    expect(isSystemicImportFailure(new Error("Local transaction storage unavailable"))).toBe(true);
    expect(isSystemicImportFailure(new Error("duplicate key value"))).toBe(false);
  });
});

describe("outcome reporting", () => {
  const outcome = {
    importId: "abc",
    fileName: "f.xlsx",
    startedAt: "now",
    total: 10,
    created: 6,
    restocked: 2,
    skipped: [{ line: 3, barcode: "1", name: "a", reason: "Missing price" }],
    failed: [{ line: 4, barcode: "2", name: "b", reason: "Connection lost" }],
    pending: [],
  };

  it("says how many are still to sort out", () => {
    expect(describeOutcome(outcome)).toContain("1 still to sort out");
    expect(describeOutcome({ ...outcome, failed: [] })).toBe("8 of 10 rows saved");
  });

  it("lists every unsaved row in the report", () => {
    const rows = outcomeReportRows(outcome);
    expect(rows[0]).toEqual(["line", "barcode", "name", "status", "reason"]);
    expect(rows).toHaveLength(3);
  });
});
