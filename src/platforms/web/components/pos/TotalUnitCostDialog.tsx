import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/pos-auth";
import { usePos } from "@/lib/pos-store";
import { emptyUnitCostSettings, updateUnitCostRules, validUnitCostRule } from "@/lib/total-unit-cost";
import { notifyError } from "@/lib/notify";

export function TotalUnitCostDialog({ open, onOpenChange, selected }: { open: boolean; onOpenChange: (open: boolean) => void; selected: string[] }) {
  const { state, updateGlobalSettings, saveConfiguredSettings } = usePos();
  const { isAdmin, can } = useAuth();
  const settings = state.settings.integrations.totalUnitCost ?? emptyUnitCostSettings;
  const [target, setTarget] = useState<"default" | "selected" | "reset">("default");
  const [percent, setPercent] = useState(String(settings.defaultRule.percent));
  const [amount, setAmount] = useState(String(settings.defaultRule.amount));
  const [busy, setBusy] = useState(false);
  const rule = { percent: Number(percent), amount: Number(amount) };
  const allowed = isAdmin && can("can_view_cost_margin");
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>Total Unit Cost</DialogTitle></DialogHeader>
      <p className="text-xs text-muted-foreground">Estimate purchase cost plus charges and overhead. Existing costs, stock valuation and profit stay unchanged.</p>
      <div className="space-y-2">
        <Label htmlFor="unit-cost-target">Apply to</Label>
        <select id="unit-cost-target" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={target} disabled={busy} onChange={e => setTarget(e.target.value as typeof target)}>
          <option value="default">All items using the default</option>
          <option value="selected" disabled={!selected.length}>Selected items ({selected.length}) — custom override</option>
          <option value="reset" disabled={!selected.length}>Selected items ({selected.length}) — reset to default</option>
        </select>
      </div>
      {target !== "reset" && <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2"><Label htmlFor="unit-cost-percent">Additional %</Label><Input id="unit-cost-percent" type="number" min="0" max="10000" step="0.01" value={percent} disabled={busy} onChange={e => setPercent(e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="unit-cost-amount">Amount per unit</Label><Input id="unit-cost-amount" type="number" min="0" max="100000000" step="0.01" value={amount} disabled={busy} onChange={e => setAmount(e.target.value)} /></div>
      </div>}
      <p className="text-xs text-muted-foreground">{target === "default" ? "Individual overrides are preserved. New products follow this default automatically." : target === "reset" ? "Only selected items will return to the current default." : "Only selected items change. Their overrides will be preserved when the default changes."}</p>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={!allowed || busy || (target !== "default" && !selected.length) || (target !== "reset" && (!percent.trim() || !amount.trim() || !validUnitCostRule(rule)))} onClick={async () => {
        if (!allowed || busy) return;
        setBusy(true);
        try {
          const next = updateUnitCostRules(settings, target, selected, target === "reset" ? { percent: 0, amount: 0 } : rule);
          updateGlobalSettings({ integrations: { ...state.settings.integrations, totalUnitCost: next } });
          await saveConfiguredSettings();
          toast.success("Total Unit Cost settings saved");
          onOpenChange(false);
        } catch (error) { notifyError(error, "Saving Total Unit Cost"); }
        finally { setBusy(false); }
      }}>{busy ? "Saving…" : "Save"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
