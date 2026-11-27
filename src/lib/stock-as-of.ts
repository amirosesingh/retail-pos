/**
 * Pure quantity calculation, not an authorization or history-completeness proof.
 * Only an authorized snapshot loader may supply baseline/coverage evidence.
 * Current product quantities and item-activity logs alone do not satisfy it.
 */
export type StockPair = { productId: string; locationId: string };
export type StockOpening = StockPair & { quantity: string };
export type StockMovement = StockPair & {
  movementId: string;
  quantityDelta: string;
  effectiveAt: string;
  /** Commit/arrival time at this report source; original device recording is separate. */
  recordedAt: string;
};
export type StockAsOfInput = {
  cutoff: string;
  timeZone: string;
  readAt: string;
  sourceRevision: string;
  /** Complete historical product/location scope, including archived products. */
  pairs: readonly StockPair[];
  baseline: { at: string; capturedAt: string; rows: readonly StockOpening[] };
  movements: readonly StockMovement[];
  /** Supplied by the trusted loader after all writers/pages/cohort watermarks are checked. */
  coverage: { status: "complete" | "incomplete" | "unknown"; from: string; through: string };
};
export type StockCoverageReason = "BEFORE_BASELINE" | "FUTURE_CUTOFF" | "MISSING_OPENING" |
  "INCOMPLETE_MOVEMENTS" | "COVERAGE_GAP" | "BASELINE_PREHISTORY_CHANGED";
export type StockAsOfResult = {
  status: "complete" | "incomplete" | "unsupported";
  reasons: StockCoverageReason[];
  cutoff: string;
  timeZone: string;
  readAt: string;
  sourceRevision: string;
  /** Reports intentionally restate when previously offline movements arrive. */
  restatable: true;
  includedMovements: number;
  lateMovements: number;
  rows: Array<StockPair & { quantity: string | null; negative: boolean | null }>;
};
const MAX_ROWS = 100_000;
const MAX_PAIRS = 20_000;
function fail(code = "STOCK_HISTORY_INVALID"): never {
  throw Object.assign(new Error("The stock history cannot be calculated from this evidence."), { code });
}
function identity(value: string): string {
  if (typeof value !== "string" || !value || value.length > 128 || value.trim() !== value) fail();
  return /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value) ? value.toLowerCase() : value;
}
const key = (row: StockPair) => JSON.stringify([identity(row.productId), identity(row.locationId)]);
function units(value: string): bigint {
  if (typeof value !== "string" || !/^-?(?:0|[1-9]\d{0,37})$/.test(value)) fail();
  return BigInt(value);
}
/** Exact absolute instant at SQL Server's 100ns precision, never Date-rounded fractions. */
export function stockInstant(value: string): bigint {
  if (typeof value !== "string") fail();
  const parts = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts || Number(parts[1]) < 1 || Number(parts[4]) > 23 || Number(parts[5]) > 59 || Number(parts[6]) > 59) fail();
  const date = `${parts[1]}-${parts[2]}-${parts[3]}T${parts[4]}:${parts[5]}:${parts[6]}.000Z`;
  const milliseconds = Date.parse(date);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== date) fail();
  let offset = 0n;
  if (parts[8] !== "Z") {
    const hours = Number(parts[8]!.slice(1, 3)), minutes = Number(parts[8]!.slice(4));
    if (hours > 14 || minutes > 59 || hours === 14 && minutes !== 0) fail();
    offset = BigInt(hours * 60 + minutes) * (parts[8]![0] === "-" ? -1n : 1n);
  }
  return BigInt(milliseconds) * 10_000n - offset * 600_000_000n + BigInt((parts[7] ?? "").padEnd(7, "0"));
}
export function canonicalStockInstant(value:string):string{
  const ticks=stockInstant(value);
  let seconds=ticks/10_000_000n,fraction=ticks%10_000_000n;
  if(fraction<0){seconds--;fraction+=10_000_000n;}
  const date=new Date(Number(seconds*1000n));
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,19).length!==19)fail();
  return `${date.toISOString().slice(0,19)}.${String(fraction).padStart(7,"0")}Z`;
}

/** A shift-close shortcut must preserve the actual absolute saved closing instant. */
export function stockCutoffAtShiftClose(shift: { storeId: string; status: string; closedAt: string | null }, locationId: string): string {
  if (identity(shift.storeId) !== identity(locationId)) fail("STOCK_HISTORY_SCOPE_FORBIDDEN");
  if (typeof shift.status !== "string" || !["closed", "completed"].includes(shift.status.toLowerCase()) || !shift.closedAt) fail();
  stockInstant(shift.closedAt);
  return shift.closedAt;
}

