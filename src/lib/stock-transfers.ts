/**
 * Branch-to-branch stock transfers, stored in the cloud database.
 *
 * A move inside one cluster ("intra-group") simply shifts quantity between
 * two branch buckets of the same catalogue row. A move across clusters
 * ("inter-group") also re-maps the item into the receiving group's catalogue,
 * which the database does atomically when the note is received.
 */
import type { Store, Transfer, TransferItem, TransferKind, TransferStatus } from "@/core/types/pos-types";
import { commitOps, stableChildId } from "@/core/api/pos-db";
import { routedQuery } from "@/core/api/db-query";
import { describeError } from "./notify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticatedExternalClientSnapshot, supabaseExternal } from "@/integrations/supabase/external-client";
import { isTerminalApp } from "@/platform-config/platform";
import { relayOp, relayTransferRequestApprovalState } from "@/core/api/sync-relay";
import { sessionEpoch } from "./session-epoch";
import { effectiveDatabaseMode } from "@/core/local-db/db-mode";
import { localDb } from "@/core/local-db/local-db";
import { recordId, sameRecordId } from "./sale-identity";
import { sameBranchId } from "./branch-id";
import { dispatchFailure, mayReconcileDispatch, readDispatchProof, type DispatchExpected, type DispatchProof } from "./transfer-dispatch-result";
import { STOCK_REQUEST_HEAD_COLUMNS, STOCK_REQUEST_ITEM_COLUMNS, STOCK_REQUEST_PAGE_SIZE, checkedStockRequestApprovalState, completeStockRequestRows, projectStockRequestRows, stockRequestItemPage, type StockRequestApprovalState } from "./stock-request-contract";

const sb = supabaseExternal as unknown as SupabaseClient;

type Row = Record<string, any>;

export type TransferScope = "INTRA_GROUP" | "INTER_GROUP";

/** Imported quantities use the same whole, nonnegative unit contract as submission. */
export const normalizeTransferQuantity = (value: unknown): number =>
  Math.max(0, Math.floor(Number(value) || 0));

export const groupOf = (store: Store | undefined) => store?.groupId?.trim() || "default";

/** Same cluster or across clusters? Drives the warning banner and the tabs. */
export function scopeBetween(from: Store | undefined, to: Store | undefined): TransferScope {
  return groupOf(from) === groupOf(to) ? "INTRA_GROUP" : "INTER_GROUP";
}

/**
 * Database status names, including the older spellings a till upgraded
 * mid-week may still be holding. "in_transit" was an old name for dispatched.
 */
const toStatus = (s: string): TransferStatus =>
  s === "draft"
    ? "draft"
    : s === "approved"
      ? "approved"
      : s === "in_transit" || s === "dispatched"
        ? "dispatched"
        : s === "received"
          ? "received"
          : s === "completed" || s === "verified"
            ? "completed"
            : s === "completed_with_discrepancy"
              ? "completed_with_discrepancy"
              : s === "rejected"
                ? "rejected"
                : s === "cancelled"
                  ? "cancelled"
                  : "awaiting_approval";

const fromStatus = (s: TransferStatus): string => s;

const num = (v: unknown): number | undefined =>
  v === null || v === undefined ? undefined : Number(v) || 0;

export type StoredTransfer = Transfer & {
  scope: TransferScope;
  fromGroupId: string;
  toGroupId: string;
};

