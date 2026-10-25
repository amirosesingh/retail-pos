import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { mergeStockCountRows, parseStockCountRow, stockCountTemplate } from "../stock-count-import";

describe("stock count upload templates", () => {
  it("batches a large count while preserving existing rows, scan order and last duplicate quantity", () => {
    const existing = [{ productId: "existing", counted: 1 }, { productId: "untouched", counted: 7 }];
    const incoming = Array.from({ length: 10000 }, (_, index) => ({ productId: `p${index}`, counted: index }));
    const merged = mergeStockCountRows(existing, [...incoming, { productId: "p0", counted: 42 }, { productId: "existing", counted: 2 }]);
    expect(merged).toHaveLength(10002);
    expect(merged[0].productId).toBe("p9999");
    expect(merged.find(row => row.productId === "p0")?.counted).toBe(42);
    expect(merged.slice(-2)).toEqual([{ productId: "existing", counted: 2 }, existing[1]]);
    expect(existing[0].counted).toBe(1);
  });
  it.each(["xlsx", "csv"] as const)("round trips a filled %s template without losing codes", (bookType) => {
    const book = stockCountTemplate();
    const sheet = book.Sheets[book.SheetNames[0]!]!;
    expect(XLSX.utils.sheet_to_json(sheet)).toEqual([]);
    XLSX.utils.sheet_add_aoa(sheet, [["001234", "", 0], ["", "001-SKU", 12]], { origin: "A2" });
    const read = XLSX.read(XLSX.write(book, { type: "buffer", bookType }), { type: "buffer", raw: true });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(read.Sheets[read.SheetNames[0]!]!);
    expect(rows.map(parseStockCountRow)).toEqual([{ key: "001234", quantity: 0 }, { key: "001-SKU", quantity: 12 }]);
  });
  it.each([undefined, null, "", " ", -1, 1.5, Infinity, "bad", true])("rejects unsafe or unfinished count %s", value => {
    expect(parseStockCountRow({ barcode: "001", counted: value })).toHaveProperty("error");
  });
  it("accepts normalized headers and a SKU when barcode is blank", () => {
    expect(parseStockCountRow({ " Barcode ": "", SKU: "ABC", Counted: "4" })).toEqual({ key: "ABC", quantity: 4 });
  });
  it("uses a populated quantity alias when workbook parsing supplies blank counted cells", () => {
    expect(parseStockCountRow({ barcode: "001", counted: "", quantity: 4 })).toEqual({ key: "001", quantity: 4 });
    expect(parseStockCountRow({ barcode: "001", counted: " ", quantity: "", qty: 0 })).toEqual({ key: "001", quantity: 0 });
    expect(parseStockCountRow({ barcode: "001", counted: 0, quantity: 4 })).toEqual({ key: "001", quantity: 0 });
    expect(parseStockCountRow({ barcode: "001", counted: "invalid", quantity: 4 })).toHaveProperty("error");
  });
});
