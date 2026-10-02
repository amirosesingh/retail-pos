import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import { createFileRoute } from "@tanstack/react-router";
import { SettingsTabs } from "@/platforms/web/components/pos/settings/SettingsTabs";
import { useState } from "react";
import { SettingsFrame } from "@/platforms/web/components/pos/settings/SettingsFrame";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePos } from "@/lib/pos-store";
import { peekSku, readSkuSettings, writeSkuSettings, type SkuMode } from "@/lib/sku";

export const Route = createFileRoute("/settings/sku")({
  head: () => ({
    meta: [
      { title: "SKU Numbering — Retail" },
      {
        name: "description",
        content:
          "Choose globally unique automatic SKUs or manual codes for new products.",
      },
      { property: "og:title", content: "SKU Numbering — Retail" },
      { property: "og:description", content: "Automatic or manual product code numbering." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SkuSettingsPage,
});

function SkuSettingsPage() {
  return (
    <SettingsFrame
      showSaveBar={false}
      title="SKU numbering"
      description="New products can take a running number automatically, so no one has to invent a code at the counter."
    >
      <SettingsTabs current="/settings/sku" />

      <SkuForm />
    </SettingsFrame>
  );
}

function SkuForm() {
  const { state } = usePos();
  const [cfg, setCfg] = useState(() => readSkuSettings());
  const save = (patch: Partial<typeof cfg>) => {
    const merged = { ...cfg, ...patch };
    setCfg(merged);
    writeSkuSettings(patch);
  };
  const preview = peekSku(state.products.map((p) => p.sku));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            ["auto", "Automatic", "The till fills the SKU with the next running number."],
            ["manual", "Manual", "Staff type their own product code."],
          ] as [SkuMode, string, string][]
        ).map(([mode, label, blurb]) => (
          <button
            key={mode}
            type="button"
            onClick={() => save({ mode })}
            className={`rounded-lg border p-4 text-left transition-colors ${
              cfg.mode === mode
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            }`}
          >
            <p className="text-sm font-medium">{label}</p>
            <p className="text-xs text-muted-foreground">{blurb}</p>
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Prefix</Label>
          <Input value={cfg.prefix} onChange={(e) => save({ prefix: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Last local position</Label>
          <Input
            className="numeric"
            value={cfg.next}
            readOnly
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Digits</Label>
          <ThemedSelect
            ariaLabel="SKU digits"
            value={String(cfg.pad)}
            onChange={(value) => save({ pad: Number(value) })}
            options={Array.from({ length: 12 }, (_, index) => ({
              value: String(index + 1),
              label: `${index + 1} digits`,
            }))}
          />
        </div>
      </div>

      <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        Next reserved product code is{" "}
        <span className="numeric font-medium text-foreground">{preview}</span>. Codes already used
        in the catalog are skipped. Online terminals reserve non-overlapping ranges from one central
        counter, then use those ranges safely while offline.
      </p>
    </div>
  );
}