const rowToTransfer = (r: Row, items: Row[]): StoredTransfer => ({
  id: r.id,
  ref: r.ref,
  kind: (r.kind as TransferKind) ?? "transfer",
  fromStoreId: r.from_store_id,
  toStoreId: r.to_store_id,
  items: items.map((i) => ({
    productId: i.product_id,
    qty: Number(i.quantity) || 0,
    approvedQty: num(i.quantity_approved),
    dispatchedQty: num(i.quantity_dispatched),
    receivedQty: num(i.quantity_received),
    verifiedQty: num(i.quantity_verified),
  })),
  status: toStatus(r.status),
  note: r.note ?? "",
  createdBy: r.created_by ?? "",
  approvedBy: r.approved_by ?? undefined,
  approvedAt: r.approved_at ?? undefined,
  dispatchedBy: r.dispatched_by ?? undefined,
  dispatchedAt: r.dispatched_at ?? undefined,
  receivedBy: r.received_by ?? undefined,
  receivedAt: r.received_at ?? undefined,
  verifiedBy: r.verified_by ?? undefined,
  verifiedAt: r.verified_at ?? undefined,
  postedAt: r.posted_at ?? undefined,
  discrepancyReason: r.discrepancy_reason ?? undefined,
  rejectedReason: r.rejected_reason ?? undefined,
  cancelledReason: r.cancelled_reason ?? undefined,
  sourceRequestId: r.source_request_id ?? undefined,
  closedAt: r.closed_at ?? undefined,
  fulfilment: (() => {
    if (r.fulfilment && typeof r.fulfilment === "object") return r.fulfilment;
    if (typeof r.fulfilment !== "string" || !r.fulfilment.trim()) return undefined;
    if (["full", "partial", "none"].includes(r.fulfilment)) return r.fulfilment;
    try {
      const legacy = JSON.parse(r.fulfilment);
      return ["full", "partial", "none"].includes(legacy) ? legacy : undefined;
    } catch {
      return undefined;
    }
  })(),
  createdAt: r.created_at,
  updatedAt: r.updated_at ?? r.created_at,
  scope: (r.transfer_scope as TransferScope) ?? "INTRA_GROUP",
  fromGroupId: r.from_group_id ?? "default",
  toGroupId: r.to_group_id ?? "default",
});

/** Load all requested lines without an unbounded query or a silent 2,000-row cut-off. */
async function loadTransferLines(ids: string[]): Promise<Row[]> {
  if (!ids.length) return [];
  const pageSize = 1000;
  const rows: Row[] = [];
  // Keep both the SQL parameter list and the PostgREST URL bounded.
  for (let start = 0; start < ids.length; start += 300) {
    // Three bounded groups hide network latency without flooding a phone's
    // connection. Each group still reads every page and fails as a whole.
    const groups = [0, 100, 200].map(offset => ids.slice(start + offset, start + offset + 100)).filter(batch => batch.length);
    const results = await Promise.all(groups.map(async batch => {
      const lines: Row[] = [];
      for (let offset = 0; ; offset += pageSize) {
        const page = (await routedQuery("stock_transfer_items", {
          in: { column: "transfer_id", values: batch },
          orderBy: { column: "id", ascending: true },
          offset,
          limit: pageSize,
        })) as Row[];
        lines.push(...page);
        if (page.length < pageSize) break;
      }
      return lines;
    }));
    rows.push(...results.flat());
  }
  return rows;
}

