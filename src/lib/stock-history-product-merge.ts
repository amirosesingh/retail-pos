import { z } from "zod";
import type { Product } from "@/core/types/pos-types";

const uuid = z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
const branchId = z.string().min(1).max(128).refine(value => value.trim() === value && Array.from(value).every(character => {
  const code = character.charCodeAt(0);
  return code > 31 && code !== 127;
}));
const version = z.string().regex(/^[1-9]\d{0,9}$/).refine(value => Number(value) <= 2147483647);
const quantity = z.string().regex(/^(0|-?[1-9]\d{0,9})$/).refine(value => Number(value) >= -2147483648 && Number(value) <= 2147483647);
const sku = z.string().max(128).nullable();
const aliases = z.array(z.string().max(2000)).max(2000).nullable();
const identity = { version: z.literal(1), branchId };
const operation = {
  operationId: uuid,
  masterId: uuid,
  roster: z.array(z.object({ id: uuid, sku, rowVersion: version }).strict()).min(2).max(50),
};

function validRoster(value: { masterId: string; roster: readonly { id: string }[] }) {
  const ids = new Set(value.roster.map(row => row.id));
  return ids.has(value.masterId) && ids.size === value.roster.length;
}

export const stockHistoryProductMergeRequestSchema = z.object({ ...identity, ...operation }).strict().refine(validRoster);
export type StockHistoryProductMergeRequest = z.infer<typeof stockHistoryProductMergeRequestSchema>;
export const stockHistoryProductMergeRelaySchema = z.discriminatedUnion("action", [
  z.object({ ...identity, terminalId: uuid, action: z.literal("capability") }).strict(),
  z.object({ ...identity, ...operation, terminalId: uuid, action: z.literal("merge") }).strict(),
  z.object({ ...identity, ...operation, terminalId: uuid, action: z.literal("receipt") }).strict(),
]).refine(value => value.action === "capability" || validRoster(value));
export type StockHistoryProductMergeRelay = z.infer<typeof stockHistoryProductMergeRelaySchema>;

const heldReason = {
  PRODUCT_DELETE_UNVERIFIED: "we could not confirm this product is safe to remove",
  PRODUCT_HAS_SALES_HISTORY: "it appears on past sales",
  PRODUCT_HAS_PURCHASES: "it appears on purchase orders",
  PRODUCT_HAS_TRANSFERS: "it appears on branch transfers",
  PRODUCT_HAS_ADJUSTMENTS: "it appears in stock adjustments",
  PRODUCT_HAS_PROMOTIONS: "a promotion gives it away free",
  PRODUCT_HAS_ACTIVITY_HISTORY: "it has inventory activity history",
  PRODUCT_HAS_STRUCTURED_BARCODES: "it has individual barcode records",
  PRODUCT_STOCK_UNVERIFIED: "its stock could not be verified",
  PRODUCT_OTHER_BRANCH_STOCK: "it has stock in another branch",
  PRODUCT_OPEN_BOOKING: "it appears on an open booking",
  PRODUCT_HELD_TICKET: "it appears on a held ticket",
  PRODUCT_ALIAS_IN_USE: "another product uses one of its codes",
  PRODUCT_LINKED_RECORD: "other records still point at it",
} as const;

const receiptSchema = z.object({
  ok: z.literal(true), operationId: uuid, branchId,
  removed: z.array(z.object({ id: uuid, sku, name: z.string().max(1000), quantity, barcode: z.string().max(2000).nullable(), aliases }).strict()).max(49),
  held: z.array(z.object({ id: uuid, name: z.string().max(1000),
    code: z.enum(Object.keys(heldReason) as (keyof typeof heldReason)[]) }).strict()).max(49),
  master: z.object({ id: uuid, sku, quantity, stockTotal: quantity, rowVersion: version, aliases }).strict(),
}).strict();
export type StockHistoryProductMergeReceipt = z.infer<typeof receiptSchema>;
export const stockHistoryProductMergeCapabilitySchema = z.object({ ok: z.literal(true), enabled: z.boolean() }).strict();
export const stockHistoryProductMergeReceiptStatusSchema = z.object({ ok: z.literal(true), receipt: receiptSchema.nullable() }).strict();
export type StockHistoryProductMergeCapability = z.infer<typeof stockHistoryProductMergeCapabilitySchema>;
export type StockHistoryProductMergeFailure = { ok: false; code?: string; error?: string };

export function validateProductMergeReceipt(input: unknown, request: StockHistoryProductMergeRequest, allowRecoveredOperationId = false) {
  const receipt = receiptSchema.parse(input);
  if ((!allowRecoveredOperationId && receipt.operationId !== request.operationId) ||
      receipt.branchId !== request.branchId || receipt.master.id !== request.masterId)
    throw new Error("Product merge receipt has an unexpected scope");
  const expected = new Map(request.roster.map(row => [row.id, row]));
  const master = expected.get(request.masterId);
  if (!master || receipt.master.sku !== master.sku ||
      Number(receipt.master.rowVersion) !== Number(master.rowVersion) + (receipt.removed.length > 0 ? 1 : 0))
    throw new Error("Product merge receipt has an unexpected master revision");
  expected.delete(request.masterId);
  for (const product of receipt.removed) {
    const source = expected.get(product.id);
    if (!source || source.sku !== product.sku) throw new Error("Product merge receipt has an unexpected retirement");
    expected.delete(product.id);
  }
  for (const product of receipt.held) {
    if (!expected.delete(product.id)) throw new Error("Product merge receipt has an unexpected held product");
  }
  if (expected.size) throw new Error("Product merge receipt omits a product");
  return receipt;
}

export const explainHeldProduct = (product: StockHistoryProductMergeReceipt["held"][number]) =>
  ({ id: product.id, name: product.name, reason: heldReason[product.code] });

export function applyProductMergeReceipt(products: Product[], receipt: StockHistoryProductMergeReceipt) {
  const removed = new Set(receipt.removed.map(product => product.id));
  const changesQuantity = receipt.removed.reduce((sum, product) => sum + Number(product.quantity), 0) !== 0;
  return products.flatMap(product => {
    if (removed.has(product.id)) return [];
    if (product.id !== receipt.master.id || !receipt.removed.length ||
        Number(product.mergeRevision?.rowVersion ?? 0) > Number(receipt.master.rowVersion)) return [product];
    return [{ ...product,
      stockByStore: changesQuantity ? { ...product.stockByStore, [receipt.branchId]: Number(receipt.master.quantity) } : product.stockByStore,
      barcodes: receipt.master.aliases ?? [],
      mergeRevision: { sku: receipt.master.sku, rowVersion: receipt.master.rowVersion },
    }];
  });
}

export function productMergeRevision(rawSku: unknown, rawVersion: unknown) {
  const parsedSku = sku.safeParse(rawSku);
  const parsedVersion = version.safeParse(typeof rawVersion === "number" ? String(rawVersion) : rawVersion);
  return parsedSku.success && parsedVersion.success ? { sku: parsedSku.data, rowVersion: parsedVersion.data } : undefined;
}
