import { hostedFunction } from "./hosted-function-client";
import { addMissedBill as direct } from "./missed-bill.functions";
export const addMissedBill = hostedFunction("missed-bill.addMissedBill", direct);