/** Every note this branch raised or is due to receive. */
export async function loadTransfers(): Promise<StoredTransfer[]> {
  const rows: Row[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const page = await routedQuery("stock_transfers", {
      orderBy: { column: "created_at", ascending: false }, offset, limit: pageSize,
    }) as Row[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  if (!rows.length) return [];

  const lines = await loadTransferLines(rows.map((r) => r.id));
  const byTransfer = new Map<string, Row[]>();
  for (const line of lines) {
    const list = byTransfer.get(String(line.transfer_id)) ?? [];
    list.push(line);
    byTransfer.set(String(line.transfer_id), list);
  }
  return rows.map((row) => rowToTransfer(row, byTransfer.get(String(row.id)) ?? []));
}

/** One note by id, for a deep link into a page the till has not cached. */
export async function loadTransfer(id: string, options: { throwOnError?: boolean } = {}): Promise<StoredTransfer | null> {
  try {
    const row = (await routedQuery("stock_transfers", { match: { id }, limit: 1 }) as Row[])[0] ?? null;
    if (!row) return null;
    const lines = await loadTransferLines([id]);
    return rowToTransfer(row, lines);
  } catch (error) {
    if (options.throwOnError) throw error;
    if (import.meta.env.DEV) console.error("[transfers] detail load failed");
    return null;
  }
}

/** Approval is online: local SQL/cache absence cannot disprove a cloud legacy child. */
export async function loadRequestApprovalState(requestId: string): Promise<{ request: StoredTransfer; fulfilment: StoredTransfer | null }> {
  let state: StockRequestApprovalState;
  if (isTerminalApp()) {
    const result = await relayTransferRequestApprovalState(recordId(requestId));
    if (!result.ok) throw new Error("The central stock request could not be verified.");
    state = checkedStockRequestApprovalState(result.row);
    // A queued local child is denial evidence, never authority to declare a
    // remote child absent. Keep it intact until its upload is reconciled.
    if (effectiveDatabaseMode() === "local") {
      if (!localDb()?.query) throw new Error("Local fulfilment synchronization could not be checked.");
      const pending = await routedQuery("stock_transfers", {
        columns: "id,kind,source_request_id,from_store_id,to_store_id",
        match: { source_request_id: recordId(requestId) }, limit: 2,
      }) as Row[];
      if (pending.length > 1 || pending.some(row => !state.fulfilment || !sameRecordId(String(row.id), String(state.fulfilment.id)) ||
          row.kind !== "transfer" || !sameRecordId(String(row.source_request_id), requestId) ||
          !sameBranchId(row.from_store_id, state.request.from_store_id) || !sameBranchId(row.to_store_id, state.request.to_store_id)))
        throw new Error("A local fulfilment is still pending central synchronization.");
    }
  } else {
    const central = await authenticatedExternalClientSnapshot();
    if (!central) throw new Error("A verified central staff session is required.");
    const requestResult = await central.from("stock_transfers").select(STOCK_REQUEST_HEAD_COLUMNS).eq("id", recordId(requestId)).limit(1);
    if (requestResult.error) throw new Error("The central stock request could not be read.");
    const request = projectStockRequestRows(requestResult.data, STOCK_REQUEST_HEAD_COLUMNS)[0];
    if (!request) throw new Error("The stock request is no longer available.");
    const childResult = await central.from("stock_transfers").select(STOCK_REQUEST_HEAD_COLUMNS, { count: "exact" }).eq("source_request_id", recordId(requestId)).limit(2);
    if (childResult.error) throw new Error("The saved fulfilment could not be read.");
    const fulfilment = completeStockRequestRows(childResult.data, childResult.count, STOCK_REQUEST_HEAD_COLUMNS, 1)[0] ?? null;
    const lines = async (id: unknown) => {
      const rows: Row[] = []; let total: number | null = null;
      do {
        const result = await central.from("stock_transfer_items").select(STOCK_REQUEST_ITEM_COLUMNS, { count: "exact" }).eq("transfer_id", String(id)).order("id").range(rows.length, rows.length + STOCK_REQUEST_PAGE_SIZE - 1);
        if (result.error) throw new Error("The stock request lines could not be read.");
        const page = stockRequestItemPage(result.data, result.count, total, rows.length);
        rows.push(...page.rows); total = page.count;
      } while (rows.length < total);
      return rows;
    };
    const [requestItems, fulfilmentItems] = await Promise.all([lines(request.id), fulfilment ? lines(fulfilment.id) : Promise.resolve([])]);
    state = checkedStockRequestApprovalState({ request, fulfilment, requestItems, fulfilmentItems });
  }
  if (!sameRecordId(String(state.request.id), requestId)) throw new Error("The stock request identity changed.");
  return { request: rowToTransfer(state.request, state.requestItems), fulfilment: state.fulfilment ? rowToTransfer(state.fulfilment, state.fulfilmentItems) : null };
}

export type SaveTransferInput = {
  transfer: Transfer;
  from: Store | undefined;
  to: Store | undefined;
  products: { id: string; name: string; barcode?: string; sku?: string; cost?: number }[];
  /** Number of lines in the draft being replaced, so removed rows are deleted. */
  previousLineCount?: number;
};

/**
 * Write the note and its lines through the durable gate, so a transfer raised
 * with no connection is stored on the till and pushed up later.
 */
export async function saveTransfer({
  transfer,
  from,
  to,
  products,
  previousLineCount = 0,
}: SaveTransferInput) {
  const head = {
    id: transfer.id,
    ref: transfer.ref,
    kind: transfer.kind,
    transfer_scope: scopeBetween(from, to),
    from_store_id: transfer.fromStoreId,
    from_store_name: from?.name ?? null,
    from_group_id: groupOf(from),
    to_store_id: transfer.toStoreId,
    to_store_name: to?.name ?? null,
    to_group_id: groupOf(to),
    status: fromStatus(transfer.status),
    source_request_id: transfer.sourceRequestId ?? null,
    note: transfer.note ?? "",
    created_by: transfer.createdBy || null,
    approved_by: transfer.approvedBy ?? null,
    approved_at: transfer.approvedAt ?? null,
    created_at: transfer.createdAt,
    updated_at: transfer.updatedAt,
  };
  const lines = transfer.items.map((i: TransferItem, index) => {
    const p = products.find((x) => x.id === i.productId);
    return {
      id: stableChildId(transfer.id, "6", index),
      transfer_id: transfer.id,
      product_id: i.productId,
      barcode: p?.barcode ?? null,
      sku: p?.sku ?? null,
      product_name: p?.name ?? null,
      quantity: i.qty,
      quantity_approved: i.approvedQty ?? null,
      quantity_dispatched: i.dispatchedQty ?? null,
      unit_cost: p?.cost ?? 0,
    };
  });
  const removedLineIds = Array.from(
    { length: Math.max(0, previousLineCount - lines.length) },
    (_, offset) => stableChildId(transfer.id, "6", lines.length + offset),
  );
  return commitOps("Saving transfer", [
    { kind: "upsert", table: "stock_transfers", rows: [head] },
    ...(lines.length
      ? [{ kind: "upsert" as const, table: "stock_transfer_items", rows: lines }]
      : []),
    ...removedLineIds.map((id) => ({
      kind: "delete" as const,
      table: "stock_transfer_items",
      match: { id, transfer_id: transfer.id },
    })),
  ]);
}

/**
 * Reject or cancel. Both need a reason, and the database refuses the write
 * without one, so the caller must have collected it already.
 */
export async function setTransferStatus(
  id: string,
  status: TransferStatus,
  who: string,
  reason?: string,
) {
  const patch: Row = { status: fromStatus(status) };
  if (status === "rejected") {
    patch.rejected_reason = reason ?? null;
    patch.rejected_by = who;
  }
  if (status === "cancelled") patch.cancelled_reason = reason ?? null;
  return commitOps("Updating transfer", [
    { kind: "update", table: "stock_transfers", values: patch, match: { id } },
  ]);
}

/**
 * Close a request once the transfer raised against it has been sent. The
 * request keeps its original quantities; only its status and fulfilment
 * figure change, so "requested 8 / fulfilled 5" stays readable forever.
 */
export async function closeRequestInDb(
  id: string,
  fulfilment: NonNullable<Transfer["fulfilment"]>,
) {
  return commitOps("Closing request", [
    {
      kind: "update",
      table: "stock_transfers",
      values: { status: "completed", fulfilment, closed_at: new Date().toISOString() },
      match: { id },
    },
  ]);
}

/** Quantities the approver or sender typed, keyed the way the RPCs expect. */
export type LineQty = { productId: string; qty: number };
const toLines = (lines: LineQty[] | undefined) =>
  lines?.length ? lines.map((l) => ({ product_id: l.productId, qty: Math.max(0, l.qty) })) : null;

export type RpcResult = { success: boolean; error?: string; code?: string; dispatch?: DispatchProof };

async function runTransferRpc(
  fn:
    | "stock_transfer_approve"
    | "stock_transfer_dispatch"
    | "stock_transfer_dispatch_atomic"
    | "stock_transfer_receive"
    | "stock_transfer_verify",
  args: Record<string, unknown>,
): Promise<RpcResult & { data?: unknown; status?: number }> {
  if (isTerminalApp()) {
    const result = await relayOp({ kind: "rpc", table: "stock_transfers", fn, args });
    return result.ok ? { success: true, data: result.data } : { success: false, error: result.error, code: result.code, status: result.status };
  }
  const result = await sb.rpc(fn, args as never);
  if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code, status: result.status });
  return { success: true, data: result.data };
}

