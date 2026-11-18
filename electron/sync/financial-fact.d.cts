export type FinancialFact = {
  id:string;branchId:string;shiftId:string;totalAmount:string|null;discountAmount:string|null;
  paymentType:string|null|['excluded'];payments:unknown;isRefunded:boolean;
};
export function financialFact(row:unknown):FinancialFact;
