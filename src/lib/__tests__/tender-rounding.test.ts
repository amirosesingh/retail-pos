import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({values: [] as unknown[], cursor: 0}));
vi.mock("react", () => ({useState: (initial: unknown) => {
  const index = state.cursor++;
  if (!(index in state.values)) state.values[index] = initial;
  return [state.values[index], (value: unknown) => {
    state.values[index] = typeof value === "function" ? value(state.values[index]) : value;
  }];
}}));
vi.mock("@/core/types/payment-types", () => ({
  usePaymentTypes: () => ({types: []}), activePaymentTypes: () => [],
}));
import { useTender } from "../register/use-tender";
import { applyRounding, roundingPaymentMethod } from "@/core/pricing/rounding";
import type { PaymentMethod, RoundingSettings } from "@/core/types/pos-types";
beforeEach(() => { state.values = []; state.cursor = 0; });
const cfg = (direction: RoundingSettings["direction"], appliesTo: "all" | "cash" = "all") => ({enabled:true,unit:1,direction,appliesTo});
function useHarness(config: ReturnType<typeof cfg>) {
  state.cursor = 0;
  return useTender({hasLines: () => true, getTotal: (method: PaymentMethod) => applyRounding(89 * 0.8, config, method).total});
}
it.each([['down', '71.00'], ['up', '72.00'], ['nearest', '71.00']] as const)("prefills the %s rounded total after a 20 percent discount", (direction, expected) => {
  useHarness(cfg(direction)).openPayment();
  expect(useHarness(cfg(direction)).tendered).toBe(expected);
});
it("uses the requested method immediately and updates exact tender when cash-only rounding changes", () => {
  const config = cfg('down', 'cash');
  useHarness(config).openPayment('card');
  expect(useHarness(config).tendered).toBe('71.20');
  useHarness(config).setMethod('cash');
  expect(useHarness(config).tendered).toBe('71.00');
});
it("preserves an explicitly entered cash amount when switching methods", () => {
  const config = cfg('down', 'cash');
  useHarness(config).openPayment();
  useHarness(config).setTendered('100.00');
  useHarness(config).setMethod('card');
  expect(useHarness(config).tendered).toBe('100.00');
});
it("uses the largest split tender consistently for cash-only rounding", () => {
  const method = roundingPaymentMethod('cash', [{id:'cash',method:'cash',amount:20},{id:'card',method:'card',amount:51.2}]);
  expect(method).toBe('card');
  expect(applyRounding(71.2,cfg('down','cash'),method).total).toBe(71.2);
});


