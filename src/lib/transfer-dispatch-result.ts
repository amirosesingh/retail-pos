import type { Product, Transfer } from "@/core/types/pos-types";
import { canonicalBranchId, canonicalStockMap, sameBranchId } from "./branch-id";
import { sameRecordId } from "./sale-identity";
import { applyZeroStockLifecycle } from "./product-lifecycle";

type Fulfilment = "full" | "partial" | "none";
export type DispatchExpected = Pick<Transfer, "id" | "fromStoreId" | "toStoreId" | "sourceRequestId">;
export type DispatchProof = {
  version: 1; transfer_id: string; from_store_id: string; to_store_id: string;
  status: "dispatched" | "received" | "verified" | "completed" | "completed_with_discrepancy";
  dispatched_at: string; dispatched_by: string | null; source_request_id: string | null; request_closed: boolean; request_closed_at: string | null;
  fulfilment: Fulfilment; request_fulfilment: Fulfilment | null; replayed: boolean;
  lines: { product_id: string; qty: number; source_stock: number }[];
};
const fulfilment = (value: unknown): value is Fulfilment => ["full", "partial", "none"].includes(String(value));

/** A response is evidence only for the exact transfer, branches and quantities submitted. */
export function readDispatchProof(value: unknown, expected: DispatchExpected, lines: { productId: string; qty: number }[]): DispatchProof | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const proof = value as DispatchProof;
  if (proof.version !== 1 || typeof proof.transfer_id !== "string" || !sameRecordId(proof.transfer_id, expected.id) ||
      typeof proof.from_store_id !== "string" || typeof proof.to_store_id !== "string" ||
      !sameBranchId(proof.from_store_id, expected.fromStoreId) || !sameBranchId(proof.to_store_id, expected.toStoreId) ||
      !["dispatched", "received", "verified", "completed", "completed_with_discrepancy"].includes(proof.status) ||
      typeof proof.dispatched_at !== "string" || !Number.isFinite(Date.parse(proof.dispatched_at)) ||
      (proof.dispatched_by !== null && typeof proof.dispatched_by !== "string") ||
      !fulfilment(proof.fulfilment) || typeof proof.replayed !== "boolean" ||
      (expected.sourceRequestId ? typeof proof.source_request_id !== "string" || !sameRecordId(proof.source_request_id, expected.sourceRequestId) : proof.source_request_id !== null) ||
      proof.request_closed !== Boolean(expected.sourceRequestId) ||
      (expected.sourceRequestId ? !fulfilment(proof.request_fulfilment) : proof.request_fulfilment !== null) ||
      (expected.sourceRequestId ? typeof proof.request_closed_at !== "string" || !Number.isFinite(Date.parse(proof.request_closed_at)) : proof.request_closed_at !== null) ||
      !Array.isArray(proof.lines) || proof.lines.length !== lines.length) return null;
  const seen = new Set<string>();
  for (const line of proof.lines) {
    if (!line || typeof line.product_id !== "string" || seen.has(line.product_id.toLowerCase()) ||
        !Number.isInteger(line.qty) || line.qty < 0 || typeof line.source_stock !== "number" || !Number.isFinite(line.source_stock)) return null;
    seen.add(line.product_id.toLowerCase());
    if (!lines.some(wanted => sameRecordId(wanted.productId, line.product_id) && wanted.qty === line.qty)) return null;
  }
  // Explicit projection drops every extra field, including any unexpected stock map.
  return { version: 1, transfer_id: proof.transfer_id, from_store_id: proof.from_store_id, to_store_id: proof.to_store_id,
    status: proof.status, dispatched_at: proof.dispatched_at, dispatched_by: proof.dispatched_by, source_request_id: proof.source_request_id ?? null,
    request_closed: proof.request_closed, fulfilment: proof.fulfilment, request_fulfilment: proof.request_fulfilment,
    request_closed_at: proof.request_closed_at,
    replayed: proof.replayed, lines: proof.lines.map(line => ({ product_id: line.product_id, qty: line.qty, source_stock: line.source_stock })) };
}

