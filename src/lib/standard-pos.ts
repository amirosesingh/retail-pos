import type { Product, Sale } from "@/core/types/pos-types";

/**
 * Small, deterministic empty-search shelf for Standard POS. It is derived from
 * recent branch sales instead of loading the whole catalogue into the UI.
 */
export function frequentRecentProducts(
  products: Product[],
  sales: Sale[],
  storeId: string,
  limit = 8,
): Product[] {
  if (limit <= 0) return [];
  const counts = new Map<string, { count: number; firstSeen: number }>();
  sales.slice(0, 100).forEach((sale, saleIndex) => {
    if (sale.storeId !== storeId) return;
    sale.lines.forEach((line) => {
      if (line.credit || line.qty <= 0) return;
      const previous = counts.get(line.productId);
      counts.set(line.productId, {
        count: (previous?.count ?? 0) + line.qty,
        firstSeen: previous?.firstSeen ?? saleIndex,
      });
    });
  });

  if (!counts.size) return [];
  const byId = new Map(
    products.filter((product) => !product.archived).map((product) => [product.id, product]),
  );
  return [...counts.entries()]
    .sort(([, a], [, b]) => b.count - a.count || a.firstSeen - b.firstSeen)
    .map(([id]) => byId.get(id))
    .filter((product): product is Product => Boolean(product))
    .slice(0, limit);
}
