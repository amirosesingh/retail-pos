import { describe, expect, it } from "vitest";
import { normalizeTransferQuantity } from "../stock-transfers";

describe("transfer import quantities", () => {
  it("normalizes imported quantities before they enter the transfer basket", () => {
    expect(normalizeTransferQuantity(4.9)).toBe(4);
    expect(normalizeTransferQuantity("3")).toBe(3);
    expect(normalizeTransferQuantity(-2)).toBe(0);
    expect(normalizeTransferQuantity(Number.NaN)).toBe(0);
  });
});
