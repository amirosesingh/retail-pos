import { beforeEach, expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn());
vi.mock("@/core/api/db-query", () => ({ routedQuery: query }));
vi.mock("@/integrations/supabase/external-client", () => ({ supabaseExternal: {} }));
vi.mock("@/core/api/pos-db", () => ({ commitOps: vi.fn() }));
vi.mock("@/core/local-db/local-db", () => ({ localDb: () => null }));
vi.mock("../notify", () => ({ describeError: (e: Error) => e.message }));
import { loadCampaignStats, loadCouponEvents, loadVouchers } from "../coupons";
beforeEach(() => {
  query.mockReset();
});
it("propagates voucher and audit failures rather than claiming empty results", async () => {
  query.mockRejectedValue(new Error("Permission denied"));
  await expect(loadVouchers()).rejects.toThrow("Permission denied");
  await expect(loadCouponEvents()).rejects.toThrow("Permission denied");
});
it("routes audit pages with the same cursor and selected columns on every platform", async () => {
  query.mockResolvedValue([]);
  await loadCouponEvents({
    campaignId: "c",
    cursor: { ts: "2026-10-23T00:00:00Z", id: "a" },
    limit: 50,
  });
  expect(query).toHaveBeenCalledWith(
    "coupon_events",
    expect.objectContaining({
      match: { campaign_id: "c" },
      limit: 50,
      cursor: { column: "created_at", value: "2026-10-23T00:00:00Z", id: "a" },
    }),
  );
});
it("counts redemption by redemption date and excludes extra discounts and refunded revenue", async () => {
  query.mockImplementation(async (table: string) => {
    if (table === "coupon_campaigns") return [{ id: "c", name: "Campaign" }];
    if (table === "issued_vouchers")
      return [
        {
          id: "v1",
          campaign_id: "c",
          status: "REDEEMED",
          issued_at: "2026-09-01",
          redeemed_at: "2026-10-23",
          redeemed_sale_id: "B1",
        },
        {
          id: "v2",
          campaign_id: "c",
          status: "REDEEMED",
          issued_at: "2026-10-22",
          redeemed_at: "2026-10-23",
          redeemed_sale_id: "B2",
        },
      ];
    if (table === "sales")
      return [
        {
          bill_number: "B1",
          total_amount: 90,
          coupon_discount: 10,
          discount_amount: 40,
          is_refunded: false,
        },
        { bill_number: "B2", total_amount: 50, coupon_discount: 5, is_refunded: true },
      ];
    throw new Error("Unexpected table");
  });
  const [result] = await loadCampaignStats({ from: "2026-10-01", to: "2026-10-31" });
  expect(result.issued).toBe(1);
  expect(result.redeemed).toBe(2);
  expect(result.revenue).toBe(90);
  expect(result.discount).toBe(10);
});

it("counts reusable-code bills once and separates coupon savings from other discounts", async () => {
  const { reusableCodeTotals } = await import("../reusable-code-report");
  const sale = { id: "s1", coupon_promo_id: "c", coupon_scope: "item", coupon_discount: 20, total_amount: 70, discount_amount: 30 };
  expect(reusableCodeTotals([sale, sale, { ...sale, id: "s2", is_refunded: true }, { ...sale, id: "s3", coupon_promo_id: "other" }], "c")).toEqual({ count: 1, revenue: 70, discount: 20 });
});
