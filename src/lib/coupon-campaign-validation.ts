import type { Campaign } from "@/lib/coupons";

/** The campaign editor must not save discounts or windows that cannot be applied. */
export function validateCouponCampaign(campaign: Campaign): string | null {
  if (!campaign.name.trim()) return "Give the campaign a name";
  if (!campaign.slug.trim()) return "Give the campaign a link slug";
  if (!Number.isFinite(campaign.discountValue) || campaign.discountValue <= 0)
    return "Enter a discount greater than zero";
  if (campaign.discountType === "PERCENTAGE" && campaign.discountValue > 100)
    return "A percentage discount cannot exceed 100%";
  if (campaign.scope !== "BILL" && !campaign.scopeValue)
    return `Select the ${campaign.scope === "PRODUCT" ? "product" : "category"} this campaign applies to`;
  if (campaign.startsAt && campaign.expiresAt && Date.parse(campaign.startsAt) >= Date.parse(campaign.expiresAt))
    return "The expiry must be after the start time";
  return null;
}
