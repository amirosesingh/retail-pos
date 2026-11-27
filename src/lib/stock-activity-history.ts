import { canonicalStockInstant } from "./stock-as-of";

export type StockActivityRecord = {
  id: string;
  productId: string;
  productName?: string;
  branchId: string;
  kind: string;
  reference: string | null;
  occurredAt: string;
  delta: number | null;
  before: number | null;
  after: number | null;
};

export type StockActivityMovement = StockActivityRecord & { position: "through-cutoff" | "after-cutoff" };
export type RecordedStockBalance = { quantity: number; supportedAt: string };

type CutoffOptions = {
  branchId: string;
  productId: string;
  cutoff: string;
  /** Exhausted earlier pages, or a contiguous newest suffix with an exclusive boundary. */
  throughCoverage?: "all" | { after: string };
  /** Later rows start at the cutoff rather than at a later page. */
  nearestAfterLoaded?: boolean;
};

function sameRecordedActivity(left: StockActivityRecord, right: StockActivityRecord) {
  return left.occurredAt === right.occurredAt && left.kind === right.kind && left.reference === right.reference &&
    left.delta === right.delta && left.before === right.before && left.after === right.after;
}

function readTime(value: string): string | null {
  try { return canonicalStockInstant(value); }
  catch { return null; }
}

function readBalance(row: StockActivityRecord, previous: RecordedStockBalance | null): RecordedStockBalance | null {
  if ([row.before, row.after, row.delta].some(value => value !== null && !Number.isSafeInteger(value))) return null;
  if (previous && row.before !== null && row.before !== previous.quantity) return null;
  const before = row.before ?? previous?.quantity ?? null;
  const calculated = before !== null && row.delta !== null ? before + row.delta : null;
  if (calculated !== null && (!Number.isSafeInteger(calculated) || row.after !== null && row.after !== calculated)) return null;
  const quantity = row.after ?? calculated;
  return quantity === null ? null : { quantity, supportedAt: row.occurredAt };
}

/** Interpret an authorized activity read as recorded evidence only. Verified
 * balances and completeness across stock writers belong to the stock ledger. */
export function stockActivityAtCutoff(records: readonly StockActivityRecord[], options: CutoffOptions): {
  balance: RecordedStockBalance | null;
  movements: StockActivityMovement[];
} {
  const cutoff = readTime(options.cutoff);
  if (cutoff === null) return { balance: null, movements: [] };

  const unique = new Map<string, StockActivityRecord>();
  const conflicting = new Set<string>();
  let invalidTime = false;
  for (const row of records) {
    if (row.branchId !== options.branchId || row.productId !== options.productId) continue;
    const occurredAt = readTime(row.occurredAt);
    if (occurredAt === null) {
      invalidTime = true;
      continue;
    }
    const activity = { ...row, occurredAt };
    const existing = unique.get(row.id);
    if (!existing) unique.set(row.id, activity);
    else if (!sameRecordedActivity(existing, activity)) conflicting.add(row.id);
  }

  const ordered = [...unique.values()].sort((left, right) => {
    if (left.occurredAt !== right.occurredAt) return left.occurredAt < right.occurredAt ? -1 : 1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
  const movements: StockActivityMovement[] = ordered.filter(row => !conflicting.has(row.id)).map(row => ({
    ...row, position: row.occurredAt <= cutoff ? "through-cutoff" : "after-cutoff",
  }));
  const coverage = options.throughCoverage;
  if (!coverage || invalidTime || conflicting.size) return { balance: null, movements };
  const exclusiveBoundary = coverage === "all" ? null : readTime(coverage.after);
  if (coverage !== "all" && (exclusiveBoundary === null || exclusiveBoundary >= cutoff)) return { balance: null, movements };

  const earlier = ordered.filter(row => row.occurredAt <= cutoff && (!exclusiveBoundary || row.occurredAt > exclusiveBoundary));
  let balance: RecordedStockBalance | null = null;
  for (let index = 0; index < earlier.length; index++) {
    const row = earlier[index]!;
    // IDs give stable display order, but a tied timestamp cannot prove write order.
    const tied = row.occurredAt === earlier[index - 1]?.occurredAt || row.occurredAt === earlier[index + 1]?.occurredAt;
    balance = tied ? null : readBalance(row, balance);
  }

  if (balance && balance.supportedAt !== cutoff && options.nearestAfterLoaded) {
    const nextIndex = ordered.findIndex(row => row.occurredAt > cutoff);
    const next = ordered[nextIndex];
    if (next && (next.occurredAt === ordered[nextIndex + 1]?.occurredAt ||
      next.before !== null && next.before !== balance.quantity)) balance = null;
  }
  return { balance, movements };
}
