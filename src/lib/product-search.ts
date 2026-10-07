/**
 * Catalogue search for stock paperwork.
 *
 * The transfer and receiving screens must work in a shop that carries tens of
 * thousands of items, so they never scan the whole catalogue in the browser.
 * This asks the database for a small, indexed, capped result set instead, and
 * falls back to whatever the till already holds locally when the query cannot
 * be answered (offline, relay down, local-first desktop).
 */
import { supabaseExternal as supabase } from "@/integrations/supabase/external-client";
import { rowToProduct } from "@/core/api/pos-db";
import type { Product } from "@/core/types/pos-types";
import { normaliseCode, productCodes } from "@/lib/product-lookup";

export type CatalogSearch = {
  products: Product[];
  /** True when the rows came from the database rather than local state. */
  remote: boolean;
};

/** PostgREST `or=` needs commas and parentheses out of the way. */
const escape = (term: string) => term.replace(/[(),*]/g, " ").trim();

/** Match a term against everything a user might type or scan. */
export function matchesTerm(product: Product, needle: string): boolean {
  const n = needle.trim().toLowerCase();
  if (!n) return true;
  const fields = [
    product.name,
    product.barcode,
    product.sku,
    product.category,
    product.subCategory,
    product.group,
    ...(product.barcodes ?? []),
    ...(product.variants ?? []).map((v) => v?.code),
  ];
  return fields.some((v) => (v ? String(v).toLowerCase().includes(n) : false));
}

/** Local filter used as the offline fallback and for exact-scan resolution. */
export function searchLocal(products: Product[], term: string, limit = 25): Product[] {
  const needle = term.trim().toLowerCase();
  const pool = needle ? products.filter((p) => matchesTerm(p, needle)) : products;
  return pool.slice(0, limit);
}

/** An exact code hit — what a barcode scanner should add without a click. */
export function exactCodeMatch(products: Product[], code: string): Product | undefined {
  const c = code.trim().toLowerCase();
  if (!c) return undefined;
  return products.find(
    (p) =>
      p.barcode?.toLowerCase() === c ||
      p.sku?.toLowerCase() === c ||
      (p.barcodes ?? []).some((b) => String(b ?? "").toLowerCase() === c) ||
      (p.variants ?? []).some((v) => String(v?.code ?? "").toLowerCase() === c),
  );
}

/**
 * Indexed, capped catalogue query. Never throws: a failed query simply means
 * the caller keeps using its local list.
 */
export async function searchCatalog(
  term: string,
  fallback: Product[],
  limit = 25,
): Promise<CatalogSearch> {
  const needle = escape(term);
  if (!needle) return { products: fallback.slice(0, limit), remote: false };
  try {
    const like = `%${needle}%`;
    const res = await supabase
      .from("products")
      .select("*")
      .is("deleted_at", null)
      .or(
        [
          `name.ilike.${like}`,
          `barcode.ilike.${like}`,
          `sku.ilike.${like}`,
          `category.ilike.${like}`,
        ].join(","),
      )
      .order("name")
      .limit(limit);
    if (res.error || !res.data) return { products: searchLocal(fallback, term, limit), remote: false };
    const rows = res.data.map((r) => rowToProduct(r as Record<string, unknown>));
    // A scanned alias barcode lives in a JSON column, so top the result up
    // from local state when the indexed columns found nothing.
    if (!rows.length) return { products: searchLocal(fallback, term, limit), remote: false };
    return { products: rows.filter((p) => !p.archived), remote: true };
  } catch {
    return { products: searchLocal(fallback, term, limit), remote: false };
  }
}

/**
 * Resolve all codes from an import against SQL in bounded requests. This is
 * the final authoritative lookup before new products are staged, and avoids
 * assuming that a very large catalogue is fully resident in browser memory.
 */
export async function lookupProductsByCodes(
  codes: string[],
  fallback: Product[],
  options: { chunkSize?: number; allowLocalFallback?: boolean } = {},
): Promise<Product[]> {
  const chunkSize = options.chunkSize ?? 500;
  const wanted = [...new Set(codes.map(normaliseCode).filter(Boolean))];
  if (!wanted.length) return [];

  const localByCode = new Map<string, Product>();
  for (const product of fallback) {
    for (const code of productCodes(product)) {
      if (!localByCode.has(code)) localByCode.set(code, product);
    }
  }
  const found = new Map<string, Product>();
  const groups: string[][] = [];
  const rpc = supabase as unknown as {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
  };
  for (let offset = 0; offset < wanted.length; offset += chunkSize) {
    groups.push(wanted.slice(offset, offset + chunkSize));
  }

  // Four requests keep a large import moving without flooding PostgREST.
  for (let offset = 0; offset < groups.length; offset += 4) {
    const settled = await Promise.allSettled(
      groups.slice(offset, offset + 4).map((group) =>
        rpc.rpc("product_lookup_batch", { p_codes: group }),
      ),
    );
    settled.forEach((result, index) => {
      const group = groups[offset + index] ?? [];
      if (result.status === "fulfilled" && !result.value.error && result.value.data) {
        for (const raw of result.value.data as Record<string, unknown>[]) {
          const product = rowToProduct(raw);
          found.set(product.id, product);
        }
      } else {
        if (!options.allowLocalFallback) {
          const reason =
            result.status === "rejected"
              ? String(result.reason ?? "request failed")
              : result.value.error?.message || "request failed";
          throw new Error(`Could not verify the import against the product database: ${reason}`);
        }
        for (const code of group) {
          const product = localByCode.get(code);
          if (product) found.set(product.id, product);
        }
      }
    });
  }
  return [...found.values()];
}
