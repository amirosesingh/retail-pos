import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import { CardMachineSelect } from "./CardMachineSelect";
import {
  paymentsLabel,
  validateTenders,
  type Payment,
  type PaymentMethod,
} from "@/core/types/pos-types";
import { activePaymentTypes, usePaymentTypes } from "@/core/types/payment-types";
import { usePos } from "@/lib/pos-store";
import { notifyError } from "@/lib/notify";

const RECENT_BANKS_KEY = "pos.recent-banks";
const money = (n: number) => n.toFixed(2);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Card machines used recently on this terminal, offered as datalist hints. */
export function readRecentBanks(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_BANKS_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function rememberBanks(names: string[]) {
  if (typeof window === "undefined") return;
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return;
  const merged = [...new Set([...clean, ...readRecentBanks()])].slice(0, 8);
  try {
    window.localStorage.setItem(RECENT_BANKS_KEY, JSON.stringify(merged));
  } catch {
    /* private mode — suggestions are a nicety, never a blocker */
  }
}

type Props = {
  total: number;
  tenders: Payment[];
  onChange: (next: Payment[]) => void;
  /** guarded by can_edit_tenders in the caller; return false to refuse */
  onBeforeAdd?: () => Promise<boolean> | boolean;
};

/**
 * Part-payment editor: take some of the bill in cash and the rest on any
 * other tender. Every line shows how much of the bill is still outstanding.
 */
export function TenderSplit({ total, tenders, onChange, onBeforeAdd }: Props) {
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => setRecent(readRecentBanks()), []);

  // Tenders come from the configurable payment-types list, so a new collection
  // method is available at the till the moment an administrator saves it.
  const { types } = usePaymentTypes();
  const methods = activePaymentTypes(types);
  const needsReference = (code: string) =>
    !!methods.find((m) => m.code === code)?.requiresReference;

  // Named card machines / bank accounts, so takings can be reconciled per
  // machine at close of day.
  const { state, currentStore } = usePos();
  const useAccounts = !!state.settings.integrations.usePaymentAccounts;
  const accounts = (state.settings.integrations.paymentAccounts ?? []).filter(
    (a) =>
      a.active &&
      a.name.trim() &&
      (!a.storeIds || a.storeIds.length === 0 || a.storeIds.includes(currentStore.id)),
  );

  const check = validateTenders(total, tenders);
  const outstanding = check.balance;

  const patch = (i: number, next: Partial<Payment>) =>
    onChange(tenders.map((t, ti) => (ti === i ? { ...t, ...next } : t)));

  const addTender = async () => {
    // The manager-override check can fail on a dropped connection; a payment
    // line must never appear unless that check actually passed.
    try {
      if (onBeforeAdd && !(await onBeforeAdd())) return;
      const next =
        tenders.length === 0 ? (methods[0]?.code ?? "cash") : (methods[1]?.code ?? "card");
      onChange([
        ...tenders,
        {
          id: crypto.randomUUID(),
          method: next,
          amount: outstanding,
          ...(needsReference(next) ? { requiresReference: true } : {}),
        },
      ]);
    } catch (e) {
      notifyError(e, "Could not add the payment line");
    }
  };

  /** Remaining for a given line = bill total minus every other line. */
  const remainingFor = (i: number) =>
    r2(Math.max(0, total - tenders.reduce((a, t, ti) => (ti === i ? a : a + (t.amount || 0)), 0)));

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Split across tenders
        </p>
        <Button size="sm" variant="outline" onClick={() => void addTender()}>
          <Plus className="size-3" /> Add tender
        </Button>
      </div>

      {tenders.length > 0 && (
        <div className="numeric flex items-center justify-between rounded-md bg-muted/50 px-2 py-1.5 text-xs">
          <span>Paid so far {money(check.paid)}</span>
          <span
            className={
              outstanding > 0 ? "font-semibold text-destructive" : "font-semibold text-primary"
            }
          >
            {outstanding > 0
              ? `Balance due ${money(outstanding)}`
              : `Change ${money(check.change)}`}
          </span>
        </div>
      )}

      <datalist id="recent-card-machines">
        {recent.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>

      {tenders.map((t, i) => {
        const remaining = remainingFor(i);
        return (
          <div key={t.id} className="space-y-1.5 rounded-md border border-border/60 p-2">
            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={t.method}
                  onChange={(e) => {
                    const code = e.target.value as PaymentMethod;
                    patch(i, {
                      method: code,
                      requiresReference: needsReference(code),
                      accountId: undefined,
                      bankName: undefined,
                    });
                  }}
                  className="h-9 rounded-md border border-border bg-background px-2 text-xs"
                >
                  {methods.map((m) => (
                    <option key={m.code} value={m.code}>
                      {m.name}
                    </option>
                  ))}
                </select>
                {t.method === "card" ? (
                  <CardMachineSelect
                    accountId={t.accountId}
                    bankName={t.bankName ?? ""}
                    onChange={(value) => patch(i, value)}
                  />
                ) : (
                  <Input
                    value={t.reference ?? t.ref ?? ""}
                    onChange={(e) => patch(i, { reference: e.target.value, ref: e.target.value })}
                    placeholder={needsReference(t.method) ? "Serial / reference *" : "Reference"}
                    className="h-9 text-xs"
                    aria-invalid={needsReference(t.method) && !(t.reference ?? t.ref ?? "").trim()}
                  />
                )}
              </div>
              <Input
                value={t.amount || ""}
                inputMode="decimal"
                onChange={(e) => {
                  const raw = Number(e.target.value) || 0;
                  // Only cash may overpay — everything else is capped at the balance.
                  patch(i, {
                    amount: t.method === "cash" ? r2(raw) : r2(Math.min(raw, remaining)),
                  });
                }}
                className="numeric h-9 w-24 text-right"
              />
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                onClick={() => onChange(tenders.filter((_, ti) => ti !== i))}
              >
                <X className="size-3" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {useAccounts && t.method !== "cash" && t.method !== "card" && accounts.length > 0 && (
                <ThemedSelect
                  ariaLabel="Payment account"
                  className="h-7 w-full text-[11px]"
                  placeholder="Which account received it?"
                  value={t.accountId ?? ""}
                  onChange={(v) => {
                    const acc = accounts.find((a) => a.id === v);
                    patch(i, {
                      accountId: v,
                      ...(acc?.bankName || acc ? { bankName: acc?.bankName || acc?.name } : {}),
                    });
                  }}
                  options={accounts.map((a) => ({
                    value: a.id,
                    label: a.bankName ? `${a.name} · ${a.bankName}` : a.name,
                  }))}
                />
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px]"
                onClick={() => patch(i, { amount: r2(total / 2) })}
              >
                Half {money(r2(total / 2))}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px]"
                onClick={() => patch(i, { amount: remaining })}
              >
                Remaining {money(remaining)}
              </Button>
              {t.method === "cash" &&
                [20, 50, 100].map((v) => (
                  <Button
                    key={v}
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => patch(i, { amount: v })}
                  >
                    {money(v)}
                  </Button>
                ))}
            </div>
          </div>
        );
      })}

      {tenders.length > 0 && (
        <p className="numeric text-[11px] text-muted-foreground">{paymentsLabel(tenders)}</p>
      )}
      {tenders.length > 0 && check.error && (
        <p className="text-[11px] font-medium text-destructive">{check.error}</p>
      )}
    </div>
  );
}
