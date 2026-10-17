import { hostedFunction } from "./hosted-function-client";
import { recordStatusHistory as recordStatusHistoryDirect, loadStatusHistory as loadStatusHistoryDirect } from "./status-history.functions";
export const recordStatusHistory = hostedFunction("status-history.recordStatusHistory", recordStatusHistoryDirect);
export const loadStatusHistory = hostedFunction("status-history.loadStatusHistory", loadStatusHistoryDirect);
