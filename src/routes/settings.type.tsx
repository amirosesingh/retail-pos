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

const FONTS: { key: FontFamilyKey; label: string }[] = [
  { key: "mono", label: "Monospace" },
  { key: "sans", label: "Sans" },
  { key: "serif", label: "Serif" },
  { key: "arial", label: "Arial · Sans-serif" },
  { key: "verdana", label: "Verdana · Sans-serif" },
  { key: "tahoma", label: "Tahoma · Sans-serif" },
  { key: "georgia", label: "Georgia · Serif" },
  { key: "times", label: "Times New Roman · Serif" },
  { key: "courier", label: "Courier New · Monospace" },
];
const familyOf = (font: FontFamilyKey): "mono" | "sans" | "serif" =>
  ["serif", "georgia", "times"].includes(font) ? "serif" : ["sans", "arial", "verdana", "tahoma"].includes(font) ? "sans" : "mono";

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
      <p className="text-xs text-muted-foreground">Choose a font for each section. Select Custom… under Size to enter your own font size. Unavailable fonts use the matching family on that device.</p>
      <p className="text-xs text-muted-foreground">Named fonts apply to Direct and Windows print dialog printing. Thermal text (ESC/POS) uses the printer’s built-in font.</p>
      {FONT_SCOPES.map((scope) => {
        const f = receipt.fonts[scope.key];
        return (
          <div key={scope.key} className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">{scope.label}</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Family</Label>
                <ThemedSelect
                  ariaLabel={`${scope.label} font family`}
                  value={familyOf(f.family)}
                  onChange={(v) => setFont(scope.key, { family: v as FontFamilyKey })}
                  options={FONTS.filter(o => ["mono", "sans", "serif"].includes(o.key)).map(o => ({ value: o.key, label: o.label }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Font</Label>
                <ThemedSelect
                  ariaLabel={`${scope.label} font`}
                  value={f.family}
                  onChange={value => setFont(scope.key, { family: value as FontFamilyKey })}
                  options={FONTS.filter(o => familyOf(o.key) === familyOf(f.family)).map(o => ({ value: o.key, label: o.key === familyOf(o.key) ? `${o.label} default` : o.label.split(" · ")[0] }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Size (px)</Label>
                <PresetNumber
                  label={`${scope.label} font size`}
                  value={f.size}
                  min={7}
                  max={40}
                  step={0.5}
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