/**
 * Approve: the database checks the note is still waiting, records the allowed
 * quantity per line, and stamps who said yes.
 */
export async function approveTransferInDb(
  id: string,
  who: string,
  lines?: LineQty[],
): Promise<RpcResult> {
  try {
    return await runTransferRpc("stock_transfer_approve", {
      p_transfer_id: id,
      p_approved_by: who,
      p_lines: toLines(lines),
    });
  } catch (e) {
    return { success: false, error: describeError(e, "Approving the transfer") };
  }
}

/**
 * Dispatch: stock leaves the sending branch here, in one database transaction,
 * and the note closes against whatever was actually sent.
 */
export async function dispatchTransferInDb(
  id: string,
  who: string,
  lines: LineQty[],
  expected: DispatchExpected,
): Promise<RpcResult> {
  const epoch = sessionEpoch();
  if (!expected || !sameRecordId(id, expected.id) || !Array.isArray(lines) || !lines.length ||
      Array.from(lines).some(line => !line || typeof line.productId !== "string" || !line.productId.trim() || !Number.isSafeInteger(line.qty) || line.qty < 0) ||
      new Set(lines.map(line => recordId(line.productId))).size !== lines.length)
    return dispatchFailure({ code: "TRANSFER_DISPATCH_CONFLICT" });
  const requested = lines.map(line => ({ productId: line.productId, qty: line.qty }));
  const args = { p_transfer_id: id, p_dispatched_by: who, p_lines: toLines(requested) };
  for (let attempt = 0; attempt < 2; attempt++) {
    if (sessionEpoch() !== epoch) return dispatchFailure({ code: "SESSION_CHANGED" });
    try {
      // This versioned endpoint closes a validated linked request atomically.
      // An older void RPC is never a safe fallback after an upgrade failure.
      const result = await runTransferRpc("stock_transfer_dispatch_atomic", args);
      if (!result.success) throw Object.assign(new Error(result.error), { code: result.code, status: result.status });
      if (sessionEpoch() !== epoch) return dispatchFailure({ code: "SESSION_CHANGED" });
      const proof = readDispatchProof(result.data, expected, requested);
      return proof ? { success: true, dispatch: proof } : dispatchFailure({ code: "TRANSFER_DISPATCH_UNCONFIRMED" });
    } catch (error) {
      if (sessionEpoch() !== epoch) return dispatchFailure({ code: "SESSION_CHANGED" });
      // The exact same request reads the locked committed dispatch on replay;
      // the upgraded routine never deducts stock a second time. Definite SQL
      // denials and unavailable upgrades are not retried.
      if (attempt === 0 && sessionEpoch() === epoch && mayReconcileDispatch(error)) continue;
      return dispatchFailure(error);
    }
  }
  return dispatchFailure({ code: "TRANSFER_DISPATCH_UNCONFIRMED" });
}

