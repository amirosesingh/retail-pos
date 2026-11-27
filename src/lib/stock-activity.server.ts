import { z } from "zod";
import { canonicalBranchId } from "./branch-id";
import type { CallerProof } from "./privileged-caller.server";
import { canonicalStockInstant } from "./stock-as-of";
import type { StockActivityRecord } from "./stock-activity-history";
import { authorizeStockHistoryRead } from "./stock-history.server";
import {
  compareActivityPosition, makeStockActivityPage, stockActivityRequestSchema, STOCK_ACTIVITY_PAGE_SIZE,
  type StockActivityPage, type StockActivityRequest,
} from "./stock-activity-query";

const commonColumns = "id,product_id,product_name,store_id,created_at";
const units = z.number().int().min(-2_147_483_648).max(2_147_483_647).nullish();
const uuid = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
const rowShape = {
  id: uuid, product_id: uuid, product_name: z.string().nullable(), store_id: z.string(), created_at: z.string(),
};
const standardRow = z.object({ ...rowShape, activity_type: z.string().min(1).max(80), reference: z.string().nullable(),
  quantity_delta: units, stock_before: units, stock_after: units,
}).strict();
const adjustmentRow = z.object({ ...rowShape, delta: units, previous_stock: units, updated_stock: units }).strict();

