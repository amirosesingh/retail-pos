/**
 * Coupons and digital vouchers on the open ticket.
 *
 * Owns the coupon dialog state, the member's live voucher list and the token
 * locked at the end of a sale, plus the handlers that apply, preview and
 * remove a discount. Lifted out of the register screen unchanged, so the till
 * discounts exactly as before.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { notifyError } from "@/lib/notify";
import { logger } from "@/lib/audit-log";
import { r2 } from "@/core/types/pos-types";
import {
  campaignStatus,
  isVoucherExpired,
  loadMemberVouchers,
  loadVoucherByToken,
  voucherValue,
} from "@/lib/coupons";
import type { Campaign, VoucherView } from "@/lib/coupons";
import { isLive } from "@/lib/pos-promotions";
import type { CartCoupon } from "@/lib/register/use-cart";
import type { CartLine, Product, Promotion } from "@/core/types/pos-types";

type PromotionsDeps = {
  /** Catalogue, active promotions and known members. */
  products: Product[];
  promotions: Promotion[];
  members: { id: string }[];
  storeId: string;
  /** The open ticket. */
  lines: CartLine[];
  /** Bill subtotal after line discounts — the base a bill coupon works off. */
  promoBase: number;
  coupon: CartCoupon | null;
  setCoupon: (c: CartCoupon | null) => void;
  memberId: string | null;
  setMemberId: (id: string | null) => void;
  patchLine: (index: number, patch: Partial<CartLine>) => void;
  /** Manager gate for staff without the discount permission. */
  unlockDiscounts: () => Promise<boolean>;
};

