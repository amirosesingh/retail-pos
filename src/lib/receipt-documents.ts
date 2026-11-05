export type ReceiptDocumentKind = "sale" | "booking" | "racket-customer" | "racket-staff";
export type ReceiptDocumentLayout = {
  showCustomer: boolean; showPhone: boolean; showQuantities: boolean; showUnitPrices: boolean;
  showLineTotals: boolean; showPaymentHistory: boolean; showDueDate: boolean; showNotes: boolean;
  showRacket: boolean; showString: boolean; showTension: boolean; showJobStatus: boolean;
  showBarcode: boolean; showQr: boolean;
};
export type ReceiptDocumentLayouts = Partial<Record<ReceiptDocumentKind, Partial<ReceiptDocumentLayout>>>;
export const RECEIPT_DOCUMENTS: { value: ReceiptDocumentKind; label: string }[] = [
  { value: "sale", label: "Sales receipt" }, { value: "booking", label: "Normal booking · customer" },
  { value: "racket-customer", label: "Racket booking · customer" }, { value: "racket-staff", label: "Racket job tag · staff" },
];
export function receiptDocumentLayout(layouts: ReceiptDocumentLayouts | undefined, kind: ReceiptDocumentKind): ReceiptDocumentLayout {
  const saved = layouts?.[kind];
  const keys: (keyof ReceiptDocumentLayout)[] = ["showCustomer", "showPhone", "showQuantities", "showUnitPrices", "showLineTotals", "showPaymentHistory", "showDueDate", "showNotes", "showRacket", "showString", "showTension", "showJobStatus", "showBarcode", "showQr"];
  return Object.fromEntries(keys.map(key => [key, saved?.[key] !== false])) as ReceiptDocumentLayout;
}
