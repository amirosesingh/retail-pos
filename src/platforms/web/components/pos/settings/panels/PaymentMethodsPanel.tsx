/**
 * Payment Methods manager.
 *
 * The tenders offered at the till are data, not code: an administrator can add
 * a new collection type, rename one, reorder the buttons, mark one as needing a
 * serial number (government vouchers, coupons, transfer slips), switch one off
 * for a while, or delete it outright. Historical bills keep the method code
 * they were taken on, so reports stay intact after a tender is retired.
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Plus, RefreshCw, Save, Search, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  blankPaymentType,
  deletePaymentType,
  loadEditablePaymentTypes,
  paymentCodeFrom,
  savePaymentTypes,
  type PaymentType,
  tenderIcon,
} from "@/core/types/payment-types";

export function PaymentMethodsPanel() {
  const [rows, setRows] = useState<PaymentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);

  const message = (e: unknown) => (e instanceof Error ? e.message : "Could not reach the database");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setRows(await loadEditablePaymentTypes());
    } catch (e) {
      setLoadError(message(e));
      toast.error(`Could not load the payment methods: ${message(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (id: string, p: Partial<PaymentType>) =>
    { setSaved(false); setSaveError(""); setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r))); };

  const save = async () => {
    if (busy) return;
    setBusy("saving");
    setSaveError("");
    let res: Awaited<ReturnType<typeof savePaymentTypes>>;
    try {
      res = await savePaymentTypes(rows);
    } catch (e) {
      setBusy(null);
      setSaveError(message(e));
      toast.error(`Could not save the payment method: ${message(e)}`);
      return;
    }
    setBusy(null);
    if (!res.success) {
      setSaveError(res.error ?? "Could not save the payment methods");
      toast.error(res.error ?? "Could not save the payment method");
      return;
    }
    toast.success("Payment methods saved");
    setSaved(true);
  };

  const remove = async (row: PaymentType) => {
    if (busy) return;
    if (!window.confirm(`Delete "${row.name}"? Past bills taken on it keep their record.`)) return;
    setBusy(row.id);
    let res: Awaited<ReturnType<typeof deletePaymentType>>;
    try {
      res = await deletePaymentType(row.id);
    } catch (e) {
      setBusy(null);
      // The row stays on screen: nothing was removed in the database.
      toast.error(`Could not delete the payment method: ${message(e)}`);
      return;
    }
    setBusy(null);
    if (!res.success) {
      toast.error(res.error ?? "Could not delete the payment method");
      return;
    }
    toast.success("Payment method deleted");
    setSaved(false);
    setRows((current) => current.filter((item) => item.id !== row.id));
  };

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading payment methods…
      </p>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-3 rounded-lg border border-destructive/40 p-4">
        <p className="text-sm font-medium">The payment methods could not be loaded.</p>
        <p className="text-xs text-muted-foreground">{loadError}</p>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          <RefreshCw className="mr-1 size-3.5" /> Try again
        </Button>
      </div>
    );
  }

  return (
    <fieldset disabled={busy !== null} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-primary/5 p-4">
        <div className="flex items-center gap-3"><Wallet className="size-5 shrink-0 text-primary" /><div><p className="text-sm font-semibold">Checkout methods</p><p className="text-xs text-muted-foreground">{rows.filter(row => row.active).length} available · {rows.length} total</p></div></div>
        <div className="relative w-full sm:w-60"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search payment methods" placeholder="Find a method…" value={query} onChange={event => setQuery(event.target.value)} className="h-10 pl-9" /></div>
      </div>
      {rows.filter(row => `${row.name} ${row.code}`.toLowerCase().includes(query.trim().toLowerCase())).map((row) => {
        const Icon = tenderIcon(row.icon, row.code);
        return <div key={row.id} className="space-y-4 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-5" /></span>
            <Input
              value={row.name}
              placeholder="Method name"
              onChange={(e) =>
                patch(row.id, {
                  name: e.target.value,
                  code: row.code || paymentCodeFrom(e.target.value),
                })
              }
              aria-label={`Name for ${row.code || "new payment method"}`}
              className="h-10 min-w-32 flex-1"
            />
            {row.system && <Badge variant="secondary">Built in</Badge>}
            <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
              <Switch
                checked={row.active}
                onCheckedChange={(v) => patch(row.id, { active: v })}
                aria-label={`${row.name || "Payment method"} available at checkout`}
              />
              <span className="text-xs text-muted-foreground">
                {row.active ? "Available" : "Hidden"}
              </span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Code</Label>
              <Input
                value={row.code}
                disabled={row.system}
                onChange={(e) => patch(row.id, { code: paymentCodeFrom(e.target.value) })}
                className="h-9 font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Icon</Label>
              <Input
                value={row.icon}
                onChange={(e) => patch(row.id, { icon: e.target.value })}
                placeholder="Wallet"
                className="h-9 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Display order</Label>
              <Input
                value={row.sort}
                type="number"
                step={1}
                inputMode="numeric"
                onChange={(e) =>
                  patch(row.id, { sort: Number.isFinite(+e.target.value) ? +e.target.value : 0 })
                }
                className="numeric h-9"
              />
            </div>
            <div className="flex items-end gap-2 pb-1">
              <Switch
                checked={row.requiresReference}
                onCheckedChange={(v) => patch(row.id, { requiresReference: v })}
                aria-label={`${row.name || "Payment method"} requires a serial or reference number`}
              />
              <span className="text-xs text-muted-foreground">Needs a serial / voucher number</span>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            {!row.system && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void remove(row)}
                disabled={busy === row.id}
              >
                <Trash2 className="mr-1 size-3.5" /> Delete
              </Button>
            )}
          </div>
        </div>;
      })}
      {!!query.trim() && !rows.some(row => `${row.name} ${row.code}`.toLowerCase().includes(query.trim().toLowerCase())) && <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">No matching payment methods. Clear the search to see all methods.</p>}

      {saveError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{saveError}</p>}
      {saved && <p role="status" className="flex items-center gap-2 text-sm text-emerald-600"><CheckCircle2 className="size-4" />Payment methods saved</p>}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/30 p-3">
      <Button
        variant="outline"
        size="sm"
        className="h-10"
        onClick={() => { setQuery(""); setSaved(false); setRows((rs) => [...rs, blankPaymentType(((rs.at(-1)?.sort ?? 0) as number) + 10)]); }}
      >
        <Plus className="mr-1 size-4" /> Add payment method
      </Button>
      <Button size="sm" className="h-10" onClick={() => void save()} disabled={busy !== null}>
        {busy === "saving" ? (
          <Loader2 className="mr-1 size-4 animate-spin" />
        ) : (
          <Save className="mr-1 size-4" />
        )}
        Save all payment methods
      </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Display order controls the checkout buttons: lower numbers appear first. Use 15 to place a
        method between 10 and 20.
      </p>
      <p className="text-xs text-muted-foreground">
        A method marked “needs a serial / voucher number” makes the cashier type the voucher or slip
        reference before the sale can be completed. That reference is stored against the bill.
      </p>
    </fieldset>
  );
}
