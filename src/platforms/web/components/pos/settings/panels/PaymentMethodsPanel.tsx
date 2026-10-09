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
import { Loader2, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
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
} from "@/core/types/payment-types";

export function PaymentMethodsPanel() {
  const [rows, setRows] = useState<PaymentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const save = async () => {
    if (busy) return;
    setBusy("saving");
    let res: Awaited<ReturnType<typeof savePaymentTypes>>;
    try {
      res = await savePaymentTypes(rows);
    } catch (e) {
      setBusy(null);
      toast.error(`Could not save the payment method: ${message(e)}`);
      return;
    }
    setBusy(null);
    if (!res.success) {
      toast.error(res.error ?? "Could not save the payment method");
      return;
    }
    toast.success("Payment methods saved");
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
    setRows(current => current.filter(item => item.id !== row.id));
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
    <fieldset disabled={busy !== null} className="space-y-3">
      {rows.map((row) => (
        <div key={row.id} className="space-y-3 rounded-lg border border-border/60 p-3">
          <div className="flex items-center gap-2">
            <Input
              value={row.name}
              placeholder="Method name"
              onChange={(e) =>
                patch(row.id, {
                  name: e.target.value,
                  code: row.code || paymentCodeFrom(e.target.value),
                })
              }
              className="h-9"
            />
            {row.system && <Badge variant="secondary">Built in</Badge>}
            <div className="flex items-center gap-2">
              <Switch
                checked={row.active}
                onCheckedChange={(v) => patch(row.id, { active: v })}
                aria-label="Available at checkout"
              />
              <span className="text-xs text-muted-foreground">
                {row.active ? "Available" : "Hidden"}
              </span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
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
                aria-label="Requires a serial or reference number"
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
        </div>
      ))}

      <Button
        variant="outline"
        onClick={() =>
          setRows((rs) => [...rs, blankPaymentType(((rs.at(-1)?.sort ?? 0) as number) + 10)])
        }
      >
        <Plus className="mr-1 size-4" /> Add payment method
      </Button>
      <Button onClick={() => void save()} disabled={busy !== null}>
        {busy === "saving" ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Save className="mr-1 size-4" />}
        Save all payment methods
      </Button>
      <p className="text-xs text-muted-foreground">
        Display order controls the checkout buttons: lower numbers appear first. Use 15 to place a method between 10 and 20.
      </p>
      <p className="text-xs text-muted-foreground">
        A method marked “needs a serial / voucher number” makes the cashier type the voucher or slip
        reference before the sale can be completed. That reference is stored against the bill.
      </p>
    </fieldset>
  );
}
