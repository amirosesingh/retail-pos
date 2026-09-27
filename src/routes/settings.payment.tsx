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
      scopeSections={["payment"]}
    >
      <PaymentForm />
    </SettingsFrame>
  ),
});

function PaymentForm() {
  const { payment, paymentQr, setPaymentQr, updateSettings } = useSettingsCtx();
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
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
      <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
        <span className="text-sm">Print transfer details on booking slips</span>
        <Switch
          aria-label="Print transfer details on booking slips"
          checked={payment.showOnBookingSlip}
          onCheckedChange={(v) => updateSettings({ payment: { ...payment, showOnBookingSlip: v } })}
        />
      </div>

      <div className="space-y-3 rounded-md border border-border p-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm">Payment QR on customer display</p>
            <p className="text-xs text-muted-foreground">
              Paste your bank / e-wallet QR payload (EMVCo, UPI, PromptPay, DuitNow) or a payment
              link.
            </p>
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
            <div className="flex gap-2">
              {(["static", "dynamic"] as const).map((m) => (
                <Button
                  key={m}
                  type="button"
                  size="sm"
                  variant={paymentQr.mode === m ? "default" : "outline"}
                  onClick={() => setPaymentQr({ mode: m })}
                >
                  {m === "static" ? "Static" : "Dynamic"}
                </Button>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">QR payload</Label>
          <Textarea
            rows={3}
            placeholder="00020101021226...  or  https://pay.example.com?amt={amount}&ref={reference}"
            value={paymentQr.payload}
            onChange={(e) => setPaymentQr({ payload: e.target.value })}
          />
          <p className="text-[11px] text-muted-foreground">
            Dynamic mode replaces {"{amount}"} and {"{reference}"} with the live bill total and
            receipt number at checkout.
          </p>
        </div>
      </div>
    </div>
  );
}
