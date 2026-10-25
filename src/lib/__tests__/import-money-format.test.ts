import { expect, it } from "vitest";
import { displayImportMoney } from "@/lib/import-money-format";
import { productClassification } from "@/lib/product-classification";
it("shows money decimals without rounding costs that have greater precision", () => {
  expect(displayImportMoney(12)).toBe("12.00");
  expect(displayImportMoney(12.5)).toBe("12.50");
  expect(displayImportMoney(12.3456)).toBe("12.3456");
  expect(displayImportMoney(null)).toBe("");
});
it("uses Default only for missing classification, preserving assigned names", () => {
  for (const value of [null, undefined, "", " "]) expect(productClassification(value)).toBe("Default");
  expect(productClassification("General")).toBe("General");
  expect(productClassification(" Coffee ")).toBe("Coffee");
});
