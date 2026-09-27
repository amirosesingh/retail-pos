import { createFileRoute } from "@tanstack/react-router";
import { SettingsTabs } from "@/platforms/web/components/pos/settings/SettingsTabs";
import {
  SettingsFrame,
  useSettingsCtx,
} from "@/platforms/web/components/pos/settings/SettingsFrame";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import { PresetNumber } from "@/components/ui/preset-number";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { FontFamilyKey, ReceiptSettings } from "@/core/types/pos-types";

const FONT_SCOPES: { key: keyof ReceiptSettings["fonts"]; label: string }[] = [
  { key: "header", label: "Header" },
  { key: "body", label: "Body" },
  { key: "footer", label: "Footer" },
];

const FAMILIES: { key: FontFamilyKey; label: string }[] = [
  { key: "mono", label: "Monospace" },
  { key: "sans", label: "Sans" },
  { key: "serif", label: "Serif" },
];

export const Route = createFileRoute("/settings/type")({
  head: () => ({
    meta: [
      { title: "Receipt Typography — Retail" },
      {
        name: "description",
        content:
          "Choose font family, size, letter spacing and weight for the header, body and footer of printed receipts.",
      },
      { property: "og:title", content: "Receipt Typography — Retail" },
      { property: "og:description", content: "Fonts and sizing for printed receipts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <SettingsFrame
      title="Receipt typography"
      description="Edit typography for the ownership selected in Settings inheritance."
      showPreview
    >
      <SettingsTabs current="/settings/type" />

      <TypographyForm />
    </SettingsFrame>
  ),
});

function TypographyForm() {
  const { receipt, setFont } = useSettingsCtx();
  return (
    <div className="space-y-3">
      {FONT_SCOPES.map((scope) => {
        const f = receipt.fonts[scope.key];
        return (
          <div key={scope.key} className="rounded-md border border-border p-3">
            <p className="text-sm font-medium">{scope.label}</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-4">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Family</Label>
                <ThemedSelect
                  ariaLabel="Font family"
                  value={f.family}
                  onChange={(v) => setFont(scope.key, { family: v as FontFamilyKey })}
                  options={FAMILIES.map((o) => ({ value: o.key, label: o.label }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Size (px)</Label>
                <PresetNumber
                  label={`${scope.label} font size`}
                  value={f.size}
                  min={7}
                  max={40}
                  onChange={(size) => setFont(scope.key, { size })}
                  options={[8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40].map((value) => ({
                    value,
                    label: `${value} px`,
                  }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Spacing (px)</Label>
                <PresetNumber
                  label={`${scope.label} letter spacing`}
                  value={f.spacing}
                  min={0}
                  max={8}
                  step={0.5}
                  onChange={(spacing) => setFont(scope.key, { spacing })}
                  options={[0, 0.5, 1, 1.5, 2, 3, 4].map((value) => ({
                    value,
                    label: `${value} px`,
                  }))}
                />
              </div>
              <div className="flex items-end justify-between gap-2">
                <Label className="text-[11px] text-muted-foreground">Bold</Label>
                <Switch
                  aria-label={`${scope.label} bold`}
                  checked={f.bold}
                  onCheckedChange={(v) => setFont(scope.key, { bold: v })}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
