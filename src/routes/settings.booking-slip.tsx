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
      title="Booking slip wording"
      description="Terms & conditions and the customer signature line printed on racket bookings and pay-later slips."
    >
      <SettingsTabs current="/settings/booking-slip" />

      <BookingSlipForm />
    </SettingsFrame>
  ),
});

function BookingSlipForm() {
  const { effective, setField } = useSettingsCtx();
  const cfg: BookingSlipSettings = effective.bookingSlip ?? defaultReceiptSettings.bookingSlip;
  const patch = (p: Partial<BookingSlipSettings>) => setField("bookingSlip", { ...cfg, ...p });

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="booking-terms">Terms &amp; conditions</Label>
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
        <p className="text-xs text-muted-foreground">
          Each line prints as its own line on the slip. Keep lines short so they fit the paper
          width.
        </p>
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="signature-caption">Customer signature block</Label>
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
        <p className="text-xs text-muted-foreground">
          Prints the caption, a signature rule with the customer name, and a date line.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        <div>
          <Label>Repeat terms on part-payment receipts</Label>
          <p className="text-xs text-muted-foreground">
            Off by default — the part-payment slip stays short.
          </p>
        </div>
        <Switch
          aria-label="Repeat terms on part-payment receipts"
          checked={cfg.termsOnPayment}
          onCheckedChange={(v) => patch({ termsOnPayment: v })}
        />
      </div>

      <div className="rounded-md border border-border bg-muted/40 p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Slip preview</p>
        <div className="whitespace-pre-wrap font-mono text-[11px] leading-4">
          {`RACKET JOB CARD
Racket            Yonex Astrox 88D
String            BG65 Ti
Tension           24 / 26 lb
Ready by          ${new Date().toLocaleDateString()}
`}
          {cfg.showTerms && cfg.terms.trim() ? `\nTERMS & CONDITIONS\n${cfg.terms.trim()}\n` : ""}
          {cfg.showSignature
            ? `\n${cfg.signatureCaption}\n____________________\nCustomer signature\n____________________\nDate`
            : ""}
        </div>
      </div>
    </div>
  );
}
