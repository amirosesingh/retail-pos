import { hostedFunction } from "./hosted-function-client";
import { reserveCloudStockReference as reserveCloudStockReferenceDirect } from "./stock-ref.functions";
export const reserveCloudStockReference = hostedFunction("stock-ref.reserveCloudStockReference", reserveCloudStockReferenceDirect);
