import { hostedFunction } from "./hosted-function-client";
import { loadPostedSaleForCorrection as loadPostedSaleForCorrectionDirect, correctPostedSale as correctPostedSaleDirect } from "./sale-corrections.functions";
export const loadPostedSaleForCorrection = hostedFunction("sale-corrections.loadPostedSaleForCorrection", loadPostedSaleForCorrectionDirect);
export const correctPostedSale = hostedFunction("sale-corrections.correctPostedSale", correctPostedSaleDirect);
