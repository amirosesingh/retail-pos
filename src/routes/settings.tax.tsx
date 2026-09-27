import { createFileRoute } from "@tanstack/react-router";
import { SettingsTabs } from "@/platforms/web/components/pos/settings/SettingsTabs";
import {
  SettingsFrame,
  useSettingsCtx,
} from "@/platforms/web/components/pos/settings/SettingsFrame";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import { usePos } from "@/lib/pos-store";
import { ROUNDING_UNITS, roundingOf } from "@/core/pricing/rounding";
import type { TaxMode } from "@/core/types/pos-types";

export const Route = createFileRoute("/settings/tax")({
  head: () => ({
    meta: [
      { title: "Tax & Pricing — Retail" },
      {
        name: "description",
        content:
          "Set the global tax rate and choose whether prices include tax or have it added at checkout.",
      },
      { property: "og:title", content: "Tax & Pricing — Retail" },
      {
        property: "og:description",
        content: "Global tax rate and inclusive / exclusive pricing mode.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TaxSettingsPage,
});

function TaxSettingsPage() {
  return (
    <SettingsFrame
      title="Tax & pricing"
      description="Tax rules apply to every register instantly."
      scopeSections={["tax", "rounding"]}
    >
      <SettingsTabs current="/settings/tax" />

      <TaxForm />
      <RoundingForm />
    </SettingsFrame>
  );
}

/** Billing & totals — cash rounding of the final bill total. */
function RoundingForm() {
  const { state, updateSettings } = usePos();
  const integrations = state.settings.integrations;
  const rounding = roundingOf(integrations.rounding);
  const patch = (p: Partial<typeof rounding>) =>
    updateSettings({ integrations: { ...integrations, rounding: { ...rounding, ...p } } });

  return (
    <section className="mt-6 space-y-4 rounded-lg border border-border p-4">
      <div>
        <h2 className="text-sm font-semibold">Billing &amp; totals</h2>
        <p className="text-[11px] text-muted-foreground">
          Rounding applies to the final total only — after discounts, coupons and tax. Line items
          are never changed.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
        <div>
          <p className="text-sm font-medium">Enable total rounding</p>
          <p className="text-[11px] text-muted-foreground">Round the amount the customer pays</p>
        </div>
        <Switch
          checked={rounding.enabled}
          aria-label="Enable total rounding"
          onCheckedChange={(v) => patch({ enabled: v })}
        />
      </div>

      {rounding.enabled && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Rounding unit</Label>
            <ThemedSelect
              value={String(rounding.unit)}
              onChange={(v) => patch({ unit: Number(v) })}
              options={ROUNDING_UNITS.map((u) => ({ value: String(u), label: u.toFixed(2) }))}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Rounding direction</Label>
            <ThemedSelect
              value={rounding.direction}
              onChange={(v) => patch({ direction: v as typeof rounding.direction })}
              options={[
                { value: "nearest", label: "Nearest" },
                { value: "up", label: "Round Up" },
                { value: "down", label: "Round Down" },
              ]}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Applies to</Label>
            <ThemedSelect
              value={rounding.appliesTo}
              onChange={(v) => patch({ appliesTo: v as typeof rounding.appliesTo })}
              options={[
                { value: "all", label: "All payments" },
                { value: "cash", label: "Cash only" },
              ]}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Receipt label</Label>
            <Input
              value={rounding.receiptLabel}
              placeholder="Extra Discount"
              onChange={(e) => patch({ receiptLabel: e.target.value })}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 md:col-span-2">
            <div>
              <p className="text-sm font-medium">Show rounding on receipt</p>
              <p className="text-[11px] text-muted-foreground">
                Printed only when rounding lowers the bill. A round-up is always applied silently.
              </p>
            </div>
            <Switch
              checked={rounding.showOnReceipt}
              aria-label="Show rounding on receipt"
              onCheckedChange={(v) => patch({ showOnReceipt: v })}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function TaxForm() {
  const { tax, updateSettings } = useSettingsCtx();
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
        <div>
          <p className="text-sm font-medium">Enable tax</p>
          <p className="text-[11px] text-muted-foreground">Global tax calculation</p>
        </div>
        <Switch
          checked={tax.enabled}
          aria-label="Enable tax"
          onCheckedChange={(v) => updateSettings({ tax: { ...tax, enabled: v } })}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Tax rate (%)</Label>
        <Input
          className="numeric"
          value={tax.rate}
          onChange={(e) => updateSettings({ tax: { ...tax, rate: Number(e.target.value) || 0 } })}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Tax mode</Label>
        <div className="flex overflow-hidden rounded-md border border-border">
          {(
            [
              { m: "inclusive", label: "Prices Include Tax" },
              { m: "exclusive", label: "Tax Added at Checkout" },
            ] as { m: TaxMode; label: string }[]
          ).map((o) => (
            <button
              key={o.m}
              onClick={() => updateSettings({ tax: { ...tax, mode: o.m } })}
              className={`flex-1 px-2 py-2 text-xs ${
                tax.mode === o.m
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
