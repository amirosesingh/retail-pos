import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { importWorksheetRows } from "@/lib/import-worksheet-rows";
import { importSourceLine } from "@/lib/import-row-source";
import { planImportReview, readNumber, reviewRowToImport, updateReviewRow } from "@/lib/product-import";

const roundtrip = (sheet: XLSX.WorkSheet) => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Products");
  return XLSX.read(XLSX.write(book, { type: "array", bookType: "xlsx" }), { type: "array", dense: true, raw: true, cellNF: true }).Sheets.Products!;
};

describe("raw workbook values and stable column mapping", () => {
  it("imports identical underlying decimals regardless of currency, date or stale display formats", () => {
    const sheet = XLSX.utils.aoa_to_sheet([["barcode", "name", "price", "cost"], ["00123", "Shoe", 12.3456, 6.125]]);
    sheet.C2!.z = '"RM" #,##0'; sheet.C2!.w = "RM 999";
    sheet.D2!.z = "0.00";
    const records = importWorksheetRows(roundtrip(sheet));
    expect(records).toEqual([{ barcode: "00123", name: "Shoe", price: 12.3456, cost: 6.125 }]);
    expect(reviewRowToImport(planImportReview(records, []).rows[0]!)?.price).toBe(12.3456);
    sheet.C2!.z = "yyyy-mm-dd";
    expect(importWorksheetRows(roundtrip(sheet))[0]!.price).toBe(12.3456);
  });
  it("does not guess percentage notation as currency or tax percentage points", () => {
    const sheet = XLSX.utils.aoa_to_sheet([["barcode", "tax_rate_percent"], ["001", .06]]);
    sheet.B2!.z = "0%";
    expect(() => importWorksheetRows(roundtrip(sheet))).toThrow("Cell B2 (tax_rate_percent) uses percentage notation");
  });
  it("rejects long numeric codes that Excel may already have rounded, but preserves long text codes exactly", () => {
    const sheet = XLSX.utils.aoa_to_sheet([["barcode", "price"], [1234567890123456, 12.5]]);
    expect(() => importWorksheetRows(roundtrip(sheet))).toThrow("Cell A2 (barcode) is a numeric code");
    sheet.A2 = { t: "s", v: "001234567890123456789" };
    expect(importWorksheetRows(roundtrip(sheet))[0]!.barcode).toBe("001234567890123456789");
  });
  it("uses a populated alias when the primary column is blank, but rejects contradictory aliases", () => {
    const sheet = XLSX.utils.aoa_to_sheet([["barcode", "sku", "name", "price", "selling_price"], ["", "001", "A", "", 12.5]]);
    const rows = importWorksheetRows(roundtrip(sheet));
    expect(planImportReview(rows, []).rows[0]).toMatchObject({ barcode: "001", price: 12.5, status: "new_product" });
    sheet.D2 = { t: "n", v: 19 };
    expect(() => importWorksheetRows(roundtrip(sheet))).toThrow("Row 2 has different values in price / selling_price");
  });
  it("does not execute formulas; reads a cached numeric result and rejects an absent result or Excel error by cell", () => {
    const sheet = XLSX.utils.aoa_to_sheet([["barcode", "price"], ["001", 12.5]]);
    sheet.B2 = { t: "n", v: 12.5, f: "25/2" };
    expect(importWorksheetRows(roundtrip(sheet))[0]!.price).toBe(12.5);
    sheet.B2 = { t: "n", f: "WEBSERVICE(\"https://invalid.example\")" };
    expect(() => importWorksheetRows(sheet)).toThrow("Cell B2 (price) has no calculated value");
    sheet.B2 = { t: "e", v: 7 };
    expect(() => importWorksheetRows(roundtrip(sheet))).toThrow("Cell B2 (price) contains an Excel error");
  });
  it("rejects case/spacing duplicate headers instead of overwriting a valid amount with a blank column", () => {
    const sheet = XLSX.utils.aoa_to_sheet([["barcode", " Price ", "price"], ["001", 12.5, ""]]);
    expect(() => importWorksheetRows(roundtrip(sheet))).toThrow('Duplicate column "price" at B1 and C1');
  });
  it("retains blank column positions and reports a populated column N whose header is missing", () => {
    const sheet = XLSX.utils.aoa_to_sheet([["barcode", "", "price"], ["001", "", 12.5]]);
    expect(importWorksheetRows(roundtrip(sheet))).toEqual([{ barcode: "001", price: 12.5 }]);
    sheet.N2 = { t: "n", v: 7 }; sheet["!ref"] = "A1:N2";
    expect(() => importWorksheetRows(roundtrip(sheet))).toThrow("Cell N2 contains data but its column has no header");
  });
  it("keeps real source row numbers across blank/style-only rows and leading empty rows", () => {
    const sheet = XLSX.utils.aoa_to_sheet([[], ["barcode", "name", "price"], ["001", "A", 12.5], [], [], ["002", "B", 4.25]]);
    sheet.A4 = { t: "z", z: "0.00" };
    const records = importWorksheetRows(roundtrip(sheet));
    expect(records.map(importSourceLine)).toEqual([3, 6]);
    expect(planImportReview(records, []).rows.map(row => row.line)).toEqual([3, 6]);
  });
  it("ignores style-expanded ranges while preserving all 10,001 product rows and exact matching columns", () => {
    const data: unknown[][] = [["barcode", "name", "price", "cost"]];
    for (let i = 0; i < 10_001; i++) data.push([String(i).padStart(8, "0"), `Item ${i}`, 12.3456, 6.125]);
    const sheet = roundtrip(XLSX.utils.aoa_to_sheet(data));
    sheet["!ref"] = "A1:XFD1048576";
    const rows = importWorksheetRows(sheet);
    expect(rows).toHaveLength(10_001);
    expect(rows[10_000]).toEqual({ barcode: "00010000", name: "Item 10000", price: 12.3456, cost: 6.125 });
    expect(planImportReview(rows, []).rows.every(row => row.status === "new_product")).toBe(true);
  });
  it("rejects reserved metadata headers", () => {
    expect(() => importWorksheetRows(XLSX.utils.aoa_to_sheet([["__pos_import_source_row"], [100]]))).toThrow("reserved column name");
  });
});

