import { z } from "zod";
import { canonicalBranchId } from "./branch-id";
import { canonicalStockInstant } from "./stock-as-of";
import type { StockActivityRecord } from "./stock-activity-history";

export const STOCK_ACTIVITY_PAGE_SIZE = 50;
export const STOCK_ACTIVITY_PAGE_MAX = 100;

const instant = z.string().min(20).max(40).transform((value, context) => {
  try { return canonicalStockInstant(value); }
  catch {
    context.addIssue({ code: "custom", message: "An exact activity time is required." });
    return z.NEVER;
  }
});
const branch = z.string().min(1).max(128).refine(value => value.trim() === value && !/\p{Cc}/u.test(value))
  .transform(canonicalBranchId);
const uuid = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i).transform(value => value.toLowerCase());
const cursor = z.object({ occurredAt: instant, id: uuid }).strict();
export const stockActivityScopeSchema = z.object({
  branchId: branch,
  cutoff: instant,
});
const scope = stockActivityScopeSchema.extend({
  side: z.enum(["through-cutoff", "after-cutoff"]),
  productId: uuid.optional(),
});
export const stockActivityRequestSchema = scope.extend({
  cursor: cursor.optional(),
  limit: z.number().int().min(1).max(STOCK_ACTIVITY_PAGE_MAX).optional(),
}).strict().refine(request => !request.cursor || onActivitySide(request.cursor.occurredAt, request),
  "The activity cursor must be inside the selected stock interval.");

const boundedUnits = z.number().int().min(-2_147_483_648).max(2_147_483_647).nullable();
export const stockActivityRowSchema = cursor.extend({
  branchId: branch,
  productId: uuid,
  productName: z.string().max(300).optional(),
  kind: z.string().min(1).max(80),
  reference: z.string().max(240).nullable(),
  delta: boundedUnits,
  before: boundedUnits,
  after: boundedUnits,
}).strict();
const pageSchema = scope.extend({ rows: z.array(stockActivityRowSchema).max(STOCK_ACTIVITY_PAGE_MAX), next: cursor.nullable() }).strict();

export type StockActivityCursor = z.infer<typeof cursor>;
export type StockActivityRequest = z.infer<typeof stockActivityRequestSchema>;
export type StockActivityPage = z.infer<typeof pageSchema>;

function onActivitySide(occurredAt: string, { cutoff, side }: { cutoff: string; side: "through-cutoff" | "after-cutoff" }) {
  return side === "through-cutoff" ? occurredAt <= cutoff : occurredAt > cutoff;
}

export function compareActivityPosition(left: StockActivityCursor, right: StockActivityCursor) {
  if (left.occurredAt !== right.occurredAt) return left.occurredAt < right.occurredAt ? -1 : 1;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

export function checkedStockActivityPage(value: unknown, expected: StockActivityRequest): StockActivityPage {
  const request = stockActivityRequestSchema.parse(expected);
  const page = pageSchema.parse(value);
  const scopeKeys = ["branchId", "cutoff", "side", "productId"] as const;
  if (scopeKeys.some(key => page[key] !== request[key]) || page.rows.length > (request.limit ?? STOCK_ACTIVITY_PAGE_SIZE)) {
    throw new Error("The item activity belongs to a different stock report.");
  }
  let previous = request.cursor;
  for (const row of page.rows) {
    const difference = previous ? compareActivityPosition(row, previous) : null;
    if (row.branchId !== request.branchId || (request.productId && row.productId !== request.productId) ||
        !onActivitySide(row.occurredAt, request) || (difference !== null &&
        (request.side === "through-cutoff" ? difference >= 0 : difference <= 0))) {
      throw new Error("The item activity does not match the selected time and branch.");
    }
    previous = row;
  }
  if (page.next && (page.rows.length !== (request.limit ?? STOCK_ACTIVITY_PAGE_SIZE) || !previous ||
      compareActivityPosition(page.next, previous) !== 0)) {
    throw new Error("The item activity page could not be continued safely.");
  }
  return page;
}

export function makeStockActivityPage(request: StockActivityRequest, records: readonly StockActivityRecord[]): StockActivityPage {
  const limit = request.limit ?? STOCK_ACTIVITY_PAGE_SIZE;
  const { branchId, cutoff, side, productId } = request;
  const rows = records.slice(0, limit);
  const last = rows.at(-1);
  const next = records.length > limit && last ? { occurredAt: last.occurredAt, id: last.id } : null;
  return checkedStockActivityPage({ branchId, cutoff, side, ...(productId ? { productId } : {}), rows, next }, request);
}
