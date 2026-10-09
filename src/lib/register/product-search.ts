import type { Product } from "@/core/types/pos-types";
import { normaliseCode, productCodes } from "@/lib/product-lookup";

export type ProductSearchField = "all" | "barcode" | "name" | "category" | "code";

/** Search the entire supplied branch catalogue before the UI paginates it. */
export function searchSellingProducts(products: Product[], query: string, field: ProductSearchField = "all"): Product[] {
  const needle = normaliseCode(query);
  const ranked: { product: Product; rank: number }[] = [];
  for (const product of products) {
    if (product.archived) continue;
    const codes = productCodes(product);
    const name = normaliseCode(product.name);
    const category = [product.category, product.subCategory, product.group].filter(Boolean).join(" ").toLowerCase();
    const fields = field === "barcode" ? codes
      : field === "name" ? [name]
      : field === "category" ? [category]
      : field === "code" ? [normaliseCode(product.sku), product.id.toLowerCase()]
      : [name, ...codes, category, ...(product.variants ?? []).map(v => v.label?.toLowerCase() ?? "")];
    if (needle && !fields.join(" ").includes(needle)) continue;
    const exactCode = codes.includes(needle) && (field === "all" || field === "barcode" || field === "code");
    ranked.push({ product, rank: exactCode ? 0 : name === needle ? 1 : name.startsWith(needle) ? 2 : 3 });
  }
  return ranked.sort((a, b) => a.rank - b.rank).map(row => row.product);
}

/** Never choose an arbitrary item when a barcode/SKU has multiple owners. */
export function sellingCodeMatches(products: Product[], code: string): Product[] {
  const needle = normaliseCode(code);
  if (!needle) return [];
  return products.filter(product => !product.archived && productCodes(product).includes(needle));
}
