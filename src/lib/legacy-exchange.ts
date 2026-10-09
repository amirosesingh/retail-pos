import type { CartLine, Product } from "@/core/types/pos-types";
export const LEGACY_EXCHANGE_PREFIX = "OLDPOS:";
export const isLegacyExchange = (reference: string | null | undefined) => reference?.startsWith(LEGACY_EXCHANGE_PREFIX) === true;
export function legacyExchangeReference(receipt: string): string {
  const value = receipt.trim().toUpperCase();
  if (!value || value.length > 100) throw new Error("Enter the old POS receipt number (up to 100 characters).");
  return `${LEGACY_EXCHANGE_PREFIX}${value}`;
}
export function legacyExchangeLine(product: Product, quantity: number, unitPaid: number): CartLine {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("Return quantity must be a positive whole number.");
  if (!Number.isFinite(unitPaid) || unitPaid <= 0 || Math.abs(unitPaid * 100 - Math.round(unitPaid * 100)) > 0.00001)
    throw new Error("Enter the original amount paid per item, with up to two decimal places.");
  return { productId: product.id, name: product.name, price: unitPaid, qty: -quantity, taxRate: 0, discount: 0, discountType: "amount", credit: true };
}
