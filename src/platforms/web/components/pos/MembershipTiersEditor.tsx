import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@tanstack/react-router";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabaseExternal } from "@/integrations/supabase/external-client";
import { useMembershipTiers, type MembershipTier } from "@/lib/membership-tiers";
import { notifyError } from "@/lib/notify";
import { toast } from "sonner";
export function MembershipTiersEditor() {
  const tiers = useMembershipTiers(); const client = useQueryClient();
  const [draft,setDraft] = useState<Partial<MembershipTier>>({name:"",discount:0,multiplier:1});
  const [busy,setBusy] = useState(false);
  return <Dialog><DialogTrigger asChild><Button type="button" variant="outline" size="sm">Membership tiers</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Membership tiers</DialogTitle><DialogDescription>Create additional tiers. Existing tier names and member assignments are preserved.</DialogDescription></DialogHeader>
    {tiers.error && <p className="text-sm text-destructive">Could not load tiers. <button type="button" onClick={() => void tiers.refetch()}>Retry</button></p>}
    <div className="max-h-48 space-y-1 overflow-y-auto">{tiers.data?.map(tier => <div key={tier.id} className="flex w-full items-center justify-between gap-2 rounded-lg border p-2 text-left text-sm"><span className="font-medium">{tier.name}</span><span className="text-xs text-muted-foreground">Existing tier</span></div>)}</div>
    <label className="block space-y-1"><span className="text-sm">New tier name</span><Input maxLength={80} value={draft.name ?? ""} onChange={event => setDraft({...draft,name:event.target.value})} disabled={busy}/></label>
    <p className="text-xs text-muted-foreground">Configure checkout tier discounts in <Link to="/promotions" className="text-primary underline">Promotions</Link>.</p>
    <div className="flex justify-between gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={() => setDraft({name:"",discount:0,multiplier:1})}>New tier</Button><Button type="button" disabled={busy || tiers.isLoading || !draft.name?.trim()} onClick={async () => { if (!Number.isFinite(draft.discount) || draft.discount! < 0 || draft.discount! > 100 || !Number.isFinite(draft.multiplier) || draft.multiplier! < 0 || draft.multiplier! > 100) { toast.error("Discount must be 0–100%; multiplier must be 0–100"); return; } setBusy(true); try { const {error} = await supabaseExternal.rpc("staff_membership_tier_save",{p_id:null,p_name:draft.name!.trim(),p_discount:draft.discount!,p_multiplier:draft.multiplier!}); if(error)throw error; await client.invalidateQueries({queryKey:["membership-tiers"]}); toast.success("Membership tier saved"); setDraft({name:"",discount:0,multiplier:1}); } catch(error) { notifyError(error,"Saving membership tier"); } finally { setBusy(false); } }}>{busy ? "Saving…" : "Save tier"}</Button></div>
  </DialogContent></Dialog>;
}
