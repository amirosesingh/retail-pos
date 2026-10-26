import { ReceiptSectionEditor } from "./ReceiptSectionEditor";
import type { ReceiptSectionKey } from "@/lib/receipt-sections";
import type { ReactNode } from "react";
import { SettingsEditDialog } from "./SettingsEditDialog";
import { SettingsDisclosure } from "./SettingsDisclosure";
import { Link } from "@tanstack/react-router";
import { Switch } from "@/components/ui/switch";
import { RECEIPT_DOCUMENTS, receiptDocumentLayout, type ReceiptDocumentKind, type ReceiptDocumentLayout } from "@/lib/receipt-documents";
import { useSettingsCtx } from "./settings-context";

const labels: Record<keyof ReceiptDocumentLayout, string> = {
  showCustomer: "Customer details", showPhone: "Customer phone", showQuantities: "Item quantities", showUnitPrices: "Unit prices", showLineTotals: "Item totals", showPaymentHistory: "Payment history", showDueDate: "Collection / due date", showNotes: "Notes", showRacket: "Racket model", showString: "String details", showTension: "String tension", showJobStatus: "Job status", showBarcode: "Reference barcode", showQr: "Receipt QR code",
};
const fields: Record<ReceiptDocumentKind, (keyof ReceiptDocumentLayout)[]> = {
  sale: ["showCustomer", "showQuantities", "showUnitPrices", "showLineTotals", "showBarcode", "showQr"],
  booking: ["showCustomer", "showPhone", "showQuantities", "showUnitPrices", "showLineTotals", "showPaymentHistory", "showDueDate", "showNotes", "showBarcode", "showQr"],
  "racket-customer": ["showCustomer", "showPhone", "showQuantities", "showUnitPrices", "showLineTotals", "showPaymentHistory", "showDueDate", "showNotes", "showRacket", "showString", "showTension", "showJobStatus", "showBarcode", "showQr"],
  "racket-staff": ["showCustomer", "showPhone", "showDueDate", "showNotes", "showRacket", "showString", "showTension", "showJobStatus", "showBarcode", "showQr"],
};
export function ReceiptDocumentControls({ area = "sales", sectionContent }: { area?: "sales" | "booking"; sectionContent?: Partial<Record<ReceiptSectionKey, ReactNode>> }) {
  const { receipt, previewDocument, setPreviewDocument, setGlobal } = useSettingsCtx();
  const document = area === "sales" ? "sale" : previewDocument === "sale" ? "booking" : previewDocument;
  const layout = receiptDocumentLayout(receipt.documentLayouts, document);
  return <section className="space-y-4 rounded-xl border bg-card p-4">
    <div><h2 className="text-lg font-semibold">{area === "sales" ? "Sales receipt fields" : "Booking slips & racket tags"}</h2><p className="mt-1 text-sm text-muted-foreground">{area === "sales" ? "Choose the fields printed on normal sales receipts." : "Choose a booking customer slip or racket staff tag to edit its printed fields and preview."} Changes are saved with Save settings.</p></div>
    {area === "booking" && <label className="block space-y-2"><span className="font-semibold">Receipt / slip type</span><select className="h-11 w-full rounded-lg border bg-background px-3 text-base" value={document} onChange={event => setPreviewDocument(event.target.value as ReceiptDocumentKind)}>{RECEIPT_DOCUMENTS.filter(item => item.value !== "sale").map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>}
    <ReceiptSectionEditor key={document} document={document} contentEditors={sectionContent} />
    <FieldsEditor area={area} summary={`${fields[document].filter(key => layout[key]).length} of ${fields[document].length} fields shown`}>
    <div className="grid gap-2 sm:grid-cols-2">{fields[document].map(key => <label key={key} className="flex min-h-12 items-center justify-between gap-3 rounded-lg border px-3 py-2"><span>{labels[key]}</span><Switch aria-label={labels[key]} checked={layout[key]} onCheckedChange={checked => setGlobal({ documentLayouts: { ...receipt.documentLayouts, [document]: { ...receipt.documentLayouts?.[document], [key]: checked } } })} /></label>)}</div>
    </FieldsEditor>
    <p className="text-sm text-muted-foreground">{document === "racket-staff" ? "The staff tag uses its booking reference for barcode and QR identification." : "Barcode and QR switches also require their shared content to be enabled. Payment totals remain on customer receipts."}</p>
    <div className="flex flex-wrap gap-3 text-sm font-semibold text-primary"><Link to="/settings/printer">Paper &amp; margins</Link></div>
  </section>;
}

function FieldsEditor({ area, summary, children }: { area: "sales" | "booking"; summary: string; children: ReactNode }) {
  return area === "booking" ? <SettingsEditDialog title="Printed fields" summary={summary} description="Choose which details appear on the selected booking slip or tag.">{children}</SettingsEditDialog> : <SettingsDisclosure title="Printed fields" description="Choose which details appear on this document." initialOpen>{children}</SettingsDisclosure>;
}
