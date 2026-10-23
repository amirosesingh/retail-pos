import { Table } from "@/components/ui/table";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Crown, Gift, Pencil, Percent, Plus, Sparkles, Trash2, Trophy } from "lucide-react";
import { toast } from "sonner";
import { notifyError } from "@/lib/notify";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { money, usePos } from "@/lib/pos-store";
import { useAuth } from "@/lib/pos-auth";
import { isLive } from "@/lib/pos-promotions";
import type { DiscountType, MemberTier, PromoType, Promotion } from "@/core/types/pos-types";

export const Route = createFileRoute("/promotions")({
  head: () => ({
    meta: [
      { title: "Promotions & Discounts — Retail" },
      {
        name: "description",
        content:
          "Configure loyalty point policies, free-of-charge gifts, birthday discounts and spend-threshold offers applied live at the register.",
      },
      { property: "og:title", content: "Promotions & Discounts — Retail" },
      {
        property: "og:description",
        content: "Point policies, FOC gifts, birthday and threshold discount rules.",
      },
    ],
  }),
  component: Promotions,
});

const typeLabel: Record<PromoType, string> = {
  points: "Flexible point policy",
  foc: "FOC (free item)",
  birthday: "Birthday discount",
  threshold: "Threshold discount",
  tier: "Membership tier discount",
};

const typeIcon: Record<PromoType, typeof Percent> = {
  points: Trophy,
  foc: Gift,
  birthday: Sparkles,
  threshold: Percent,
  tier: Crown,
};

const TIERS: MemberTier[] = ["Bronze", "Silver", "Gold"];

const blank = (): Promotion => ({
  id: crypto.randomUUID(),
  name: "",
  type: "points",
  active: true,
  pointsPerDollar: 1,
  minBill: 100,
  focQty: 1,
  value: 10,
  valueType: "percent",
  tierRates: { Bronze: 5, Silver: 10, Gold: 15 },
});

