import { methodLabel, type Payment, type Product, type Sale } from "@/core/types/pos-types";
export const paymentTenderKey = (payment: Pick<Payment, "method" | "bankName">) =>
  payment.method === "card" && payment.bankName?.trim()
    ? "card:" + payment.bankName.trim()
    : payment.method;
export const paymentTenderLabel = (key: string) =>
  key.startsWith("card:") ? "Card · " + key.slice(5) : methodLabel(key);
export function saleMatchesSearch(sale: Sale, query: string, products: Map<string, Product>) {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  const fields = [
    sale.receiptNo,
    sale.cashier,
    ...sale.lines.flatMap((line) => {
      const product = products.get(line.productId);
      return [line.name, product?.sku, product?.barcode];
    }),
  ];
  return fields.some((value) =>
    String(value ?? "")
      .toLowerCase()
      .includes(term),
  );
}
