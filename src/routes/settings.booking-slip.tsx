import { SettingsEditDialog } from "@/platforms/web/components/pos/settings/SettingsEditDialog";
import { HelpTip } from "@/components/ui/help-tip";
import { useEffect } from "react";
import { ReceiptDocumentControls } from "@/platforms/web/components/pos/settings/ReceiptDocumentControls";
import { createFileRoute } from "@tanstack/react-router";
import { SettingsTabs } from "@/platforms/web/components/pos/settings/SettingsTabs";
import {
  SettingsFrame,
  useSettingsCtx,
} from "@/platforms/web/components/pos/settings/SettingsFrame";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const { effective, setField, setPreviewDocument } = useSettingsCtx();
  useEffect(() => { setPreviewDocument("booking"); }, [setPreviewDocument]);
  const cfg: BookingSlipSettings = effective.bookingSlip ?? defaultReceiptSettings.bookingSlip;
  const patch = (p: Partial<BookingSlipSettings>) => setField("bookingSlip", { ...cfg, ...p });

  return (
    <div className="space-y-4">
      <ReceiptDocumentControls area="booking" />
      <SettingsEditDialog title="Customer slip terms & conditions" description="Editable wording printed on booking customer slips." summary={cfg.showTerms ? "Printed on customer slips" : "Not printed"}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <Label htmlFor="booking-terms">Terms &amp; conditions</Label>
            <HelpTip
              text={
                <>
                  Each line prints as its own line on the slip. Keep lines short so they fit the
                  paper width.
                </>
              }
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Print on booking slips</span>
            <Switch
              aria-label="Print terms on booking slips"
              checked={cfg.showTerms}
              onCheckedChange={(v) => patch({ showTerms: v })}
            />
          </div>
        </div>
        <Textarea
          id="booking-terms"
          rows={8}
          className="font-mono text-xs"
          value={cfg.terms}
          placeholder={
            "1. Rackets left over 30 days may be disposed of.\n2. Old frames may break during stringing."
          }
          onChange={(e) => patch({ terms: e.target.value })}
        />
      </SettingsEditDialog>

      <SettingsEditDialog title="Signature & part-payment receipts" description="Customer acceptance wording and repeat terms on payment slips." summary={`Signature ${cfg.showSignature ? "on" : "off"} · Repeat terms ${cfg.termsOnPayment ? "on" : "off"}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <Label htmlFor="signature-caption">Customer signature block</Label>
            <HelpTip
              text={
                <>Prints the caption, a signature rule with the customer name, and a date line.</>
              }
            />
          </div>
          <Switch
            aria-label="Print customer signature block"
            checked={cfg.showSignature}
            onCheckedChange={(v) => patch({ showSignature: v })}
          />
        </div>
        <Input
          id="signature-caption"
          value={cfg.signatureCaption}
          placeholder="I accept the terms above and confirm the racket details are correct."
          onChange={(e) => patch({ signatureCaption: e.target.value })}
        />

      <div className="flex items-center justify-between gap-4 rounded-xl border bg-card p-4">
        <div>
          <div className="flex items-center gap-1">
            <Label>Repeat terms on part-payment receipts</Label>
            <HelpTip text={<>Off by default — the part-payment slip stays short.</>} />
          </div>
        </div>
        <Switch
          aria-label="Repeat terms on part-payment receipts"
          checked={cfg.termsOnPayment}
          onCheckedChange={(v) => patch({ termsOnPayment: v })}
        />
      </div>
      </SettingsEditDialog>


    </div>
  );
}
