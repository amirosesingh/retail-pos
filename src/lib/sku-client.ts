import { hostedFunction } from "./hosted-function-client";
import { reserveSkuLease as reserveSkuLeaseDirect } from "./sku.functions";
export type { ReserveSkuLeaseResult } from "./sku.functions";
export const reserveSkuLease = hostedFunction("sku.reserveSkuLease", reserveSkuLeaseDirect);