export function calculateStockAsOf(input: StockAsOfInput): StockAsOfResult {
  if (!Array.isArray(input.pairs) || !Array.isArray(input.baseline?.rows) || !Array.isArray(input.movements)) fail();
  if (input.pairs.length > MAX_PAIRS || input.baseline.rows.length > MAX_PAIRS || input.movements.length > MAX_ROWS) fail("STOCK_HISTORY_OVERSIZED");
  if (typeof input.sourceRevision !== "string" || !input.sourceRevision || input.sourceRevision.length > 128) fail();
  if (typeof input.timeZone !== "string" || input.timeZone.length > 100) fail();
  try { new Intl.DateTimeFormat("en", { timeZone: input.timeZone }).format(0); } catch { fail(); }
  const cutoff = stockInstant(input.cutoff), readAt = stockInstant(input.readAt);
  const baselineAt = stockInstant(input.baseline.at), capturedAt = stockInstant(input.baseline.capturedAt);
  if (capturedAt < baselineAt || readAt < capturedAt) fail();
  const from = stockInstant(input.coverage.from), through = stockInstant(input.coverage.through);
  if (from > through || through > readAt || !["complete", "incomplete", "unknown"].includes(input.coverage.status)) fail();
  const expected = new Map<string, StockPair>();
  for (const pair of input.pairs) {
    const id = key(pair);
    if (expected.has(id)) fail();
    expected.set(id, { productId: identity(pair.productId), locationId: identity(pair.locationId) });
  }
  const balances = new Map<string, bigint>();
  for (const row of input.baseline.rows) {
    const id = key(row);
    if (!expected.has(id)) fail("STOCK_HISTORY_SCOPE_FORBIDDEN");
    if (balances.has(id)) fail();
    balances.set(id, units(row.quantity));
  }
  const reasons = new Set<StockCoverageReason>();
  if (cutoff < baselineAt) reasons.add("BEFORE_BASELINE");
  if (cutoff > readAt) reasons.add("FUTURE_CUTOFF");
  if (balances.size !== expected.size) reasons.add("MISSING_OPENING");
  if (input.coverage.status !== "complete") reasons.add("INCOMPLETE_MOVEMENTS");
  if (from > baselineAt || through < cutoff) reasons.add("COVERAGE_GAP");
  const seen = new Map<string, string>();
  let includedMovements = 0, lateMovements = 0;
  for (const movement of input.movements) {
    const pair = key(movement), movementId = identity(movement.movementId);
    if (!expected.has(pair)) fail("STOCK_HISTORY_SCOPE_FORBIDDEN");
    const effective = stockInstant(movement.effectiveAt), recorded = stockInstant(movement.recordedAt), delta = units(movement.quantityDelta);
    if (recorded > readAt) fail();
    const fingerprint = JSON.stringify([pair, String(effective), String(recorded), String(delta)]);
    const prior = seen.get(movementId);
    if (prior !== undefined) {
      if (prior !== fingerprint) fail("STOCK_HISTORY_MOVEMENT_CONFLICT");
      continue;
    }
    seen.set(movementId, fingerprint);
    // A snapshot predating a newly arrived pre-baseline movement cannot prove
    // whether that physical change is already included. Rebase; do not guess.
    if (effective <= baselineAt && recorded > capturedAt) reasons.add("BASELINE_PREHISTORY_CHANGED");
    if (effective > baselineAt && effective <= cutoff) {
      includedMovements++;
      if (recorded > cutoff) lateMovements++;
      if (balances.has(pair)) {
        balances.set(pair, balances.get(pair)! + delta);
      }
    }
  }
  // Pages/arrays need not be in physical movement order. Exact bounded BigInt
  // accumulation permits cancellation without an order-dependent false error.
  // Inputs remain at most 38 digits and 100k rows; only final balances publish.
  for (const value of balances.values()) {
    if (String(value).replace("-", "").length > 38) fail("STOCK_HISTORY_OVERSIZED");
  }
  const status = reasons.has("BEFORE_BASELINE") || reasons.has("FUTURE_CUTOFF") ? "unsupported" : reasons.size ? "incomplete" : "complete";
  return {
    status, reasons: [...reasons], cutoff: input.cutoff, timeZone: input.timeZone,
    readAt: input.readAt, sourceRevision: input.sourceRevision, restatable: true,
    includedMovements, lateMovements,
    rows: [...expected].sort(([left], [right]) => left.localeCompare(right)).map(([id, pair]) => ({
      ...pair, quantity: status === "complete" ? String(balances.get(id)!) : null,
      negative: status === "complete" ? balances.get(id)! < 0n : null,
    })),
  };
}
