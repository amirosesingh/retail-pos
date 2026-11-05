import * as XLSX from "xlsx";
import { IMPORT_SOURCE_ROW } from "./import-row-source";

const headerKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "_");
const populated = (cell: XLSX.CellObject | undefined) => cell?.f != null ||
  (cell?.v != null && String(cell.v).trim() !== "");
const numericFields = new Set(["price", "selling_price", "retail", "cost", "cost_price", "unit_cost", "stock_quantity", "quantity", "qty", "received", "counted", "custom_points", "tax_rate_percent", "tax_rate"]);
const aliases = [["price", "selling_price", "retail"], ["cost", "cost_price", "unit_cost"], ["stock_quantity", "quantity", "qty", "received"], ["tax_rate_percent", "tax_rate"]];

/** Read underlying values, never cached display strings or presentation styles. */
export function importWorksheetRows(sheet: XLSX.WorkSheet): Record<string, unknown>[] {
  const dense = sheet["!data"] as XLSX.CellObject[][] | undefined;
  const actual = new Map<number, Map<number, XLSX.CellObject>>();
  const add = (r: number, c: number, cell: XLSX.CellObject) => {
    if (!populated(cell)) return;
    if (!actual.has(r)) actual.set(r, new Map());
    actual.get(r)!.set(c, cell);
  };
  if (dense) {
    for (const r of Object.keys(dense)) {
      const row = dense[Number(r)];
      if (row) for (const c of Object.keys(row)) add(Number(r), Number(c), row[Number(c)]!);
    }
  } else {
    for (const address of Object.keys(sheet)) {
      if (!/^[A-Z]+[1-9]\d*$/.test(address)) continue;
      const point = XLSX.utils.decode_cell(address);
      add(point.r, point.c, sheet[address] as XLSX.CellObject);
    }
  }
  const rowNumbers = [...actual.keys()].sort((a, b) => a - b);
  if (!rowNumbers.length) return [];
  const headerRow = rowNumbers[0]!;
  const headers = new Map<number, string>(), seen = new Map<string, string>();
  for (const [column, cell] of actual.get(headerRow)!) {
    const address = XLSX.utils.encode_cell({ r: headerRow, c: column });
    if (typeof cell.v !== "string" || cell.f) throw new Error(`Header ${address} must contain a column name.`);
    const key = headerKey(cell.v);
    if (key === IMPORT_SOURCE_ROW || key === "__proto__" || key === "constructor" || key === "prototype")
      throw new Error(`Header ${address} uses a reserved column name.`);
    if (seen.has(key)) throw new Error(`Duplicate column "${cell.v.trim()}" at ${seen.get(key)} and ${address}. Keep one column for each field.`);
    seen.set(key, address); headers.set(column, cell.v.trim());
  }
  const rows: Record<string, unknown>[] = [];
  for (const rowNumber of rowNumbers.slice(1)) {
    const row: Record<string, unknown> = {};
    for (const [column, name] of headers) row[name] = "";
    for (const [column, cell] of actual.get(rowNumber)!) {
      const address = XLSX.utils.encode_cell({ r: rowNumber, c: column });
      const name = headers.get(column);
      if (!name) throw new Error(`Cell ${address} contains data but its column has no header. Add the missing column name; values have not been shifted.`);
      if (cell.t === "e") throw new Error(`Cell ${address} (${name}) contains an Excel error. Correct it before importing.`);
      if (cell.f && cell.v == null) throw new Error(`Cell ${address} (${name}) has no calculated value. Recalculate and save the workbook in Excel before importing.`);
      const key = headerKey(name);
      if (["barcode", "sku", "code"].includes(key) && typeof cell.v === "number" &&
        (!Number.isSafeInteger(cell.v) || Math.abs(cell.v) >= 1e15))
        throw new Error(`Cell ${address} (${name}) is a numeric code that Excel may have rounded. Enter the original barcode or SKU as Text; missing digits cannot be recovered.`);
      if (numericFields.has(key) && typeof cell.v === "number" && /%/.test(String(cell.z ?? "").replace(/"[^"]*"|\\./g, "")))
        throw new Error(`Cell ${address} (${name}) uses percentage notation. Enter an explicit number (for example 6 for 6% tax) so the amount is not guessed.`);
      // XLSX does not evaluate formulas. A cached value is read as stored.
      row[name] = cell.v ?? "";
    }
    for (const group of aliases) {
      const supplied = Object.keys(row).filter(name => group.includes(headerKey(name)) && String(row[name] ?? "").trim() !== "");
      if (supplied.length > 1 && new Set(supplied.map(name => String(row[name]).trim())).size > 1)
        throw new Error(`Row ${rowNumber + 1} has different values in ${supplied.join(" / ")}. Keep one value for this field; no column has been chosen automatically.`);
    }
    // Keep existing simple-file records compatible while retaining true Excel
    // line numbers after leading/gap/style-only rows were skipped.
    if (rowNumber + 1 !== rows.length + 2) row[IMPORT_SOURCE_ROW] = rowNumber + 1;
    rows.push(row);
  }
  return rows;
}
