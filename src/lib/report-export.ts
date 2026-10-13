import type { WorkSheet } from "xlsx";

/** Preserve identifiers as text and amounts as numbers in Excel. */
export async function reportWorksheet(rows: (string | number)[][]): Promise<WorkSheet> {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const headers = rows[0] ?? [];
  sheet["!cols"] = headers.map((header, index) => ({
    wch: Math.min(
      48,
      Math.max(
        14,
        String(header).length + 2,
        ...rows.slice(1, 201).map((row) => String(row[index] ?? "").length + 2),
      ),
    ),
  }));
  if (sheet["!ref"]) sheet["!autofilter"] = { ref: sheet["!ref"] };
  headers.forEach((header, column) => {
    if (
      !/amount|revenue|profit|total|subtotal|discount|tax|price|cost|collected|refund|cash|card|credit|balance|value/i.test(
        String(header),
      )
    )
      return;
    for (let row = 1; row < rows.length; row++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
      if (cell?.t === "n") cell.z = "#,##0.00";
    }
  });
  return sheet;
}

export async function exportReportWorkbook(name: string, rows: (string | number)[][]) {
  const XLSX = await import("xlsx");
  const sheet = await reportWorksheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Report");
  const day = new Date().toLocaleDateString("en-CA");
  XLSX.writeFile(book, `${name}-${day}.xlsx`, { compression: true });
}