describe("number validation without changing the supplied amount", () => {
  it.each(["12abc50", "USD12oops", "12/50", "1.2.3", "12%", "1,23,456", true, new Date(), {}, []])("rejects invalid numeric input %s", value => {
    expect(readNumber(value)).toBeNull();
  });
  it.each([["12.50", 12.5], ["12,50", 12.5], ["RM 1,200.50", 1200.5], ["1.200,50", 1200.5], ["1\u00a0200,50", 1200.5], [".25", .25], ["(RM 12.50)", -12.5], ["1e-7", 1e-7]])("parses supported decimal notation %s", (value, expected) => {
    expect(readNumber(value)).toBe(expected);
  });
  it.each(["9007199254740993", "12.34567890123456789", "1e-400", "9.007199254740993e15"])("rejects a decimal amount that the number contract would round: %s", value => {
    expect(readNumber(value)).toBeNull();
  });
  it.each(["0.1", "12.50", "6.125", "1e-7", "9007199254740992", "1e20", ".25e2", "-0.000", "1e+00001"])("does not reject ordinary decimal serialization solely because binary floats are approximate: %s", value => {
    expect(readNumber(value)).toBe(Number(value));
  });
  it("keeps invalid supplied amounts in review instead of silently accepting them as defaults", () => {
    const row = planImportReview([{ barcode: "001", name: "Shoe", price: "12oops50", cost: "3foo", tax_rate: "2x", custom_points: "x5" }], []).rows[0]!;
    expect(row.missingFields).toEqual(expect.arrayContaining(["price", "cost", "taxRate", "customPoints"]));
    expect(reviewRowToImport(row)).toBeNull();
    const fixed = updateReviewRow(row, { price: 12.5, cost: 3.125, taxRate: 2.5, customPoints: 5 });
    expect(fixed.status).toBe("new_product");
    expect(reviewRowToImport(fixed)).toMatchObject({ price: 12.5, cost: 3.125, taxRate: .025, customPoints: 5 });
  });
  it("does not replace an invalid supplied amount with an existing catalogue value", () => {
    const existing = { id: "p1", name: "Shoe", barcode: "001", sku: "SKU1", price: 20, cost: 10, taxRate: .05, category: "Default", stockByStore: {}, reorderLevel: 0 };
    const row = planImportReview([{ barcode: "001", price: "12oops50", cost: "foo" }], [existing]).rows[0]!;
    expect(Number.isNaN(row.price)).toBe(true);
    expect(Number.isNaN(row.cost)).toBe(true);
    expect(reviewRowToImport(row)).toBeNull();
  });
});
