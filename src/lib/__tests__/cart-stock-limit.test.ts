import { expect, it } from "vitest";
import { exceedsAvailableStock } from "../register/stock-guard";
it("honours the switch for requested cart quantities, including zero and negative availability", () => {
  for (const stock of [-1, 0, 2]) {
    expect(exceedsAvailableStock(stock, 3, true)).toBe(true);
    expect(exceedsAvailableStock(stock, 3, false)).toBe(false);
  }
  expect(exceedsAvailableStock(2, 2, true)).toBe(false);
});
