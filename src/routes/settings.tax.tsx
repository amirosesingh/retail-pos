import { createFileRoute } from "@tanstack/react-router";
import { SettingsTabs } from "@/platforms/web/components/pos/settings/SettingsTabs";
import {
  SettingsFrame,
  useSettingsCtx,
} from "@/platforms/web/components/pos/settings/SettingsFrame";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import { ScopeBadge } from "@/platforms/web/components/pos/settings/ScopeControls";
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
      description="Edit tax and rounding values for the ownership selected in Settings inheritance."
    >
      <SettingsTabs current="/settings/tax" />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <TaxForm />
        <RoundingForm />
      </div>
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
    <section className="space-y-4 rounded-lg border border-border p-4">
      <div>
        <h2 className="text-sm font-semibold">Billing &amp; totals</h2>
        <p className="text-[11px] text-muted-foreground">
          Rounding applies to the final amount the customer pays. Line-item prices are never
          changed.
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
    <section className="space-y-4 rounded-lg border border-border p-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Tax</h2>
          <ScopeBadge path="tax.enabled" />
        </div>
        <p className="text-[11px] text-muted-foreground">
          One effective percentage is applied to every taxable item at this settings scope.
        </p>
      </div>
      <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
        <div>
          <p className="text-sm font-medium">Enable tax</p>
          <p className="text-[11px] text-muted-foreground">
            Show and calculate tax throughout the POS
          </p>
        </div>
        <Switch
          checked={tax.enabled}
          aria-label="Enable tax"
          onCheckedChange={(v) => updateSettings({ tax: { ...tax, enabled: v } })}
        />
      </div>
      {tax.enabled ? (
        <div className="space-y-4 rounded-md border border-border bg-muted/20 p-3">
          <div className="space-y-1">
            <Label htmlFor="global-tax-rate" className="text-xs text-muted-foreground">
              Tax percentage applied to all items
            </Label>
            <div className="relative">
              <Input
                id="global-tax-rate"
                type="number"
                min={0}
                max={100}
                step="0.01"
                className="numeric pr-8"
                value={tax.rate}
                onChange={(e) => {
                  const next = Math.min(100, Math.max(0, Number(e.target.value) || 0));
                  updateSettings({ tax: { ...tax, rate: next } });
                }}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                %
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              The selling screen and receipt will display Tax {tax.rate}%.
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">How prices use tax</Label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { m: "inclusive", label: "Included in prices" },
                  { m: "exclusive", label: "Added at checkout" },
                ] as { m: TaxMode; label: string }[]
              ).map((o) => (
                <Button
                  type="button"
                  key={o.m}
                  variant={tax.mode === o.m ? "default" : "outline"}
                  onClick={() => updateSettings({ tax: { ...tax, mode: o.m } })}
                  className="h-auto min-h-9 whitespace-normal px-2 py-2 text-xs"
                >
                  {o.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          Tax is off. The POS will not calculate or show tax on items, totals, customer displays, or
          receipts.
        </p>
      )}
    </section>
  );
}
