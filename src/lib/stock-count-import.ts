import * as XLSX from "xlsx";

export function stockCountTemplate() {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([["barcode", "sku", "counted"]]);
  sheet["!cols"] = [{ wch: 24 }, { wch: 24 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(book, sheet, "Stock count");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Stock count instructions"],
    ["Fill the first sheet. Enter either barcode or SKU for each product."],
    ["Format barcode and SKU cells as Text before entering codes to preserve leading zeros."],
    ["counted is the physical quantity: a whole number of zero or more. Blank counts are rejected."],
    ["Use one row per product. Review imported counts before posting."],
    ["Only listed products are counted; products omitted from the file are not set to zero."],
    ["CSV uses the same three headers; keep codes as text when editing in Excel."],
  ]), "Instructions");
  return book;
}

export function parseStockCountRow(row: Record<string, unknown>):
  { key: string; quantity: number; error?: never } | { error: string; key?: never; quantity?: never } {
  const fields = Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), value]));
  const key = [fields.barcode, fields.sku, fields.code]
    .map(value => String(value ?? "").trim()).find(Boolean);
  if (!key) return { error: "no barcode or SKU" };
  const value = fields.counted ?? fields.quantity ?? fields.qty;
  const quantity = Number(value);
  if (value == null || String(value).trim() === "" || typeof value === "boolean" ||
      !Number.isSafeInteger(quantity) || quantity < 0) {
    return { error: "counted quantity must be a whole number of zero or more (not blank)" };
  }
  return { key, quantity };
}
