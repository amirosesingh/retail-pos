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
export function ReceiptDocumentControls() {
  const { receipt, previewDocument, setPreviewDocument, setGlobal } = useSettingsCtx();
  const layout = receiptDocumentLayout(receipt.documentLayouts, previewDocument);
  return <section className="space-y-4 rounded-xl border bg-card p-4">
    <div><h2 className="text-lg font-semibold">Bill &amp; booking receipt settings</h2><p className="mt-1 text-sm text-muted-foreground">Choose a document to edit its printed fields and see its actual layout. Changes are saved with Save settings.</p></div>
    <label className="block space-y-2"><span className="font-semibold">Receipt / slip type</span><select className="h-11 w-full rounded-lg border bg-background px-3 text-base" value={previewDocument} onChange={event => setPreviewDocument(event.target.value as ReceiptDocumentKind)}>{RECEIPT_DOCUMENTS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
    <div className="grid gap-2 sm:grid-cols-2">{fields[previewDocument].map(key => <label key={key} className="flex min-h-12 items-center justify-between gap-3 rounded-lg border px-3 py-2"><span>{labels[key]}</span><Switch aria-label={labels[key]} checked={layout[key]} onCheckedChange={checked => setGlobal({ documentLayouts: { ...receipt.documentLayouts, [previewDocument]: { ...receipt.documentLayouts?.[previewDocument], [key]: checked } } })} /></label>)}</div>
    <p className="text-sm text-muted-foreground">{previewDocument === "racket-staff" ? "The staff tag uses its booking reference for barcode and QR identification." : "Barcode and QR switches also require their shared content to be enabled. Payment totals remain on customer receipts."}</p>
    <div className="flex flex-wrap gap-3 text-sm font-semibold text-primary"><Link to="/settings/type">Fonts &amp; text sizes</Link><Link to="/settings/printer">Paper &amp; margins</Link><Link to="/settings/booking-slip">Booking terms &amp; signature</Link></div>
  </section>;
}
