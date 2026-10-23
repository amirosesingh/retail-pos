/**
 * Excel export for the catalogue — same column names the bulk importer
 * accepts, so an exported sheet can be edited and imported straight back.
 */
import type { Product, Store } from "@/core/types/pos-types";

export type ProductExportScope = "all" | "active" | "active-in-stock" | "archived";

export function productsForExport(products: Product[], scope: ProductExportScope, storeId: string): Product[] {
  return products.filter((product) => {
    if (scope === "all") return true;
    if (scope === "archived") return product.archived === true;
    if (product.archived === true) return false;
    return scope === "active" || (product.stockByStore?.[storeId] ?? 0) > 0;
  });
}

export async function exportProductsXlsx(
  products: Product[],
  stores: Store[],
  fileName = "products",
  includeCost = true,
) {
  const XLSX = await import("xlsx");
  const rows = products.map((p) => {
    const row: Record<string, string | number> = {
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      barcode_aliases: (p.barcodes ?? []).join("|"),
      category: p.category,
      sub_category: p.subCategory ?? "",
      unit: p.unit ?? "",
      price: p.price,
      ecom_price: p.ecomPrice ?? "",
      tax_rate: p.taxRate,
      reorder_level: p.reorderLevel,
      custom_points: p.customPoints ?? "",
    };
    if (includeCost) row.cost = p.cost;
    for (const s of stores) row[`stock_${s.code}`] = p.stockByStore?.[s.id] ?? 0;
    return row;
  });

  const sheet = XLSX.utils.json_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Products");
  XLSX.writeFile(book, `${fileName}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
