import { describe, expect, it } from "vitest";
import type { IntakeCharge, Product } from "@/core/types/pos-types";
import { stockLinesFromCharges } from "@/lib/booking-stock-lines";

const product = { id: "string-1", name: "BG65 string", price: 20, cost: 8, taxRate: 0 } as Product;

describe("racket booking stock lines", () => {
  it("reserves store-provided materials at the booked charge and excludes customer gear", () => {
    const charges = [
      { kind: "string", name: "BG65 string", price: 18, productId: product.id },
      { kind: "labor", name: "Stringing", price: 15 },
      { kind: "accessory", name: "Customer racket", price: 0, productId: "customer-racket", customerProvided: true },
    ] as IntakeCharge[];
    expect(stockLinesFromCharges(charges, [product])).toEqual([{
      productId: product.id,
      name: product.name,
      price: 18,
      originalPrice: 18,
      cost: 8,
      qty: 1,
      taxRate: 0,
      discount: 0,
    }]);
  });

  it("stops booking if a selected stocked product has disappeared", () => {
    expect(() => stockLinesFromCharges([{ kind: "string", name: "BG65", price: 18, productId: "missing" }], []))
      .toThrow("no longer in the catalogue");
  });
});
