// With a 500-row page this keeps offset + limit inside the 5,000-row scan cap.
export const MAX_ACTIVITY_OFFSET = 4_500;
export const ACTIVITY_SOURCE_BATCH_SIZE = 500;
export const MAX_ACTIVITY_SOURCE_BATCHES = 10;

export const ACTIVITY_WINDOW_ERROR =
  "Too much activity matched this request. Narrow the filters or date range and try again.";

export function activityScanBudgetExhausted(input: {
  batchesRead: number;
  exhausted: boolean;
  sourceRowRemains?: boolean;
  visibleCount: number;
  target: number;
}) {
  return (
    !input.exhausted && input.sourceRowRemains !== false &&
    input.batchesRead >= MAX_ACTIVITY_SOURCE_BATCHES &&
    input.visibleCount < input.target
  );
}
