import { hostedFunction } from "./hosted-function-client";
import { correctClosedShift as correctClosedShiftDirect } from "./shift-corrections.functions";
export const correctClosedShift = hostedFunction("shift-corrections.correctClosedShift", correctClosedShiftDirect);
