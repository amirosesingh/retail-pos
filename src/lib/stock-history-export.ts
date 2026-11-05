import type { StockHistoryPage, StockHistoryRequest } from "./stock-history-report";
import { checkedStockHistoryPage } from "./stock-history-validation";

export const STOCK_EXPORT_LIMIT = 20_000;
/** Re-read with export admission, retaining one cutoff and immutable source revision. */
export async function stockHistoryForExport(request: StockHistoryRequest,
  load: (request: StockHistoryRequest) => Promise<StockHistoryPage>, assertCurrent = () => {}) {
  const rows: StockHistoryPage["rows"] = [], seen = new Set<string>();
  let first: StockHistoryPage | null = null, after: string | null = null;
  do {
    assertCurrent();
    const page = checkedStockHistoryPage(await load({ ...request, after, sourceRevision: first?.sourceRevision ?? request.sourceRevision,
      limit: 500, export: true }), request.branchId);
    assertCurrent();
    if (page.status !== "complete") throw new Error("A complete verified stock report is required before export.");
    if (first && (page.sourceRevision !== first.sourceRevision || page.cutoff !== first.cutoff ||
      page.branchId !== first.branchId || page.timeZone !== first.timeZone || page.baselineAt !== first.baselineAt))
      throw new Error("Stock history changed during export. Refresh the report and try again.");
    first ??= page;
    for (const row of page.rows) {
      if (seen.has(row.productId.toLowerCase())) throw new Error("The export returned a repeated product. Refresh the report.");
      seen.add(row.productId.toLowerCase()); rows.push(row);
      if (rows.length > STOCK_EXPORT_LIMIT) throw new Error("This export exceeds 20,000 products. Use a smaller authorized location.");
    }
    if (page.next && page.next === after) throw new Error("The stock export did not advance.");
    after = page.next;
  } while (after);
  return { ...first!, rows, next: null };
}
export async function exportStockHistoryXlsx(page: StockHistoryPage, branchName: string, assertCurrent = () => {}) {
  if (page.status !== "complete") throw new Error("Only complete verified historical quantities can be exported.");
  const XLSX = await import("xlsx"), book = XLSX.utils.book_new();
  assertCurrent();
  const metadata = [
    ["Report", "Stock at selected time"], ["Location", branchName], ["Location ID", page.branchId],
    ["Cutoff (exact UTC)", page.cutoff], ["Business time zone", page.timeZone], ["Opening verified at", page.baselineAt ?? ""],
    ["Read at", page.readAt ?? ""], ["Source revision", page.sourceRevision ?? ""], ["Coverage", "Complete"],
    ["Meaning", "Original movement time; late offline uploads may restate this report. Quantities only."],
  ];
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(metadata), "Report details");
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(page.rows.map(row => ({
    Product: row.name, SKU: row.sku ?? "", Barcode: row.barcode ?? "", Quantity: row.quantity ?? "",
    "Negative stock": row.negative ? "Yes" : "No", "Product ID": row.productId, "Location ID": row.locationId,
  }))), "Stock at time");
  // Identifiers and exact decimal(38,0) quantities remain strings in the workbook.
  assertCurrent();
  XLSX.writeFile(book, `stock-at-time-${page.cutoff.slice(0, 10)}.xlsx`);
}
