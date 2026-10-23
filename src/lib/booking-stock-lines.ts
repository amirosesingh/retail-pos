import type { CartLine, IntakeCharge, Product } from "@/core/types/pos-types";

/** A stocked job material is reserved as a booking line and sold on collection. */
export function stockLinesFromCharges(charges: IntakeCharge[], products: Product[]): CartLine[] {
  const byId = new Map(products.map(product => [product.id, product]));
  return charges.flatMap(charge => {
    if (!charge.productId || charge.customerProvided) return [];
    const product = byId.get(charge.productId);
    if (!product) throw new Error(`Job material ${charge.name} is no longer in the catalogue.`);
    return [{
      productId: product.id,
      name: product.name,
      price: charge.price,
      originalPrice: charge.price,
      cost: product.cost,
      qty: 1,
      taxRate: product.taxRate,
      discount: 0,
    }];
  });
}