/**
 * Arrival only. The box is here; nothing has been counted and no stock has
 * moved onto the destination shelf yet.
 *
 * Never throws: a failure leaves the note untouched and reports why.
 */
export async function receiveTransferInDb(
  id: string,
  who: string,
  lines?: LineQty[],
): Promise<RpcResult> {
  try {
    return await runTransferRpc("stock_transfer_receive", {
      p_transfer_id: id,
      p_received_by: who,
      p_lines: toLines(lines),
    });
  } catch (e) {
    return { success: false, error: describeError(e, "Receiving the transfer") };
  }
}

/**
 * Physical verification — the only step that puts stock on the destination
 * shelf. The database locks the note, refuses anything already posted, credits
 * the counted quantity and writes the movement, all in one transaction, so a
 * double-click or a retry can never add the delivery twice.
 */
export async function verifyTransferInDb(
  id: string,
  who: string,
  lines: LineQty[],
  reason?: string,
): Promise<RpcResult> {
  try {
    return await runTransferRpc("stock_transfer_verify", {
      p_transfer_id: id,
      p_verified_by: who,
      p_lines: toLines(lines),
      p_reason: reason?.trim() || null,
    });
  } catch (e) {
    return { success: false, error: describeError(e, "Verifying the delivery") };
  }
}
