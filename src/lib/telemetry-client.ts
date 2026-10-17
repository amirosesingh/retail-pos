import { hostedFunction } from "./hosted-function-client";
import { clearTelemetryHistory as clearTelemetryHistoryDirect } from "./telemetry.functions";
export const clearTelemetryHistory = hostedFunction("telemetry.clearTelemetryHistory", clearTelemetryHistoryDirect);
