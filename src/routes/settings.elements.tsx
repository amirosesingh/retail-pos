import { createFileRoute } from "@tanstack/react-router";
import { SettingsTabs } from "@/platforms/web/components/pos/settings/SettingsTabs";
import {
  SettingsFrame,
  useSettingsCtx,
} from "@/platforms/web/components/pos/settings/SettingsFrame";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PAPER_LABELS } from "@/lib/pos-print";
import type { PaperSize, ReceiptSettings } from "@/core/types/pos-types";

const TOGGLES: { key: keyof ReceiptSettings; label: string }[] = [
  { key: "showLogo", label: "Show business logo / initials" },
  { key: "showPoints", label: "Member points balance" },
  { key: "showBarcode", label: "Barcode" },
  { key: "showTax", label: "Tax details" },
];

export const Route = createFileRoute("/settings/elements")({
  head: () => ({
    meta: [
      { title: "Receipt Elements — Retail" },
      {
        name: "description",
        content:
          "Pick the paper size and choose which blocks print on each slip: logo, member points, barcode and tax breakdown.",
      },
      { property: "og:title", content: "Receipt Elements — Retail" },
      { property: "og:description", content: "Paper size and printed receipt blocks." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <SettingsFrame
      title="Receipt elements"
      description="Paper size and which blocks appear on the printed slip."
      showPreview
    >
      <SettingsTabs current="/settings/elements" />

      <ElementsForm />
    </SettingsFrame>
  ),
});

function ElementsForm() {
  const { receipt, setGlobal } = useSettingsCtx();
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Paper size</Label>
        <ThemedSelect
          ariaLabel="Paper size"
          value={receipt.paper}
          onChange={(v) => setGlobal({ paper: v as PaperSize })}
          options={(Object.keys(PAPER_LABELS) as PaperSize[]).map((p) => ({
            value: p,
            label: PAPER_LABELS[p],
          }))}
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {TOGGLES.map((t) => (
          <div
            key={t.key}
            className="flex items-center justify-between rounded-md border border-border px-3 py-2"
          >
            <span className="text-sm">{t.label}</span>
            <Switch
              aria-label={t.label}
              checked={!!receipt[t.key]}
              onCheckedChange={(v) => setGlobal({ [t.key]: v } as Partial<ReceiptSettings>)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
