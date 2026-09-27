import { PresetNumber } from "@/components/ui/preset-number";
import { createFileRoute } from "@tanstack/react-router";
import { SettingsTabs } from "@/platforms/web/components/pos/settings/SettingsTabs";
import {
  SettingsFrame,
  useSettingsCtx,
} from "@/platforms/web/components/pos/settings/SettingsFrame";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ReceiptCustomLine } from "@/core/types/pos-types";

export const Route = createFileRoute("/settings/qr")({
  head: () => ({
    meta: [
      { title: "Receipt QR Code — Retail" },
      {
        name: "description",
        content:
          "Print a QR code on receipts for feedback forms, loyalty sign-up or a payment link, with size and placement control.",
      },
      { property: "og:title", content: "Receipt QR Code — Retail" },
      { property: "og:description", content: "QR code printed on receipts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <SettingsFrame
      title="Receipt QR code"
      description="Link shoppers to feedback, loyalty sign-up or a payment page."
      scopeSections={["receiptIdentity"]}
      showPreview
    >
      <SettingsTabs current="/settings/qr" />

      <QrForm />
    </SettingsFrame>
  ),
});

function QrForm() {
  const { effective, setField } = useSettingsCtx();
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
        <span className="text-sm">Print QR code</span>
        <Switch
          aria-label="Print QR code"
          checked={effective.qr.enabled}
          onCheckedChange={(v) => setField("qr", { ...effective.qr, enabled: v })}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Link or text</Label>
        <Input
          placeholder="https://example.com/feedback"
          value={effective.qr.value}
          onChange={(e) => setField("qr", { ...effective.qr, value: e.target.value })}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Size (px)</Label>
          <PresetNumber
            label="QR size"
            value={effective.qr.size}
            min={48}
            max={220}
            onChange={(size) => setField("qr", { ...effective.qr, size })}
            options={[48, 64, 80, 96, 128, 160, 192, 220].map((value) => ({
              value,
              label: `${value} px`,
            }))}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Placement</Label>
          <ThemedSelect
            ariaLabel="QR placement"
            value={effective.qr.placement}
            onChange={(v) =>
              setField("qr", { ...effective.qr, placement: v as ReceiptCustomLine["placement"] })
            }
            options={[
              { value: "header", label: "Top of receipt" },
              { value: "footer", label: "Bottom of receipt" },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
