import { useEffect } from "react";
import { ReceiptDocumentControls } from "@/platforms/web/components/pos/settings/ReceiptDocumentControls";
import { createFileRoute } from "@tanstack/react-router";
import { SettingsTabs } from "@/platforms/web/components/pos/settings/SettingsTabs";
import {
  SettingsFrame,
  useSettingsCtx,
} from "@/platforms/web/components/pos/settings/SettingsFrame";
import { usePos } from "@/lib/pos-store";
import { bookingRulesOf, DEFAULT_SERVICE_TERMS } from "@/core/types/pos-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { defaultReceiptSettings } from "@/lib/pos-seed";
import type { BookingSlipSettings } from "@/core/types/pos-types";

export const Route = createFileRoute("/settings/booking-slip")({
  head: () => ({
    meta: [
      { title: "Booking Slip Wording — Retail" },
      {
        name: "description",
        content:
          "Write the terms and conditions printed on racket booking and pay-later slips, and turn on a customer signature line.",
      },
      { property: "og:title", content: "Booking Slip Wording — Retail" },
      {
        property: "og:description",
        content: "Terms, conditions and the customer signature block on booking slips.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <SettingsFrame
      title="Booking receipt settings"
      showPreview
      description="Customer booking slips, racket staff tags, terms & conditions and signature wording."
    >
      <SettingsTabs current="/settings/booking-slip" />

      <BookingSlipForm />
    </SettingsFrame>
  ),
});

function BookingSlipForm() {
  const { effective, setField, updateSettings, setPreviewDocument } = useSettingsCtx();
  useEffect(() => { setPreviewDocument("booking"); }, [setPreviewDocument]);
  const { state } = usePos();
  const cfg: BookingSlipSettings = effective.bookingSlip ?? defaultReceiptSettings.bookingSlip;
  const rules = bookingRulesOf(state.settings.integrations.bookingRules);
  const patch = (p: Partial<BookingSlipSettings>) => setField("bookingSlip", { ...cfg, ...p });
  return <ReceiptDocumentControls area="booking" sectionContent={{
    terms: <div className="space-y-3 rounded-lg border p-3"><label className="flex items-center justify-between gap-3 text-sm"><span>Print customer terms</span><Switch aria-label="Print terms on booking slips" checked={cfg.showTerms} onCheckedChange={showTerms => patch({ showTerms })} /></label><label className="block space-y-1 text-sm"><span>Terms &amp; conditions (shared booking wording)</span><Textarea aria-label="Customer terms wording" rows={5} value={cfg.terms} onChange={event => patch({ terms: event.target.value })} /></label><label className="flex items-center justify-between gap-3 text-sm"><span>Repeat on part-payment receipts</span><Switch aria-label="Repeat terms on part-payment receipts" checked={cfg.termsOnPayment} onCheckedChange={termsOnPayment => patch({ termsOnPayment })} /></label></div>,
    signature: <div className="space-y-3 rounded-lg border p-3"><label className="flex items-center justify-between gap-3 text-sm"><span>Print customer signature</span><Switch aria-label="Print customer signature block" checked={cfg.showSignature} onCheckedChange={showSignature => patch({ showSignature })} /></label><label className="block space-y-1 text-sm"><span>Signature caption (shared booking wording)</span><Input aria-label="Signature caption" value={cfg.signatureCaption} onChange={event => patch({ signatureCaption: event.target.value })} /></label></div>,
    liability: <div className="space-y-2 rounded-lg border p-3"><label className="block space-y-1 text-sm"><span>Service &amp; high-tension liability wording</span><Textarea aria-label="Service liability wording" rows={5} value={rules.serviceTerms} onChange={event => updateSettings({ integrations: { ...state.settings.integrations, bookingRules: { ...rules, serviceTerms: event.target.value } } })} /></label><Button type="button" size="sm" variant="ghost" onClick={() => updateSettings({ integrations: { ...state.settings.integrations, bookingRules: { ...rules, serviceTerms: DEFAULT_SERVICE_TERMS } } })}>Restore default wording</Button><p className="text-xs text-muted-foreground">Shared with racket intake, job tags and settlement receipts. Acceptance requirements remain in Booking rules.</p></div>,
  }} />;
}
