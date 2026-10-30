import { hostedFunction } from "./hosted-function-client";
import { addMissedBill as direct, listMissedBillCashiers as listDirect } from "./missed-bill.functions";
export const addMissedBill = hostedFunction("missed-bill.addMissedBill", direct);
export const listMissedBillCashiers = hostedFunction("missed-bill.listMissedBillCashiers", listDirect);
