import { HelpTip } from "@/components/ui/help-tip";
import { createFileRoute } from "@tanstack/react-router";
import {
  SettingsFrame,
  useSettingsCtx,
} from "@/platforms/web/components/pos/settings/SettingsFrame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Landmark, QrCode, ReceiptText } from "lucide-react";

export const Route = createFileRoute("/settings/payment")({
  head: () => ({
    meta: [
      { title: "Bank Transfer Details — Retail" },
      {
        name: "description",
        content:
          "Bank account, WhatsApp number and payment QR shown on the customer display and printed on booking slips.",
      },
      { property: "og:title", content: "Bank Transfer Details — Retail" },
      {
        property: "og:description",
        content: "Bank account and payment QR for customer transfers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <SettingsFrame
      title="Bank transfer details"
      description="Shown on the customer-facing display and printed on booking slips so shoppers can settle a balance by bank transfer."
    >
      <PaymentForm />
    </SettingsFrame>
  ),
});

function PaymentForm() {
  const { payment, paymentQr, setPaymentQr, updateSettings } = useSettingsCtx();
  return (
    <div className="space-y-4">
      <section aria-label="Bank account details" className="space-y-4 rounded-xl border bg-card p-4">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Landmark className="size-5" /></span>
          <div><h2 className="text-sm font-semibold">Bank account</h2><p className="text-xs text-muted-foreground">The transfer details your customers see.</p></div>
        </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Bank name</Label>
          <Input
            value={payment.bankName}
            onChange={(e) => updateSettings({ payment: { ...payment, bankName: e.target.value } })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Account name</Label>
          <Input
            value={payment.accountName}
            onChange={(e) =>
              updateSettings({ payment: { ...payment, accountName: e.target.value } })
            }
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Account number</Label>
          <Input
            className="numeric"
            value={payment.accountNumber}
            onChange={(e) =>
              updateSettings({ payment: { ...payment, accountNumber: e.target.value } })
            }
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">WhatsApp number (QR code)</Label>
          <Input
            className="numeric"
            placeholder="+15550100"
            value={payment.whatsapp}
            onChange={(e) => updateSettings({ payment: { ...payment, whatsapp: e.target.value } })}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Instruction note</Label>
        <Input
          value={payment.note}
          onChange={(e) => updateSettings({ payment: { ...payment, note: e.target.value } })}
        />
      </div>
      <div className="flex items-center justify-between gap-4 rounded-lg bg-muted/40 px-3 py-3">
        <span className="flex items-center gap-2 text-sm"><ReceiptText className="size-4 shrink-0 text-primary" />Print transfer details on booking slips</span>
        <Switch
          aria-label="Print transfer details on booking slips"
          checked={payment.showOnBookingSlip}
          onCheckedChange={(v) => updateSettings({ payment: { ...payment, showOnBookingSlip: v } })}
        />
      </div>
      </section>

      <section aria-label="Customer payment QR" className="space-y-4 rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600"><QrCode className="size-5" /></span>
            <div>
            <div className="flex items-center gap-1">
              <h2 className="text-sm font-semibold">Customer payment QR</h2>
              <HelpTip
                text={
                  <>
                    Paste your bank / e-wallet QR payload (EMVCo, UPI, PromptPay, DuitNow) or a
                    payment link.
                  </>
                }
              />
            </div>
            <p className="text-xs text-muted-foreground">Show a scan-to-pay code on the customer display.</p>
            </div>
          </div>
          <Switch
            aria-label="Payment QR on customer display"
            checked={paymentQr.enabled}
            onCheckedChange={(v) => setPaymentQr({ enabled: v })}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Caption</Label>
            <Input
              value={paymentQr.label}
              onChange={(e) => setPaymentQr({ label: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Mode</Label>
            <div className="flex gap-1 rounded-lg bg-muted p-1">
              {(["static", "dynamic"] as const).map((m) => (
                <Button
                  key={m}
                  type="button"
                  size="sm"
                  variant={paymentQr.mode === m ? "default" : "outline"}
                  aria-pressed={paymentQr.mode === m}
                  className="h-9 flex-1 rounded-md"
                  onClick={() => setPaymentQr({ mode: m })}
                >
                  {m === "static" ? "Static" : "Dynamic"}
                </Button>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <Label className="text-xs text-muted-foreground">QR payload</Label>
            <HelpTip
              text={
                <>
                  Dynamic mode replaces {"{amount}"} and {"{reference}"} with the live bill total
                  and receipt number at checkout.
                </>
              }
            />
          </div>
          <Textarea
            rows={3}
            placeholder="00020101021226...  or  https://pay.example.com?amt={amount}&ref={reference}"
            value={paymentQr.payload}
            onChange={(e) => setPaymentQr({ payload: e.target.value })}
          />
        </div>
        <p className="text-xs text-muted-foreground">Static uses one fixed code. Dynamic fills in the current bill amount and reference.</p>
      </section>
    </div>
  );
}