function Promotions() {
  const { state, upsertPromotion, removePromotion, togglePromotion } = usePos();
  const { can } = useAuth();
  const [draft, setDraft] = useState<Promotion | null>(null);

  const rules = state.promotions;

  function summary(p: Promotion) {
    switch (p.type) {
      case "points":
        return `${p.pointsPerDollar ?? 1} pt per $1 spent`;
      case "foc": {
        const product = state.products.find((x) => x.id === p.focProductId);
        return `Spend ${money(p.minBill ?? 0)} → free ${p.focQty ?? 1} × ${product?.name ?? "—"}`;
      }
      case "birthday":
        return `${p.value ?? 0}% off during the member's birthday month`;
      case "threshold":
        return `Spend ${money(p.minBill ?? 0)} → ${
          p.valueType === "percent" ? `${p.value ?? 0}% off` : `${money(p.value ?? 0)} off`
        }`;
      case "tier":
        return TIERS.map((t) => `${t}: ${p.tierRates?.[t] ?? 0}%`).join(" · ");
    }
  }

  if (!can("can_manage_promotions")) {
    return (
      <AppShell>
        <div className="p-6">
          <h1 className="text-2xl font-semibold">Promotions & discounts</h1>
          <p className="mt-2 text-sm text-muted-foreground page-description">
            You do not have permission to manage promotion rules. Active offers are applied automatically
            on your register.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="pos-page-container">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Promotions & discounts</h1>
            <p className="text-sm text-muted-foreground page-description">
              {rules.filter((p) => isLive(p)).length} live · {rules.length} rules configured
            </p>
          </div>
          <Button onClick={() => setDraft(blank())}>
            <Plus className="size-4" /> Add promotion / rule
          </Button>
        </header>

        <div className="overflow-x-auto rounded-lg border border-border">
          <Table tableId="routes/promotions.native#1" clientDataControls={false} className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Rule</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Configuration</th>
                <th className="px-3 py-2">Window</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rules.map((p) => {
                const Icon = typeIcon[p.type];
                const live = isLive(p);
                return (
                  <tr key={p.id} className="align-middle">
                    <td className="px-3 py-2">
                      <button
                        className="font-medium hover:text-primary"
                        onClick={() => setDraft(p)}
                      >
                        {p.name || "Untitled rule"}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Icon className="size-4" /> {typeLabel[p.type]}
                      </span>
                    </td>
                    <td className="numeric px-3 py-2 text-xs">{summary(p)}</td>
                    <td className="numeric px-3 py-2 text-xs text-muted-foreground">
                      {p.startDate || "—"} → {p.endDate || "—"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={p.active}
                          onCheckedChange={(v) => {
                            void togglePromotion(p.id, v).catch((error) =>
                              notifyError(error, "Updating promotion"),
                            );
                          }}
                          aria-label={`Toggle ${p.name}`}
                        />
                        <Badge
                          variant="outline"
                          className={
                            live
                              ? "border-success/40 bg-success/10 text-success"
                              : "text-muted-foreground"
                          }
                        >
                          {p.active ? (live ? "Active" : "Out of window") : "Inactive"}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Edit ${p.name || "promotion"}`}
                        title="Edit promotion"
                        onClick={() => setDraft(p)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete ${p.name || "promotion"}`}
                        title="Delete promotion"
                        onClick={async () => {
                          try {
                            await removePromotion(p.id);
                            toast.success("Promotion removed");
                          } catch (error) {
                            notifyError(error, "Removing promotion");
                          }
                        }}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {!rules.length && (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">
                    No promotion rules yet.
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </div>
      </div>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.name ? "Edit promotion" : "Add promotion / rule"}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1">
                <Label className="text-xs text-muted-foreground">Rule name</Label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Double points weekend"
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs text-muted-foreground">Promo type</Label>
                <ThemedSelect
                  ariaLabel="Promo type"
                  value={draft.type}
                  onChange={(v) => setDraft({ ...draft, type: v as PromoType })}
                  options={(Object.keys(typeLabel) as PromoType[]).map((t) => ({
                    value: t,
                    label: typeLabel[t],
                  }))}
                />
              </div>

              <div className="col-span-2 space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Partner / collaborator (optional)
                </Label>
                <Input
                  value={draft.partner ?? ""}
                  onChange={(e) => setDraft({ ...draft, partner: e.target.value })}
                  placeholder="e.g. Sarah — Instagram"
                />
                <p className="text-[11px] text-muted-foreground">
                  Coupon redemptions from this rule are grouped under this name in the Coupon Usage
                  report, so collaboration payouts are easy to total.
                </p>
              </div>

              {draft.type === "points" && (
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs text-muted-foreground">Points per $1 spent</Label>
                  <Input
                    className="numeric"
                    value={draft.pointsPerDollar ?? 1}
                    onChange={(e) =>
                      setDraft({ ...draft, pointsPerDollar: Number(e.target.value) || 0 })
                    }
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Applies immediately to every future transaction.
                  </p>
                </div>
              )}

              {draft.type === "foc" && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Minimum bill</Label>
                    <Input
                      className="numeric"
                      value={draft.minBill ?? 0}
                      onChange={(e) => setDraft({ ...draft, minBill: Number(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Free quantity</Label>
                    <Input
                      className="numeric"
                      value={draft.focQty ?? 1}
                      onChange={(e) => setDraft({ ...draft, focQty: Number(e.target.value) || 1 })}
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs text-muted-foreground">Free product</Label>
                    <ThemedSelect
                      ariaLabel="Free product"
                      placeholder="Select a product…"
                      value={draft.focProductId ?? ""}
                      onChange={(v) => setDraft({ ...draft, focProductId: v })}
                      options={state.products.map((p) => ({
                        value: p.id,
                        label: `${p.name} · ${money(p.price)}`,
                      }))}
                    />
                  </div>
                </>
              )}

              {draft.type === "tier" && (
                <div className="col-span-2 space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Discount percent by membership tier
                  </Label>
                  <div className="grid grid-cols-3 gap-2">
                    {TIERS.map((t) => (
                      <div key={t} className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">{t}</Label>
                        <Input
                          className="numeric"
                          value={draft.tierRates?.[t] ?? 0}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              tierRates: {
                                ...{ Bronze: 0, Silver: 0, Gold: 0 },
                                ...(draft.tierRates ?? {}),
                                [t]: Number(e.target.value) || 0,
                              },
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Auto-applies at the register as soon as a member is attached to the ticket.
                  </p>
                </div>
              )}
              {draft.type === "birthday" && (
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs text-muted-foreground">Discount percent</Label>
                  <Input
                    className="numeric"
                    value={draft.value ?? 0}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        value: Number(e.target.value) || 0,
                        valueType: "percent",
                      })
                    }
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Triggers when the attached member's birthday month matches the current month.
                  </p>
                </div>
              )}

              {draft.type === "threshold" && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Minimum bill</Label>
                    <Input
                      className="numeric"
                      value={draft.minBill ?? 0}
                      onChange={(e) => setDraft({ ...draft, minBill: Number(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Discount value</Label>
                    <div className="flex items-center gap-1">
                      <Input
                        className="numeric"
                        value={draft.value ?? 0}
                        onChange={(e) => setDraft({ ...draft, value: Number(e.target.value) || 0 })}
                      />
                      <div className="flex overflow-hidden rounded-md border border-border">
                        {(["amount", "percent"] as DiscountType[]).map((t) => (
                          <button
                            key={t}
                            onClick={() => setDraft({ ...draft, valueType: t })}
                            className={`px-2 py-1.5 text-xs ${
                              (draft.valueType ?? "amount") === t
                                ? "bg-primary/15 text-primary"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {t === "amount" ? "$" : "%"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Start date (optional)</Label>
                <Input
                  type="date"
                  value={draft.startDate ?? ""}
                  onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">End date (optional)</Label>
                <Input
                  type="date"
                  value={draft.endDate ?? ""}
                  onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
                />
              </div>
              <div className="col-span-2 flex items-center justify-between rounded-md border border-border px-3 py-2">
                <span className="text-sm">Active</span>
                <Switch
                  checked={draft.active}
                  onCheckedChange={(v) => setDraft({ ...draft, active: v })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              onClick={async () => {
                if (!draft) return;
                if (!draft.name.trim()) {
                  toast.error("Rule name is required");
                  return;
                }
                if (draft.type === "foc" && !draft.focProductId) {
                  toast.error("Select the free product for this rule");
                  return;
                }
                try {
                  await upsertPromotion(draft);
                  setDraft(null);
                  toast.success("Promotion saved");
                } catch (e) {
                  notifyError(e, "Saving the promotion");
                }
              }}
            >
              Save promotion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
