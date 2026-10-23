import { useStoreGroups, selectableGroups, groupName } from "@/lib/store-groups";
import { useMemo, useState } from "react";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { copyText } from "@/platform-config/clipboard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Promotion } from "@/core/types/pos-types";
import { money, usePos } from "@/lib/pos-store";
import { isLive } from "@/lib/pos-promotions";
import { generateCampaignCode, normalizeCampaignCode, validateReusableCode } from "@/lib/reusable-coupon-code";
import { notifyError } from "@/lib/notify";

function newCode(existing: Promotion[]): Promotion {
  let code = generateCampaignCode();
  while (existing.some((rule) => normalizeCampaignCode(rule.name) === code)) code = generateCampaignCode();
  return {
    id: crypto.randomUUID(),
    name: code,
    type: "code",
    codeScope: "bill",
    codeClusterId: null,
    active: true,
    minBill: 0,
    value: 10,
    valueType: "percent",
  };
}

export function ReusableCampaignCodes() {
  const { state, upsertPromotion, removePromotion } = usePos();
  const groups = useStoreGroups();
  const [draft, setDraft] = useState<Promotion | null>(null);
  const [saving, setSaving] = useState(false);
  const codes = useMemo(() => state.promotions.filter((p) => p.type === "code"), [state.promotions]);

  async function save() {
    if (!draft || saving) return;
    const normalized = { ...draft, name: normalizeCampaignCode(draft.name), minBill: 0 };
    const error = validateReusableCode(normalized, state.promotions);
    if (error) return toast.error(error);
    setSaving(true);
    try {
      await upsertPromotion(normalized);
      setDraft(null);
      toast.success("Reusable campaign code saved");
    } catch (error) {
      notifyError(error, "Saving reusable campaign code");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Share one code with a collaborator. Choose its stores and apply it to the whole bill or each item. It has no minimum spend,
          does not require a member, and stays available on a synced Windows till while offline.
        </p>
        <Button onClick={() => setDraft(newCode(state.promotions))}>
          <Plus className="size-4" /> New reusable code
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        {codes.length ? (
          <Table tableId="routes/coupons#reusable" clientDataControls={false}>
            <TableHeader><TableRow>
              <TableHead>Code</TableHead><TableHead>Collaborator</TableHead><TableHead>Discount / coverage</TableHead>
              <TableHead>Valid dates</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>{codes.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell className="font-mono font-medium">{rule.name}</TableCell>
                <TableCell>{rule.partner || "—"}</TableCell>
                <TableCell>{rule.valueType === "percent" ? `${rule.value ?? 0}%` : money(rule.value ?? 0)}<div className="text-xs text-muted-foreground">{rule.codeScope === "item" ? "Per item" : "Whole bill"} · {rule.codeClusterId ? groupName(groups, rule.codeClusterId) : "Global"}</div></TableCell>
                <TableCell className="text-xs text-muted-foreground">{rule.startDate || "Now"} → {rule.endDate || "No end"}</TableCell>
                <TableCell><Switch checked={rule.active} aria-label={`Enable ${rule.name}`} onCheckedChange={(active) => void upsertPromotion({ ...rule, active }).catch((error) => notifyError(error, "Updating campaign code"))} /> <span className="text-xs">{isLive(rule) ? "Live" : "Off"}</span></TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" title="Copy code" aria-label={`Copy ${rule.name}`} onClick={() => void copyText(rule.name).then(() => toast.success("Code copied")).catch(() => toast.error("Could not copy code"))}><Copy className="size-4" /></Button>
                    <Button size="icon" variant="ghost" title="Edit code" aria-label={`Edit ${rule.name}`} onClick={() => setDraft(rule)}><Pencil className="size-4" /></Button>
                    <Button size="icon" variant="ghost" title="Delete code" aria-label={`Delete ${rule.name}`} onClick={() => {
                      if (!confirm(`Delete reusable code ${rule.name}?`)) return;
                      void removePromotion(rule.id).then(() => toast.success("Code deleted")).catch((error) => notifyError(error, "Deleting campaign code"));
                    }}><Trash2 className="size-4 text-destructive" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        ) : <p className="p-8 text-center text-sm text-muted-foreground">No reusable codes yet.</p>}
      </div>
      <p className="text-xs text-muted-foreground">
        Unlimited uses. No membership required.
      </p>
      <Dialog open={Boolean(draft)} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{codes.some((p) => p.id === draft?.id) ? "Edit reusable code" : "New reusable code"}</DialogTitle></DialogHeader>
          {draft && <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1"><Label htmlFor="reusable-code">Code</Label><Input id="reusable-code" autoCapitalize="characters" value={draft.name} maxLength={32} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
            <div className="col-span-2 space-y-1"><Label htmlFor="reusable-partner">Collaborator (optional)</Label><Input id="reusable-partner" value={draft.partner ?? ""} maxLength={80} onChange={(event) => setDraft({ ...draft, partner: event.target.value })} placeholder="e.g. local sports club" /></div>
            <div className="space-y-1"><Label htmlFor="reusable-discount">Discount</Label><Input id="reusable-discount" type="number" min="0.01" step="0.01" value={draft.value ?? 0} onChange={(event) => setDraft({ ...draft, value: Number(event.target.value) })} /></div>
            <div className="space-y-1"><Label htmlFor="reusable-unit">Type</Label><select id="reusable-unit" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={draft.valueType ?? "percent"} onChange={(event) => setDraft({ ...draft, valueType: event.target.value as "percent" | "amount" })}><option value="percent">Percent</option><option value="amount">Fixed amount</option></select></div>
            <div className="space-y-1"><Label htmlFor="reusable-scope">Applies to</Label><select id="reusable-scope" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={draft.codeScope ?? "bill"} onChange={(event) => setDraft({ ...draft, codeScope: event.target.value as "bill" | "item" })}><option value="bill">Whole bill</option><option value="item">Per item</option></select></div>
            <div className="space-y-1"><Label htmlFor="reusable-cluster">Store coverage</Label><select id="reusable-cluster" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={draft.codeClusterId ?? ""} onChange={(event) => setDraft({ ...draft, codeClusterId: event.target.value || null })}><option value="">Global — all stores</option>{selectableGroups(groups).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}{draft.codeClusterId && !selectableGroups(groups).some((group) => group.id === draft.codeClusterId) && <option value={draft.codeClusterId}>{groupName(groups, draft.codeClusterId)} (unavailable)</option>}</select></div>
            <div className="space-y-1"><Label htmlFor="reusable-start">Starts (optional)</Label><Input id="reusable-start" type="date" value={draft.startDate ?? ""} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="reusable-end">Ends (optional)</Label><Input id="reusable-end" type="date" value={draft.endDate ?? ""} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} /></div>
            <div className="col-span-2 flex items-center justify-between rounded-md border px-3 py-2"><Label htmlFor="reusable-active">Active</Label><Switch id="reusable-active" checked={draft.active} onCheckedChange={(active) => setDraft({ ...draft, active })} /></div>
          </div>}
          <DialogFooter><Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button><Button onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save code"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
