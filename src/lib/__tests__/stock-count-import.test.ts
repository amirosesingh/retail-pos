import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseStockCountRow, stockCountTemplate } from "../stock-count-import";

describe("stock count upload templates", () => {
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
