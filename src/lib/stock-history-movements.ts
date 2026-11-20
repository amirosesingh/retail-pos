import { z } from "zod";
import { canonicalStockInstant } from "./stock-as-of";

export const STOCK_MOVEMENT_PAGE_SIZE = 50;
export const STOCK_MOVEMENT_PAGE_MAX = 100;

const exactInstant = z.string().min(20).max(40).transform((value, context) => {
  try {
    return canonicalStockInstant(value);
  } catch {
    context.addIssue({ code: "custom", message: "An exact stock movement time is required." });
    return z.NEVER;
  }
});
const branchId = z.string().min(1).max(128).refine(value => value.trim() === value);
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const timeZone = z.string().min(1).max(100).refine(value => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
});
const cursor = z.object({ effectiveAt: exactInstant, id: uuid }).strict();
const scope = z.object({
  branchId,
  productId: uuid,
  cutoff: exactInstant,
  timeZone,
  sourceRevision: z.string().min(1).max(512).refine(value => value.trim().length > 0),
  periodStart: exactInstant.optional(),
  closedShiftId: uuid.optional(),
});

export const stockHistoryMovementRequestSchema = scope.extend({
  after: cursor.nullable().optional(),
  limit: z.number().int().min(1).max(STOCK_MOVEMENT_PAGE_MAX).optional(),
}).strict().refine(request => (!request.periodStart || request.periodStart <= request.cutoff) &&
  (!request.after || request.after.effectiveAt <= request.cutoff && (!request.periodStart || request.after.effectiveAt >= request.periodStart)),
  "The movement cursor must be inside the selected stock interval.");

const movement = cursor.extend({
  recordedAt: exactInstant,
  kind: z.enum(["sale", "refund", "receiving", "stock", "product", "transfer", "sponsorship", "missed_bill", "general"]),
  delta: z.string().regex(/^-?[1-9]\d{0,37}$/),
}).strict();
const responseSchema = scope.extend({
  status: z.enum(["complete", "incomplete", "unavailable"]),
  reasons: z.array(z.string().min(1).max(80)).max(20),
  baselineAt: exactInstant.nullable().optional(),
  coverage: z.object({
    acceptedLedger: z.enum(["complete", "incomplete"]),
    writers: z.enum(["confirmed", "pending", "unknown"]),
    balanceGrade: z.enum(["verified", "recorded_provisional"]),
    timeGrade: z.enum(["recorded", "author_entered", "mixed"]),
  }).strict().optional(),
  rows: z.array(movement).max(STOCK_MOVEMENT_PAGE_MAX),
  next: cursor.nullable(),
}).strict();

export type StockHistoryMovementRequest = z.infer<typeof stockHistoryMovementRequestSchema>;
export type StockHistoryMovementPage = z.infer<typeof responseSchema>;
export type StockHistoryMovementCursor = z.infer<typeof cursor>;

function follows(row: StockHistoryMovementCursor, prior: StockHistoryMovementCursor) {
  return row.effectiveAt > prior.effectiveAt || row.effectiveAt === prior.effectiveAt && row.id > prior.id;
}

/** Verify that a provider response belongs to the exact authorized report. */
export function checkedStockHistoryMovementPage(input: unknown, expected: StockHistoryMovementRequest): StockHistoryMovementPage {
  const request = stockHistoryMovementRequestSchema.parse(expected);
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 65_536) {
    throw new Error("The stock movement page exceeds its safe response limit.");
  }
  const page = responseSchema.parse(input);
  const keys = ["branchId", "productId", "cutoff", "timeZone", "sourceRevision", "periodStart", "closedShiftId"] as const;
  if (keys.some(key => page[key] !== request[key])) {
    throw new Error("The movements belong to a different report. Refresh the stock report before continuing.");
  }
  if (page.status !== "complete") {
    if (page.rows.length || page.next) throw new Error("Unverified stock movement details cannot be displayed.");
    return page;
  }
  const { baselineAt, coverage } = page;
  if (!baselineAt || baselineAt > page.cutoff || (page.periodStart && baselineAt >= page.periodStart) || page.reasons.length ||
    (coverage && (coverage.acceptedLedger !== "complete" || coverage.writers !== "confirmed" || coverage.balanceGrade !== "verified"))) {
    throw new Error("The stock movement page did not prove complete historical coverage.");
  }
  if (page.rows.length > (request.limit ?? STOCK_MOVEMENT_PAGE_SIZE)) {
    throw new Error("The stock movement page exceeded its requested size.");
  }
  if (request.after && request.after.effectiveAt <= baselineAt) {
    throw new Error("The stock movement cursor is earlier than the verified opening.");
  }
  let prior = request.after ?? null;
  const ids = new Set<string>();
  for (const row of page.rows) {
    if (ids.has(row.id) || row.id === request.after?.id || (prior && !follows(row, prior)) ||
      row.effectiveAt <= baselineAt || (page.periodStart && row.effectiveAt < page.periodStart) ||
      row.effectiveAt > page.cutoff || row.recordedAt < row.effectiveAt) {
      throw new Error("The movements do not follow the selected report time and page order.");
    }
    ids.add(row.id);
    prior = row;
  }
  if (page.next && (!prior || !page.rows.length || page.next.id !== prior.id || page.next.effectiveAt !== prior.effectiveAt)) {
    throw new Error("The stock movement cursor could not be verified.");
  }
  return page;
}
