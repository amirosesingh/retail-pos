export function r2(value: number): number;
export function lineDiscountTotal(line: {
  price: number;
  discount: number;
  discountType?: "amount" | "percent";
  qty?: number;
  couponDiscount?: number;
}): number;
