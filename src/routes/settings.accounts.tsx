/**
 * Where the money lands.
 *
 * Shops run several card machines, bank accounts and e-wallets. Naming them
 * here lets the cashier pick the exact one at the till, so end-of-day
 * reconciliation matches each machine's own settlement report.
 */
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SettingsFrame } from "@/platforms/web/components/pos/settings/SettingsFrame";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { usePos } from "@/lib/pos-store";
import {
  PAYMENT_ACCOUNT_LABELS,
  type PaymentAccount,
  type PaymentAccountType,
} from "@/core/types/pos-types";

export const Route = createFileRoute("/settings/accounts")({
  head: () => ({
    meta: [
      { title: "Payment Accounts — Retail" },
      {
        name: "description",
        content:
          "Name every card machine, bank account and e-wallet so cashiers can record exactly where each payment landed.",
      },
      { property: "og:title", content: "Payment Accounts — Retail" },
      {
        property: "og:description",
        content: "Card machines, bank accounts and e-wallets for the till.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <SettingsFrame
      title="Payment accounts"
      description="List your card machines, bank accounts and e-wallets. Cashiers pick one when taking a card, transfer or wallet payment."
      scopeSections={["paymentAccounts"]}
    >
      <AccountsForm />
    </SettingsFrame>
  ),
});

function AccountsForm() {
  const { state, stores, updateSettings } = usePos();
  const integrations = state.settings.integrations;
  const accounts = integrations.paymentAccounts ?? [];

  const save = (next: PaymentAccount[]) =>
    updateSettings({ integrations: { ...integrations, paymentAccounts: next } });

  const patch = (id: string, p: Partial<PaymentAccount>) =>
    save(accounts.map((a) => (a.id === id ? { ...a, ...p } : a)));

  const add = () => {
    save([
      ...accounts,
      {
        id: crypto.randomUUID(),
        name: "",
        type: "card_machine",
        active: true,
        storeIds: [],
      },
    ]);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
        <div>
          <p className="text-sm">Ask for an account at the till</p>
          <p className="text-xs text-muted-foreground">
            Card, transfer and wallet tenders get a dropdown of the accounts below.
          </p>
        </div>
        <Switch
          aria-label="Ask for an account at the till"
          checked={!!integrations.usePaymentAccounts}
          onCheckedChange={(v) =>
            updateSettings({ integrations: { ...integrations, usePaymentAccounts: v } })
          }
        />
      </div>

      {accounts.map((a) => (
        <div key={a.id} className="space-y-3 rounded-md border border-border p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Name shown to the cashier</Label>
              <Input
                placeholder="Front counter Visa terminal"
                value={a.name}
                onChange={(e) => patch(a.id, { name: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Type</Label>
              <ThemedSelect
                ariaLabel={`Type for ${a.name || "new account"}`}
                value={a.type}
                onChange={(v) => patch(a.id, { type: v as PaymentAccountType })}
                options={(Object.keys(PAYMENT_ACCOUNT_LABELS) as PaymentAccountType[]).map((t) => ({
                  value: t,
                  label: PAYMENT_ACCOUNT_LABELS[t],
                }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Bank / provider</Label>
              <Input
                placeholder="Maybank"
                value={a.bankName ?? ""}
                onChange={(e) => patch(a.id, { bankName: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Account / terminal number</Label>
              <Input
                className="numeric"
                value={a.accountNumber ?? ""}
                onChange={(e) => patch(a.id, { accountNumber: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Available at (leave empty for every branch)
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {stores.map((s) => {
                const on = (a.storeIds ?? []).includes(s.id);
                return (
                  <Button
                    key={s.id}
                    type="button"
                    size="sm"
                    variant={on ? "default" : "outline"}
                    className="h-7 px-2 text-[11px]"
                    onClick={() =>
                      patch(a.id, {
                        storeIds: on
                          ? (a.storeIds ?? []).filter((x) => x !== s.id)
                          : [...(a.storeIds ?? []), s.id],
                      })
                    }
                  >
                    {s.name}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch
                aria-label={`${a.name || "Account"} active`}
                checked={a.active}
                onCheckedChange={(v) => patch(a.id, { active: v })}
              />
              Active
            </label>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                save(accounts.filter((x) => x.id !== a.id));
                toast.success("Account removed");
              }}
            >
              <Trash2 className="size-3 text-destructive" /> Remove
            </Button>
          </div>
        </div>
      ))}

      {accounts.length === 0 && (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          No accounts yet — add your first card machine or bank account.
        </p>
      )}

      <Button size="sm" onClick={add}>
        <Plus className="size-3" /> Add account
      </Button>
    </div>
  );
}
