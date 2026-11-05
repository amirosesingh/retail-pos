/** Existing checkout arithmetic, shared verbatim with native bill verification. */
export const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export const lineDiscountTotal = (l) => {
  const qty = Math.abs(l.qty ?? 1);
  const gross = Math.abs(l.price) * qty;
  const coupon = Math.min(gross, Math.abs(l.couponDiscount || 0));
  const after = gross - coupon;
  const own =
    l.discountType === "percent"
      ? (after * Math.min(100, Math.max(0, l.discount || 0))) / 100
      : Math.min(after, Math.max(0, l.discount || 0) * qty);
  return r2(Math.min(gross, coupon + own));
};