export async function readBoundedActivity(response: Response, maxBytes = 512 * 1024): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The company database returned an empty item activity response.");
  const decoder = new TextDecoder();
  let total = 0, text = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) return JSON.parse(text + decoder.decode()) as unknown;
      total += part.value.byteLength;
      if (total > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new Error("The company database returned an oversized item activity page.");
      }
      text += decoder.decode(part.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

function commonRow(row: z.infer<z.ZodObject<typeof rowShape>>) {
  return {
    id: row.id.toLowerCase(), productId: row.product_id.toLowerCase(), branchId: canonicalBranchId(row.store_id),
    occurredAt: canonicalStockInstant(row.created_at),
    ...(row.product_name ? { productName: row.product_name.slice(0, 300) } : {}),
  };
}

// PostgreSQL retains microseconds. Floor rather than round the selected SQL
// Server 100ns cutoff so events exactly on the next tick stay on the later side.
export const hostedActivityInstant = (value: string) => `${value.slice(0, -2)}Z`;

function scopedQuery(request: StockActivityRequest, branchId: string, columns: string) {
  const through = request.side === "through-cutoff";
  const order = through ? "desc" : "asc";
  const params = new URLSearchParams({
    select: `${commonColumns},${columns}`,
    store_id: `eq.${branchId}`,
    created_at: `${through ? "lte" : "gt"}.${hostedActivityInstant(request.cutoff)}`,
    product_id: request.productId ? `eq.${request.productId}` : "not.is.null",
    order: `created_at.${order},id.${order}`,
    limit: String((request.limit ?? STOCK_ACTIVITY_PAGE_SIZE) + 1),
  });
  if (request.cursor) {
    const when = hostedActivityInstant(request.cursor.occurredAt);
    // A local cursor can carry a seventh fractional digit. Provider equality
    // at its floored microsecond cannot be used for the key comparison then.
    if (request.cursor.occurredAt.at(-2) !== "0") {
      params.append("created_at", `${through ? "lte" : "gt"}.${when}`);
    } else {
      const compare = through ? "lt" : "gt";
      params.set("or", `(created_at.${compare}.${when},and(created_at.eq.${when},id.${compare}.${request.cursor.id}))`);
    }
  }
  return params.toString();
}

function mergeRecords(activity: StockActivityRecord[], adjustments: StockActivityRecord[], request: StockActivityRequest) {
  const sign = request.side === "through-cutoff" ? -1 : 1;
  const records = new Map<string, StockActivityRecord>();
  for (const record of [...activity, ...adjustments]) {
    if (record.branchId !== request.branchId || (request.productId && record.productId !== request.productId) ||
        (sign < 0 ? record.occurredAt > request.cutoff : record.occurredAt <= request.cutoff) ||
        (request.cursor && sign * compareActivityPosition(record, request.cursor) <= 0)) {
      throw new Error("The item activity does not match the selected time and branch.");
    }
    const previous = records.get(record.id);
    if (!previous) {
      records.set(record.id, record);
      continue;
    }
    if (previous.kind !== "adjustment" || record.kind !== "adjustment" || previous.branchId !== record.branchId ||
        previous.productId !== record.productId || previous.occurredAt !== record.occurredAt || previous.delta !== record.delta ||
        (previous.before !== null && record.before !== null && previous.before !== record.before) ||
        (previous.after !== null && record.after !== null && previous.after !== record.after)) {
      throw new Error("The item activity contains conflicting records.");
    }
    records.set(record.id, { ...record, ...previous, reference: previous.reference ?? record.reference,
      before: previous.before ?? record.before, after: previous.after ?? record.after });
  }
  return [...records.values()].sort((a, b) => sign * compareActivityPosition(a, b));
}

export function readStockActivityRecords(
  rawActivity: unknown, rawAdjustments: unknown, perSourceLimit: number, request: StockActivityRequest,
  options?: { contiguousThroughCutoff: true },
): StockActivityRecord[] {
  const activity = z.array(standardRow).max(perSourceLimit).parse(rawActivity).map((row): StockActivityRecord => ({
    ...commonRow(row), kind: row.activity_type, reference: row.reference?.slice(0, 240) ?? null,
    delta: row.quantity_delta ?? null, before: row.stock_before ?? null, after: row.stock_after ?? null,
  }));
  const adjustments = z.array(adjustmentRow).max(perSourceLimit).parse(rawAdjustments).map((row): StockActivityRecord => ({
    ...commonRow(row), kind: "adjustment", reference: null,
    delta: row.delta ?? null, before: row.previous_stock ?? null, after: row.updated_stock ?? null,
  }));
  const records = mergeRecords(activity, adjustments, request);
  if (!options?.contiguousThroughCutoff || request.side !== "through-cutoff") return records;

  // A full source may have omitted older rows, including other rows at its
  // oldest timestamp. Only the newer suffix is contiguous across both sources.
  let boundary = "";
  for (const source of [activity, adjustments]) {
    if (source.length !== perSourceLimit) continue;
    const oldest = source.reduce((at, row) => row.occurredAt < at ? row.occurredAt : at, request.cutoff);
    if (oldest > boundary) boundary = oldest;
  }
  return records.filter(row => row.occurredAt > boundary);
}

/** Read-only inventory evidence. The report's verified balances remain independent. */
export async function readStockActivityPage(proof: CallerProof, value: StockActivityRequest): Promise<StockActivityPage> {
  const request = stockActivityRequestSchema.parse(value);
  const { scope, branchId } = await authorizeStockHistoryRead(proof, request);
  const { serviceRest } = await import("@/core/api/pos-relay.server");
  const scopedBranch = scope.storeId ?? branchId;
  const [activity, adjustments] = await Promise.all([
    serviceRest(`item_activity_logs?${scopedQuery(request, scopedBranch, "activity_type,reference,quantity_delta,stock_before,stock_after")}`),
    serviceRest(`stock_adjustments?${scopedQuery(request, scopedBranch, "delta,previous_stock,updated_stock")}`),
  ]);
  if (activity.status === 401 || activity.status === 403 || adjustments.status === 401 || adjustments.status === 403) {
    throw new Error("The company database refused access to item activity.");
  }
  if (!activity.ok || !adjustments.ok) throw new Error("The company database could not read item activity. Try again shortly.");
  const pageMax = (request.limit ?? STOCK_ACTIVITY_PAGE_SIZE) + 1;
  const [rawActivity, rawAdjustments] = await Promise.all([readBoundedActivity(activity), readBoundedActivity(adjustments)]);
  return makeStockActivityPage(request, readStockActivityRecords(rawActivity, rawAdjustments, pageMax, request));
}