type DispatchError = { code?: unknown; message?: unknown; error?: unknown; status?: unknown; name?: unknown };
function fields(error: unknown): DispatchError {
  const value = error && typeof error === "object" ? error as DispatchError : { message: error };
  const message = value.message ?? value.error;
  if (typeof message === "string" && message.startsWith("{")) {
    try { const nested = JSON.parse(message); if (nested && typeof nested === "object") return { ...value, code: value.code ?? nested.code, message: nested.message }; } catch { /* Unrecognized text remains private. */ }
  }
  return { ...value, message };
}
export function mayReconcileDispatch(error: unknown): boolean {
  const value = fields(error); const code = String(value.code ?? ""); const message = String(value.message ?? "");
  if (/^[0-9A-Z]{5}$/.test(code) || /^(TRANSFER_|PERMISSION_|STORE_|SESSION_)/.test(code)) return false;
  const status = Number(value.status);
  return status >= 500 || [408, 504].includes(status) ||
    ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "TimeoutError", "AbortError"].includes(code || String(value.name ?? "")) ||
    /failed to fetch|network(?:error| request| error)|connection.*(?:lost|reset)|timed? ?out|load failed/i.test(message);
}
/** Whitelisted operational guidance; never expose SQL, product names or arbitrary backend text. */
export function dispatchFailure(error: unknown): { success: false; code: string; error: string } {
  const value = fields(error); const code = String(value.code ?? ""); const message = String(value.message ?? "");
  if (code === "TRANSFER_INSUFFICIENT_STOCK" || code === "23514" && /^Short by [\d.]+ of .+ at the sending (?:branch|warehouse)$/i.test(message))
    return { success: false, code: "TRANSFER_INSUFFICIENT_STOCK", error: "Not enough stock is available at the sending location. Receive or count the stock there, or reduce the dispatch quantity. No stock was dispatched." };
  if (["TRANSFER_REQUEST_INVALID", "TRANSFER_DISPATCH_CONFLICT"].includes(message) || ["TRANSFER_REQUEST_INVALID", "TRANSFER_DISPATCH_CONFLICT"].includes(code))
    return { success: false, code: message.startsWith("TRANSFER_") ? message : code, error: "The transfer or its linked request has changed. Refresh both records and review the approved quantities before retrying." };
  if (["PGRST202", "42883", "TABLE_FORBIDDEN", "TRANSFER_DISPATCH_UPGRADE_REQUIRED"].includes(code))
    return { success: false, code: "TRANSFER_DISPATCH_UPGRADE_REQUIRED", error: "The transfer dispatch database upgrade is required. Ask an administrator to install it before dispatching; this app will not use the older incomplete workflow." };
  if (["42501", "PERMISSION_DENIED", "STORE_FORBIDDEN", "SCOPE_MISSING"].includes(code) || Number(value.status) === 403)
    return { success: false, code: "PERMISSION_DENIED", error: "You do not have permission to dispatch this transfer from its sending location. Ask an administrator to review your access." };
  if (code === "SESSION_CHANGED" || code === "SESSION_INVALID" || Number(value.status) === 401)
    return { success: false, code: "SESSION_CHANGED", error: "The signed-in session changed. Refresh the transfer before continuing." };
  return { success: false, code: "TRANSFER_DISPATCH_UNCONFIRMED", error: "Dispatch could not be confirmed. Refresh this transfer and check synchronization before retrying; do not create a replacement transfer." };
}

/** Apply absolute source-root quantities once; retain any product replaced by a newer refresh. */
export function reconcileDispatchProducts(products: Product[], baseline: Product[], proof: DispatchProof, lifecycle: boolean): Product[] {
  return products.map(product => {
    const line = proof.lines.find(row => sameRecordId(row.product_id, product.id));
    if (!line || baseline.find(row => sameRecordId(row.id, product.id)) !== product) return product;
    return applyZeroStockLifecycle({ ...product, stockByStore: { ...canonicalStockMap(product.stockByStore), [canonicalBranchId(proof.from_store_id)]: line.source_stock } }, lifecycle);
  });
}
