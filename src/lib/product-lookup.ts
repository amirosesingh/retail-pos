/**
 * One place that answers "which product is this code?".
 *
 * A delivery can arrive with a different barcode for an item we already
 * stock, so every product carries a list of alias barcodes alongside its
 * primary one. Scanning any of them — or the SKU — resolves to the same
 * product.
 */
import type { Product } from "@/core/types/pos-types";
import { dbProxy } from "@/core/api/db-router";

export const normaliseCode = (code: string) => code.trim().toLowerCase();

/** Every code that resolves to this product. */
export const productCodes = (p: Product) =>
  [p.barcode, p.sku, ...(p.barcodes ?? []), ...(p.variants ?? []).map((v) => v.code)]
    .filter(Boolean)
    .map(normaliseCode);

export function resolveByBarcode(products: Product[], code: string): Product | undefined {
  const needle = normaliseCode(code);
  if (!needle) return undefined;
  return products.find((p) => productCodes(p).includes(needle));
}

/** True when the code is already used by another product. */
export function codeTakenBy(products: Product[], code: string, exceptId?: string) {
  const needle = normaliseCode(code);
  return products.find((p) => p.id !== exceptId && productCodes(p).includes(needle));
}

/**
 * Duplicate guard for barcode / SKU entry. Returns a ready-to-show message
 * when the code is blank or already lives on another catalogue record.
 */
export function checkCodeAvailable(
  products: Product[],
  code: string,
  exceptId?: string,
): string | null {
  const trimmed = code.trim();
  if (!trimmed) return "Enter a barcode";
  const clash = codeTakenBy(products, trimmed, exceptId);
  return clash
    ? `${trimmed} already belongs to ${clash.name} (${clash.sku || clash.barcode})`
    : null;
}

export type DuplicateProductCode = {
  code: string;
  products: Pick<Product, "id" | "name" | "sku" | "barcode">[];
};

/** Audit every SKU and barcode shape, including aliases and variants. */
export function findDuplicateProductCodes(products: Product[]): DuplicateProductCode[] {
  const owners = new Map<string, Map<string, Product>>();
  for (const product of products) {
    for (const code of new Set(productCodes(product))) {
      if (!code) continue;
      const byProduct = owners.get(code) ?? new Map<string, Product>();
      byProduct.set(product.id, product);
      owners.set(code, byProduct);
    }
  }
  return [...owners.entries()]
    .filter(([, entries]) => entries.size > 1)
    .map(([code, entries]) => ({ code, products: [...entries.values()] }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Validate all codes on one edited item before any write is attempted. */
export function productCodeProblems(products: Product[], draft: Product): string[] {
  const raw = [
    draft.sku,
    draft.barcode,
    ...(draft.barcodes ?? []),
    ...(draft.variants ?? []).map((variant) => variant.code),
  ]
    .map((code) => code.trim())
    .filter(Boolean);
  const duplicateWithin = raw.find(
    (code, index) =>
      raw.findIndex((other) => normaliseCode(other) === normaliseCode(code)) !== index,
  );
  const problems = duplicateWithin ? [`${duplicateWithin} is repeated on this product.`] : [];
  for (const code of new Set(raw.map(normaliseCode))) {
    const clash = codeTakenBy(products, code, draft.id);
    if (clash)
      problems.push(`${code} already belongs to ${clash.name} (${clash.sku || clash.barcode}).`);
  }
  return problems;
}

/** Products that look like the scanned item, for the "already exists?" hint. */
export function suggestSimilar(products: Product[], name: string, limit = 5): Product[] {
  const needle = name.trim().toLowerCase();
  if (needle.length < 3) return [];
  return products
    .filter((p) => p.name.toLowerCase().includes(needle) || needle.includes(p.name.toLowerCase()))
    .slice(0, limit);
}

/**
 * Ask the database which product owns a code, using the indexed barcode
 * table. Used when the scanned code is not in the catalogue this till has
 * loaded — a very large catalogue is never held in memory in full.
 */
export async function resolveByBarcodeIndexed(code: string): Promise<string | null> {
  const needle = code.trim();
  if (!needle) return null;
  try {
    const rows = await dbProxy.query("product_barcodes", {
      columns: "product_id",
      match: { barcode: needle },
      limit: 1,
    });
    const hit = rows[0] as { product_id?: string } | undefined;
    return hit?.product_id ?? null;
  } catch {
    return null;
  }
}

/** Every barcode row this product should own in the indexed lookup table. */
export const barcodeRowsFor = (p: Product) =>
  [
    { code: p.barcode, label: "Primary", primary: true, pack: 1 },
    ...(p.barcodes ?? []).map((c) => ({ code: c, label: "Alias", primary: false, pack: 1 })),
    ...(p.variants ?? []).map((v) => ({
      code: v.code,
      label: v.label ?? null,
      primary: false,
      pack: 1,
    })),
  ]
    .filter((r) => !!r.code?.trim())
    .map((r) => ({
      product_id: p.id,
      barcode: r.code.trim(),
      label: r.label,
      pack_size: r.pack,
      is_primary: r.primary,
    }));
