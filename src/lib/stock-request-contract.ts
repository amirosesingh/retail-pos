// Only operational document/quantity fields cross the approval-state boundary.
import { sameRecordId } from "./sale-identity";
import { sameBranchId } from "./branch-id";
export const STOCK_REQUEST_HEAD_COLUMNS = "id,ref,kind,status,from_store_id,to_store_id,source_request_id,note,created_by,approved_by,approved_at,created_at,updated_at,dispatched_by,dispatched_at,received_by,received_at,verified_by,verified_at,posted_at,closed_at,fulfilment,rejected_reason,cancelled_reason,discrepancy_reason,transfer_scope,from_group_id,to_group_id";
export const STOCK_REQUEST_ITEM_COLUMNS = "id,transfer_id,product_id,quantity,quantity_approved,quantity_dispatched,quantity_received,quantity_verified";
export const STOCK_REQUEST_PAGE_SIZE = 200;
export type StockRequestApprovalState = {
  request: Record<string, unknown>; fulfilment: Record<string, unknown> | null;
  requestItems: Record<string, unknown>[]; fulfilmentItems: Record<string, unknown>[];
};
export function projectStockRequestRows(data: unknown, columns: string): Record<string, unknown>[] {
  if (!Array.isArray(data) || data.some(row => !row || typeof row !== "object" || Array.isArray(row)))
    throw new Error("The stock request response is incomplete.");
  return data.map(row => Object.fromEntries(columns.split(",").filter(key => key in row).map(key => [key, row[key]])));
}
export function completeStockRequestRows(data: unknown, count: unknown, columns: string, limit: number): Record<string, unknown>[] {
  const rows = projectStockRequestRows(data, columns);
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > limit || rows.length !== count)
    throw new Error("The stock request could not be read completely within its document limit.");
  return rows;
}
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function validateStockRequestHead(head: Record<string, unknown>, kind: "request" | "transfer"): void {
  if (!uuid(head.id) || head.kind !== kind || typeof head.status !== "string" ||
      ![head.from_store_id, head.to_store_id].every(value => typeof value === "string" && value.trim()))
    throw new Error("The stock request identity or branches are incomplete.");
}
export function checkedStockRequestApprovalState(value: unknown): StockRequestApprovalState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The stock request response is incomplete.");
  const raw = value as StockRequestApprovalState;
  const request = projectStockRequestRows([raw.request], STOCK_REQUEST_HEAD_COLUMNS)[0];
  const fulfilment = raw.fulfilment === null ? null : projectStockRequestRows([raw.fulfilment], STOCK_REQUEST_HEAD_COLUMNS)[0];
  validateStockRequestHead(request, "request");
  if (request.source_request_id !== null) throw new Error("The request relationship is incomplete.");
  if (fulfilment) {
    validateStockRequestHead(fulfilment, "transfer");
    if (!uuid(fulfilment.source_request_id) || !sameRecordId(fulfilment.source_request_id, String(request.id)) ||
        !sameBranchId(fulfilment.from_store_id, request.from_store_id) || !sameBranchId(fulfilment.to_store_id, request.to_store_id))
      throw new Error("The fulfilment relationship is inconsistent.");
  }
  const lines = (data: unknown, head: Record<string, unknown> | null) => {
    const rows = projectStockRequestRows(data, STOCK_REQUEST_ITEM_COLUMNS);
    if (!head && rows.length) throw new Error("The stock request line set is incomplete.");
    const seen = new Set<string>(), products = new Set<string>();
    for (const row of rows) {
      if (!uuid(row.id) || !uuid(row.transfer_id) || !sameRecordId(row.transfer_id, String(head?.id)) || !uuid(row.product_id) ||
          seen.has(row.id.toLowerCase()) || products.has(row.product_id.toLowerCase()) ||
          typeof row.quantity !== "number" || !Number.isInteger(row.quantity) || row.quantity < 0 ||
          ["quantity_approved", "quantity_dispatched", "quantity_received", "quantity_verified"].some(key => row[key] !== null &&
            (typeof row[key] !== "number" || !Number.isInteger(row[key]) || Number(row[key]) < 0)))
        throw new Error("The stock request quantities or line identities are incomplete.");
      seen.add(row.id.toLowerCase()); products.add(row.product_id.toLowerCase());
    }
    return rows;
  };
  return { request, fulfilment, requestItems: lines(raw.requestItems, request), fulfilmentItems: lines(raw.fulfilmentItems, fulfilment) };
}
export function stockRequestItemPage(data: unknown, count: unknown, previousCount: number | null, loaded: number): { rows: Record<string, unknown>[]; count: number } {
  const rows = projectStockRequestRows(data, STOCK_REQUEST_ITEM_COLUMNS);
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 ||
      previousCount !== null && previousCount !== count || rows.length > STOCK_REQUEST_PAGE_SIZE || loaded + rows.length > count ||
      !rows.length && loaded < count)
    throw new Error("The stock request line pages changed or are incomplete.");
  return { rows, count };
}
