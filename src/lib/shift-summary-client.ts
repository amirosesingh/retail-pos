import { hostedFunction } from "./hosted-function-client";
import { publishCompleteShiftSummary as publishCompleteShiftSummaryDirect } from "./shift-summary.functions";
export const publishCompleteShiftSummary = hostedFunction("shift-summary.publishCompleteShiftSummary", publishCompleteShiftSummaryDirect);
