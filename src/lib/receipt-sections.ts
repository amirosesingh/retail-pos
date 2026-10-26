import type { FontFamilyKey, FontStyleSettings } from "@/core/types/pos-types";
import type { ReceiptDocumentKind } from "./receipt-documents";
export const RECEIPT_SECTION_LABELS = { header: "Business heading", details: "Reference & customer", items: "Products", services: "Service charges", totals: "Totals", payments: "Payments & balance", collection: "Collection date & notes", job: "Racket job details", terms: "Customer terms & conditions", liability: "Service / liability terms", signature: "Customer signature", footer: "Footer & reference codes" } as const;
export type ReceiptSectionKey = keyof typeof RECEIPT_SECTION_LABELS;
export type ReceiptSectionStyle = { heading?: string; text?: string; font?: Partial<FontStyleSettings> };
export type ReceiptExtraSection = ReceiptSectionStyle & { id: string; after: ReceiptSectionKey; text: string; enabled: boolean };
export type ReceiptSectionConfig = { styles?: Partial<Record<ReceiptSectionKey, ReceiptSectionStyle>>; extra?: ReceiptExtraSection[] };
export type ReceiptDocumentSections = Partial<Record<ReceiptDocumentKind, ReceiptSectionConfig>>;
export const SECTION_KEYS: Record<ReceiptDocumentKind, ReceiptSectionKey[]> = {
  sale: ["header", "details", "items", "totals", "footer"],
  booking: ["header", "details", "items", "services", "totals", "payments", "collection", "terms", "liability", "signature", "footer"],
  "racket-customer": ["header", "details", "items", "services", "totals", "payments", "collection", "job", "terms", "liability", "signature", "footer"],
  "racket-staff": ["header", "job", "liability", "footer"],
};
export const RECEIPT_FONT_OPTIONS: { value: FontFamilyKey; label: string; group: "mono" | "sans" | "serif" }[] = [
  { value: "mono", label: "Default monospace", group: "mono" }, { value: "courier", label: "Courier New", group: "mono" },
  { value: "sans", label: "Default sans-serif", group: "sans" }, { value: "arial", label: "Arial", group: "sans" }, { value: "verdana", label: "Verdana", group: "sans" }, { value: "tahoma", label: "Tahoma", group: "sans" },
  { value: "serif", label: "Default serif", group: "serif" }, { value: "georgia", label: "Georgia", group: "serif" }, { value: "times", label: "Times New Roman", group: "serif" },
];
export function safeSectionFont(font: Partial<FontStyleSettings> | undefined, fallback: FontStyleSettings): FontStyleSettings {
  const finite = (value: unknown, base: number, min: number, max: number) => typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : base;
  const base = { family: RECEIPT_FONT_OPTIONS.some(item => item.value === fallback.family) ? fallback.family : "mono" as const, size: finite(fallback.size, 10, 7, 40), spacing: finite(fallback.spacing, 0, 0, 8), bold: !!fallback.bold };
  return { family: RECEIPT_FONT_OPTIONS.some(item => item.value === font?.family) ? font!.family! : base.family, size: finite(font?.size, base.size, 7, 40), spacing: finite(font?.spacing, base.spacing, 0, 8), bold: typeof font?.bold === "boolean" ? font.bold : base.bold };
}
