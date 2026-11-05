import { Link } from "@tanstack/react-router";
import { SettingsEditDialog } from "@/platforms/web/components/pos/settings/SettingsEditDialog";
import { HelpTip } from "@/components/ui/help-tip";
/**
 * Booking rules.
 *
 * The house policy behind every booking: what deposit must be taken, how the
 * ready-by date is proposed, what a racket job card has to carry, and who is
 * allowed to undo one. The register and the bookings ledger both read these.
 */
import { createFileRoute } from "@tanstack/react-router";
import { SettingsTabs } from "@/platforms/web/components/pos/settings/SettingsTabs";
import { Plus, Trash2 } from "lucide-react";
import { SettingsFrame, useSettingsCtx } from "@/platforms/web/components/pos/settings/SettingsFrame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DecimalSettingInput } from "@/components/ui/decimal-setting-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { usePos } from "@/lib/pos-store";
import { bookingRulesOf, type BookingRules } from "@/core/types/pos-types";

export const Route = createFileRoute("/settings/booking-rules")({
  head: () => ({
    meta: [
      { title: "Booking Rules — Retail" },
      {
        name: "description",
        content:
          "Deposit minimums, turnaround times, racket job requirements and who may cancel or re-spec a booking.",
      },
      { property: "og:title", content: "Booking Rules — Retail" },
      {
        property: "og:description",
        content: "Deposits, scheduling, racket job cards and booking controls.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <SettingsFrame
      title="Booking rules"
      description="Deposits, turnaround, racket job requirements and who may cancel or re-spec a booking."
    >
      <SettingsTabs current="/settings/booking-rules" />

      <p className="text-sm text-muted-foreground">Select a rule to edit. <Link to="/settings/booking-slip" className="font-semibold text-primary underline underline-offset-4">Booking slips, tags &amp; wording</Link> are managed separately from sales receipts.</p>
      <BookingRulesForm />
    </SettingsFrame>
  ),
});

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          <p className="text-sm">{label}</p>
          <HelpTip text={hint} label={`About ${label}`} />
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Section({
  title,
  blurb,
  summary,
  children,
}: {
  title: string;
  blurb: string;
  summary?: string;
  children: React.ReactNode;
}) {
  return (
    <SettingsEditDialog title={title} description={blurb} summary={summary}>
      {children}
    </SettingsEditDialog>
  );
}

/** Simple add / remove list used for the racket and string master lists. */
function MasterList({
  label,
  hint,
  placeholder,
  items,
  onChange,
}: {
  label: string;
  hint: string;
  placeholder: string;
  items: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div>
        <div className="flex items-center gap-1">
          <p className="text-sm">{label}</p>
          <HelpTip text={hint} label={`About ${label}`} />
        </div>
      </div>
      {items.map((value, i) => (
        <div key={i} className="flex gap-2">
          <Input
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(items.map((v, j) => (j === i ? e.target.value : v)))}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove ${value || "entry"}`}
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange([...items, ""])}>
        <Plus className="mr-1 size-4" /> Add
      </Button>
    </div>
  );
}

function BookingRulesForm() {
  const { state } = usePos();
  const { updateSettings } = useSettingsCtx();
  const integrations = state.settings.integrations;
  const rules = bookingRulesOf(integrations.bookingRules);

  const patch = (p: Partial<BookingRules>) =>
    updateSettings({ integrations: { ...integrations, bookingRules: { ...rules, ...p } } });

  const setList = (key: "racketModels" | "stringModels", next: string[]) =>
    updateSettings({ integrations: { ...integrations, [key]: next } });

  const num = (v: string) => Math.max(0, Number(v) || 0);

  return (
    <div className="grid items-start gap-3 sm:grid-cols-2">
      <Section
        title="Deposits & payment"
        blurb="Deposit minimums and payment choices at booking and collection."
        summary={`${rules.requireDeposit ? "Deposit required" : "Deposit optional"} · Minimum ${rules.depositMin}${rules.depositMode === "percent" ? "%" : " (flat)"}`}
      >
        <Row
          label="Require a deposit on every booking"
          hint="A booking cannot be saved with nothing paid."
        >
          <Switch
            aria-label="Require a deposit on every booking"
            checked={rules.requireDeposit}
            onCheckedChange={(v) => patch({ requireDeposit: v })}
          />
        </Row>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Minimum deposit is</Label>
            <div className="flex overflow-hidden rounded-md border border-border">
              {(["percent", "amount"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => patch({ depositMode: m })}
                  className={`flex-1 px-2 py-2 text-xs ${
                    rules.depositMode === m
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "percent" ? "Percent of total" : "Flat amount"}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Minimum {rules.depositMode === "percent" ? "(%)" : "(amount)"}
            </Label>
            <DecimalSettingInput
              className="numeric text-right"
              aria-label="Minimum booking deposit"
              value={rules.depositMin}
              onValueChange={(depositMin) => patch({ depositMin })}
              placeholder="0"
            />
          </div>
        </div>
        <Row label="Offer “pay in full now”" hint="Cashier may settle the whole booking up front.">
          <Switch
            aria-label="Offer pay in full now"
            checked={rules.allowPayNow}
            onCheckedChange={(v) => patch({ allowPayNow: v })}
          />
        </Row>
        <Row
          label="Offer “part deposit”"
          hint="Take part of the money now, the rest on collection."
        >
          <Switch
            aria-label="Offer part deposit"
            checked={rules.allowPayDeposit}
            onCheckedChange={(v) => patch({ allowPayDeposit: v })}
          />
        </Row>
        <Row label="Offer “pay on collection”" hint="Nothing is taken at the counter.">
          <Switch
            aria-label="Offer pay on collection"
            checked={rules.allowPayOnCollection}
            onCheckedChange={(v) => patch({ allowPayOnCollection: v })}
          />
        </Row>
        <Row
          label="Block collection while a balance is owed"
          hint="The job cannot be handed over until the ticket is fully paid."
        >
          <Switch
            aria-label="Block collection while a balance is owed"
            checked={rules.blockCollectionWithBalance}
            onCheckedChange={(v) => patch({ blockCollectionWithBalance: v })}
          />
        </Row>
      </Section>

      <Section title="Scheduling" blurb="Ready-by dates and uncollected bookings." summary={`${rules.defaultTurnaroundHours || 0}h turnaround · Ready-by ${rules.requirePromisedAt ? "required" : "optional"}`}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <div className="flex items-center gap-1"><Label className="text-xs text-muted-foreground">Default turnaround (hours)</Label><HelpTip label="About Default turnaround (hours)" text="Pre-fills the ready-by box. 0 leaves it blank." /></div>
            <Input
              className="numeric text-right"
              inputMode="numeric"
              value={rules.defaultTurnaroundHours || ""}
              onChange={(e) => patch({ defaultTurnaroundHours: num(e.target.value) })}
              placeholder="48"
            />
          </div>
        </div>
        <Row
          label="Require a ready-by date and time"
          hint="A racket job cannot be saved without a promised time."
        >
          <Switch
            aria-label="Require a ready-by date and time"
            checked={rules.requirePromisedAt}
            onCheckedChange={(v) => patch({ requirePromisedAt: v })}
          />
        </Row>
        <Row
          label="Warn outside trading hours"
          hint="Flags a promised time before opening or after closing time."
        >
          <Switch
            aria-label="Warn outside trading hours"
            checked={rules.warnOutsideTradingHours}
            onCheckedChange={(v) => patch({ warnOutsideTradingHours: v })}
          />
        </Row>
        <div className="space-y-1">
          <div className="flex items-center gap-1"><Label className="text-xs text-muted-foreground">Flag uncollected bookings after (days)</Label><HelpTip label="About Flag uncollected bookings after (days)" text="0 never flags a booking as abandoned." /></div>
          <Input
            className="numeric text-right"
            inputMode="numeric"
            value={rules.staleAfterDays || ""}
            onChange={(e) => patch({ staleAfterDays: num(e.target.value) })}
            placeholder="0"
          />
        </div>
      </Section>

      <Section
        title="Racket / stringing jobs"
        blurb="Job tags, tension defaults and suggested racket and string models."
        summary={`Tags ${rules.autoJobTag ? "on" : "off"} · ${rules.defaultTensionMain} / ${rules.defaultTensionCross} ${rules.defaultTensionUnit}`}
      >
        <Row
          label="Generate a job tag automatically"
          hint="Stamps a unique tag on every racket booking."
        >
          <Switch
            aria-label="Generate a job tag automatically"
            checked={rules.autoJobTag}
            onCheckedChange={(v) => patch({ autoJobTag: v })}
          />
        </Row>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Default tension unit</Label>
            <div className="flex overflow-hidden rounded-md border border-border">
              {(["lb", "kg"] as const).map((u) => (
                <button
                  key={u}
                  onClick={() => patch({ defaultTensionUnit: u })}
                  className={`flex-1 px-2 py-2 text-xs ${
                    rules.defaultTensionUnit === u
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Default mains</Label>
            <DecimalSettingInput
              className="numeric text-right"
              value={rules.defaultTensionMain}
              onValueChange={(defaultTensionMain) => patch({ defaultTensionMain })}
              placeholder="26"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Default cross</Label>
            <DecimalSettingInput
              className="numeric text-right"
              value={rules.defaultTensionCross}
              onValueChange={(defaultTensionCross) => patch({ defaultTensionCross })}
              placeholder="28"
            />
          </div>
        </div>
        <Row label="Require the racket model" hint="The brand / model box cannot be left empty.">
          <Switch
            aria-label="Require the racket model"
            checked={rules.requireRacketModel}
            onCheckedChange={(v) => patch({ requireRacketModel: v })}
          />
        </Row>
        <Row
          label="Require the string type"
          hint="The string brand / model box cannot be left empty."
        >
          <Switch
            aria-label="Require the string type"
            checked={rules.requireStringType}
            onCheckedChange={(v) => patch({ requireStringType: v })}
          />
        </Row>
        <MasterList
          label="Racket master list"
          hint="Suggested in the intake picker. Cashiers can still type anything."
          placeholder="Yonex Astrox 88D Pro"
          items={integrations.racketModels ?? []}
          onChange={(next) => setList("racketModels", next)}
        />
        <MasterList
          label="String master list"
          hint="Suggested in the intake picker. Cashiers can still type anything."
          placeholder="BG65 Ti"
          items={integrations.stringModels ?? []}
          onChange={(next) => setList("stringModels", next)}
        />
        <div className="space-y-1">
          <div className="flex items-center gap-1"><Label className="text-xs text-muted-foreground">Locked base labour fee</Label><HelpTip label="About Locked base labour fee" text="Pre-filled and read-only on the intake screen. Cashiers must override it to change it." /></div>
          <DecimalSettingInput
            className="numeric text-right"
            value={integrations.baseLaborFee}
            onValueChange={(baseLaborFee) =>
              updateSettings({
                integrations: { ...integrations, baseLaborFee },
              })
            }
            placeholder="0.00"
          />
        </div>
      </Section>

      <Section
        title="Combo & overrides"
        blurb="Labour discounts when a racket and string are purchased together."
        summary={rules.comboRule === "off" ? "Combo discount off" : rules.comboRule === "waive_labour" ? "Labour waived for combos" : `${rules.comboValue}${rules.comboRule === "percent" ? "%" : " flat"} off combo labour`}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Racket + string combo</Label>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
              {(
                [
                  { v: "off", label: "Off" },
                  { v: "waive_labour", label: "Waive labour" },
                  { v: "percent", label: "% off labour" },
                  { v: "amount", label: "Flat off" },
                ] as const
              ).map((o) => (
                <button
                  key={o.v}
                  onClick={() => patch({ comboRule: o.v })}
                  className={`rounded-md border border-border px-2 py-2 text-xs ${
                    rules.comboRule === o.v
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1"><Label className="text-xs text-muted-foreground">Combo discount value</Label><HelpTip label="About combo discount value" text="Applied to the labour line when a stock racket and a stock string are both on the job." /></div>
            <DecimalSettingInput
              className="numeric text-right"
              disabled={rules.comboRule !== "percent" && rules.comboRule !== "amount"}
              value={rules.comboValue}
              onValueChange={(comboValue) => patch({ comboValue })}
              placeholder="0"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Labour-price overrides require the user's Price override permission, configured in Staff &amp; Permissions.</p>
      </Section>

      <Section
        title="Service terms & high-tension liability"
        blurb="Shown at racket intake and printed on job tags and settlement receipts."
        summary={`Acceptance ${rules.requireLiabilityAccept ? "required" : "optional"} · Warning above ${rules.highTensionThreshold} ${rules.defaultTensionUnit}`}
      >
        <p className="text-sm text-muted-foreground">Edit the printed liability wording in <Link to="/settings/booking-slip" className="font-semibold text-primary underline">Booking receipt settings → Service / liability terms</Link>.</p>
        <Row
          label="Require the liability agreement at intake"
          hint="A racket job cannot be saved until the customer has accepted the terms."
        >
          <Switch
            aria-label="Require the liability agreement at intake"
            checked={rules.requireLiabilityAccept}
            onCheckedChange={(v) => patch({ requireLiabilityAccept: v })}
          />
        </Row>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            High-tension warning above ({rules.defaultTensionUnit})
          </Label>
          <DecimalSettingInput
            className="numeric text-right"
            value={rules.highTensionThreshold}
            onValueChange={(highTensionThreshold) => patch({ highTensionThreshold })}
            placeholder="26"
          />
        </div>
      </Section>


    </div>
  );
}