export function usePromotions(deps: PromotionsDeps) {
  const {
    products,
    promotions,
    members,
    storeId,
    lines,
    promoBase,
    coupon,
    setCoupon,
    memberId,
    setMemberId,
    patchLine,
    unlockDiscounts,
  } = deps;

  const [couponOpen, setCouponOpen] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [couponScope, setCouponScope] = useState<"bill" | "item">("bill");
  const [couponLine, setCouponLine] = useState<string>("");
  /** Digital voucher token locked at the end of the sale, when one is on the bill. */
  const [voucherToken, setVoucherToken] = useState<string | null>(null);
  /** Live vouchers held by the attached member, for the picker. */
  const [memberVouchers, setMemberVouchers] = useState<VoucherView[]>([]);
  const [voucherPickerOpen, setVoucherPickerOpen] = useState(false);

  // Keep the attached member's live vouchers loaded for the picker.
  useEffect(() => {
    if (!memberId) {
      setMemberVouchers([]);
      return;
    }
    let live = true;
    void loadMemberVouchers(memberId)
      .then((vs) => live && setMemberVouchers(vs))
      .catch(() => live && setMemberVouchers([]));
    return () => {
      live = false;
    };
  }, [memberId]);

  async function applyCoupon() {
    const code = couponCode.trim();
    if (!code) return;
    const rule = promotions.find(
      (p) => isLive(p) && p.name.toLowerCase() === code.toLowerCase() && p.value,
    );
    if (!rule) {
      toast.error(`No active promotion matches “${code}”`);
      return;
    }
    const targetIndex = lines.findIndex((l) => l.productId === couponLine);
    if (couponScope === "item" && targetIndex < 0) {
      toast.error("Pick the item the coupon applies to");
      return;
    }
    if (!(await unlockDiscounts())) return;
    const at = new Date().toISOString();
    if (couponScope === "item") {
      const line = lines[targetIndex]!;
      const unit = rule.valueType === "percent" ? r2((line.price * (rule.value ?? 0)) / 100) : r2(rule.value ?? 0);
      const value = Math.min(r2(line.price * line.qty), r2(unit * line.qty));
      // The coupon lives in its own field so a cashier discount on the same
      // line adds to it instead of replacing it.
      patchLine(targetIndex, {
        couponCode: rule.name,
        couponDiscount: value,
      });
      setCoupon({
        code: rule.name,
        promoId: rule.id,
        scope: "item",
        discount: value,
        productId: line.productId,
        productName: line.name,
        appliedAt: at,
      });
      logger.log("promotion", "Coupon applied to an item", "register", {
        coupon: rule.name,
        promotionId: rule.id,
        scope: "item",
        product: line.name,
        productId: line.productId,
        qty: line.qty,
        discountValue: value,
        storeId,
        memberId,
        appliedAt: at,
      });
    } else {
      // A bill coupon is its own figure — it never occupies the cashier's
      // bill-discount entry, so the two add up instead of replacing each other.
      const value = Math.min(
        promoBase,
        rule.valueType === "percent"
          ? r2((promoBase * (rule.value ?? 0)) / 100)
          : r2(rule.value ?? 0),
      );
      setCoupon({
        code: rule.name,
        promoId: rule.id,
        scope: "bill",
        discount: value,
        appliedAt: at,
      });
      logger.log("promotion", "Coupon applied to the bill", "register", {
        coupon: rule.name,
        promotionId: rule.id,
        scope: "bill",
        discountValue: value,
        billBase: promoBase,
        storeId,
        memberId,
        appliedAt: at,
      });
    }
    setCouponCode("");
    setCouponOpen(false);
    toast.success(`Coupon ${rule.name} applied`);
  }

  /**
   * Apply a digital voucher (scanned QR or typed token). The voucher is only
   * locked in the database once the sale actually completes.
   */
  async function applyVoucher(rawToken: string) {
    const token = rawToken.trim().split("/").pop() ?? "";
    if (!token) return;
    if (!lines.length) {
      toast.error("Ring the items up before applying a voucher");
      return;
    }
    try {
      const view = await loadVoucherByToken(token);
      if (!view) {
        toast.error("That voucher code is not recognised");
        return;
      }
      if (view.voucher.status === "REDEEMED") {
        toast.error("This voucher has already been used");
        return;
      }
      if (view.voucher.status === "DISABLED") {
        toast.error("This voucher has been switched off");
        return;
      }
      const campaign = view.campaign;
      if (isVoucherExpired(view.voucher, campaign)) {
        toast.error("This voucher has expired");
        return;
      }
      const status = campaignStatus(campaign);
      if (status === "Scheduled" || status === "Off" || status === "Expired") {
        toast.error(
          status === "Scheduled"
            ? "This voucher campaign has not started yet"
            : "This voucher campaign is not active",
        );
        return;
      }
      if (view.voucher.memberId && members.some((m) => m.id === view.voucher.memberId)) {
        setMemberId(view.voucher.memberId);
      }

      const at = new Date().toISOString();
      if (campaign.scope === "PRODUCT") {
        const index = lines.findIndex((l) => l.productId === campaign.scopeValue);
        if (index < 0) {
          toast.error("The product this voucher covers is not on this bill");
          return;
        }
        const line = lines[index]!;
        const value = voucherValue(campaign, r2(line.price * line.qty));
        patchLine(index, {
          couponCode: token,
          couponDiscount: value,
        });
        setCoupon({
          code: token,
          promoId: campaign.id,
          scope: "item",
          discount: value,
          productId: line.productId,
          productName: line.name,
          appliedAt: at,
          name: campaign.name,
          remaining: campaign.discountType === "FIXED_AMOUNT" ? Math.max(0, r2(campaign.discountValue - value)) : 0,
        });
      } else {
        const base =
          campaign.scope === "CATEGORY"
            ? r2(
                lines
                  .filter((l) => products.find((p) => p.id === l.productId)?.category === campaign.scopeValue)
                  .reduce((a, l) => a + l.price * l.qty, 0),
              )
            : promoBase;
        if (base <= 0) {
          toast.error("Nothing on this bill qualifies for that voucher");
          return;
        }
        const value = voucherValue(campaign, base);
        setCoupon({
          code: token,
          promoId: campaign.id,
          scope: "bill",
          discount: value,
          appliedAt: at,
          name: campaign.name,
          remaining: campaign.discountType === "FIXED_AMOUNT" ? Math.max(0, r2(campaign.discountValue - value)) : 0,
        });
      }

      setVoucherToken(token);
      logger.log("promotion", "Digital voucher applied", "register", {
        voucher: token,
        campaign: campaign.name,
        campaignId: campaign.id,
        scope: campaign.scope,
        memberId: view.voucher.memberId,
        storeId,
        appliedAt: at,
      });
      toast.success(`${campaign.name} applied`);
    } catch (e) {
      notifyError(e, "Could not read that voucher");
    }
  }

  /**
   * What a voucher would take off the ticket as it stands, so the cashier can
   * compare before committing. Returns 0 with a reason when it doesn't apply.
   */
  function voucherPreview(campaign: Campaign): { value: number; reason: string } {
    if (!lines.length) return { value: 0, reason: "Ring up items first" };
    if (campaign.scope === "PRODUCT") {
      const line = lines.find((l) => l.productId === campaign.scopeValue);
      if (!line) return { value: 0, reason: "That product is not on this bill" };
      return { value: voucherValue(campaign, r2(line.price * line.qty)), reason: "" };
    }
    const base =
      campaign.scope === "CATEGORY"
        ? r2(
            lines
              .filter((l) => products.find((p) => p.id === l.productId)?.category === campaign.scopeValue)
              .reduce((a, l) => a + l.price * l.qty, 0),
          )
        : promoBase;
    if (base <= 0) return { value: 0, reason: "Nothing on this bill qualifies" };
    return { value: voucherValue(campaign, base), reason: "" };
  }

  /** Take the coupon off the ticket and record who removed it. */
  function removeCoupon() {
    if (!coupon) return;
    if (coupon.scope === "item") {
      const i = lines.findIndex((l) => l.couponCode === coupon.code);
      // Only the coupon goes; the cashier's own discount on that line stays.
      if (i >= 0) patchLine(i, { couponCode: undefined, couponDiscount: undefined });
    }
    logger.log("promotion", "Coupon removed", "register", {
      coupon: coupon.code,
      promotionId: coupon.promoId,
      scope: coupon.scope,
      product: coupon.productName ?? null,
      discountValue: coupon.discount,
      appliedAt: coupon.appliedAt,
      storeId,
    });
    setCoupon(null);
    setVoucherToken(null);
  }

  return {
    couponOpen,
    setCouponOpen,
    couponCode,
    setCouponCode,
    couponScope,
    setCouponScope,
    couponLine,
    setCouponLine,
    voucherToken,
    setVoucherToken,
    memberVouchers,
    setMemberVouchers,
    voucherPickerOpen,
    setVoucherPickerOpen,
    applyCoupon,
    applyVoucher,
    voucherPreview,
    removeCoupon,
  };
}
