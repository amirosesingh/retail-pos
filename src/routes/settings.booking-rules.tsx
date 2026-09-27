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
import { SettingsFrame } from "@/platforms/web/components/pos/settings/SettingsFrame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { usePos } from "@/lib/pos-store";
import { bookingRulesOf, DEFAULT_SERVICE_TERMS, type BookingRules } from "@/core/types/pos-types";

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
        <p className="text-sm">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Section({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{blurb}</p>
      </div>
      {children}
    </section>
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
        <p className="text-sm">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
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
  const { state, updateSettings } = usePos();
  const integrations = state.settings.integrations;
  const rules = bookingRulesOf(integrations.bookingRules);

  const patch = (p: Partial<BookingRules>) =>
    updateSettings({ integrations: { ...integrations, bookingRules: { ...rules, ...p } } });

  const setList = (key: "racketModels" | "stringModels", next: string[]) =>
    updateSettings({ integrations: { ...integrations, [key]: next } });

  const num = (v: string) => Math.max(0, Number(v) || 0);

  return (
    <div className="space-y-6">
      <Section
        title="Deposits & payment"
        blurb="What has to be collected before a job leaves the counter."
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
            <Input
              className="numeric text-right"
              inputMode="decimal"
              value={rules.depositMin || ""}
              onChange={(e) => patch({ depositMin: num(e.target.value) })}
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

      <Section title="Scheduling" blurb="How the ready-by date and time are proposed and policed.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Default turnaround (hours)</Label>
            <Input
              className="numeric text-right"
              inputMode="numeric"
              value={rules.defaultTurnaroundHours || ""}
              onChange={(e) => patch({ defaultTurnaroundHours: num(e.target.value) })}
              placeholder="48"
            />
            <p className="text-xs text-muted-foreground">
              Pre-fills the ready-by box. 0 leaves it blank.
            </p>
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
          <Label className="text-xs text-muted-foreground">
            Flag uncollected bookings after (days)
          </Label>
          <Input
            className="numeric text-right"
            inputMode="numeric"
            value={rules.staleAfterDays || ""}
            onChange={(e) => patch({ staleAfterDays: num(e.target.value) })}
            placeholder="0"
          />
          <p className="text-xs text-muted-foreground">0 never flags a booking as abandoned.</p>
        </div>
      </Section>

      <Section
        title="Racket / stringing jobs"
        blurb="What a job card carries before it can be saved."
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
            <Input
              className="numeric text-right"
              inputMode="decimal"
              value={rules.defaultTensionMain || ""}
              onChange={(e) => patch({ defaultTensionMain: num(e.target.value) })}
              placeholder="26"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Default cross</Label>
            <Input
              className="numeric text-right"
              inputMode="decimal"
              value={rules.defaultTensionCross || ""}
              onChange={(e) => patch({ defaultTensionCross: num(e.target.value) })}
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
          <Label className="text-xs text-muted-foreground">Locked base labour fee</Label>
          <Input
            className="numeric text-right"
            inputMode="decimal"
            value={integrations.baseLaborFee || ""}
            onChange={(e) =>
              updateSettings({
                integrations: { ...integrations, baseLaborFee: num(e.target.value) },
              })
            }
            placeholder="0.00"
          />
          <p className="text-xs text-muted-foreground">
            Pre-filled and read-only on the intake screen. Cashiers must override it to change it.
          </p>
        </div>
      </Section>

      <Section
        title="Combo & overrides"
        blurb="What happens when a racket and string are bought together, and who may unlock the labour fee."
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
            <Label className="text-xs text-muted-foreground">Combo discount value</Label>
            <Input
              className="numeric text-right"
              inputMode="decimal"
              disabled={rules.comboRule !== "percent" && rules.comboRule !== "amount"}
              value={rules.comboValue || ""}
              onChange={(e) => patch({ comboValue: num(e.target.value) })}
              placeholder="0"
            />
            <p className="text-xs text-muted-foreground">
              Applied to the labour line when a stock racket and a stock string are both on the job.
            </p>
          </div>
        </div>
        <Row
          label="Overriding the labour fee needs a supervisor"
          hint="Off means a written reason is enough."
        >
          <Switch
            aria-label="Overriding the labour fee needs a supervisor"
            checked={rules.overrideNeedsSupervisor}
            onCheckedChange={(v) => patch({ overrideNeedsSupervisor: v })}
          />
        </Row>
      </Section>

      <Section
        title="Service terms & high-tension liability"
        blurb="Shown on the racket intake form and printed on job tags and settlement receipts."
      >
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            Service terms &amp; high-tension liability disclaimer
          </Label>
          <Textarea
            rows={5}
            value={rules.serviceTerms}
            onChange={(e) => patch({ serviceTerms: e.target.value })}
            placeholder={DEFAULT_SERVICE_TERMS}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => patch({ serviceTerms: DEFAULT_SERVICE_TERMS })}
            >
              Restore default wording
            </Button>
          </div>
        </div>
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
          <Input
            className="numeric text-right"
            inputMode="decimal"
            value={rules.highTensionThreshold || ""}
            onChange={(e) => patch({ highTensionThreshold: num(e.target.value) })}
            placeholder="26"
          />
        </div>
      </Section>

      <Section title="Control" blurb="Who may undo or re-spec a booking once it exists.">
        <Row
          label="Only supervisors may cancel a booking"
          hint="Cashiers can raise and collect bookings, but not cancel them."
        >
          <Switch
            aria-label="Only supervisors may cancel a booking"
            checked={rules.managerOnlyCancel}
            onCheckedChange={(v) => patch({ managerOnlyCancel: v })}
          />
        </Row>
        <Row
          label="Only supervisors may edit specs after a deposit"
          hint="Once money is held, tension and string changes need a supervisor."
        >
          <Switch
            aria-label="Only supervisors may edit specs after a deposit"
            checked={rules.managerOnlyEditPaidSpecs}
            onCheckedChange={(v) => patch({ managerOnlyEditPaidSpecs: v })}
          />
        </Row>
      </Section>
    </div>
  );
}
