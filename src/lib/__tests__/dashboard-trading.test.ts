import { afterEach, expect, it } from "vitest";
import type { Sale } from "@/core/types/pos-types";
import { dashboardDailyTrading } from "../dashboard-trading";
import { setPosTimeZone } from "../time-zone";
const sale = (total: number, createdAt = "2026-10-26T12:00:00Z", refunded = false) => ({ total, createdAt, refunded }) as Sale;
afterEach(() => setPosTimeZone(""));
it("includes sponsorship only under the policy and keeps cash collection separate", () => {
  setPosTimeZone("Asia/Kuala_Lumpur");
  const sales = [sale(80), sale(20), sale(99, undefined, true)];
  const sponsorship = [{ day: "2026-10-26", value: 15 }];
  expect(dashboardDailyTrading(sales, sponsorship, "2026-10-26", "2026-10-26", false)).toEqual([{ day: "10-26", sales: 100, sponsorship: 0, total: 100 }]);
  expect(dashboardDailyTrading(sales, sponsorship, "2026-10-26", "2026-10-26", true)).toEqual([{ day: "10-26", sales: 100, sponsorship: 15, total: 115 }]);
});
it("keeps all thousands of bills in the configured business-day bucket", () => {
  setPosTimeZone("Asia/Kuala_Lumpur");
  const sales = Array.from({ length: 5000 }, () => sale(0.1, "2026-10-25T16:01:00Z"));
  expect(dashboardDailyTrading(sales, [], "2026-10-26", "2026-10-26", true)[0]).toEqual({ day: "10-26", sales: 500, sponsorship: 0, total: 500 });
});
it("groups long chart selections by month instead of losing records after the old 731-day cap", () => {
  setPosTimeZone("UTC");
  const result = dashboardDailyTrading([sale(10, "2022-01-01T12:00:00Z"), sale(20, "2026-10-26T12:00:00Z")], [], "2022-01-01", "2026-10-26", false);
  expect(result).toEqual([{ day: "2022-01", sales: 10, sponsorship: 0, total: 10 }, { day: "2026-10", sales: 20, sponsorship: 0, total: 20 }]);
});
