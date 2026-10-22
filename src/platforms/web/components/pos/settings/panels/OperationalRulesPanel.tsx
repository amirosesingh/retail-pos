import { useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { usePos } from "@/lib/pos-store";
import { notifyError } from "@/lib/notify";

/** Existing branch-scoped operational policy, alongside the other POS rules. */
export function OperationalRulesPanel({ canEdit }: { canEdit: boolean }) {
  const { state, updateSettings, saveConfiguredSettings, settingsScopeLoading } = usePos();
  const [saving, setSaving] = useState(false);
  return <section className="space-y-3">
    <h2 className="text-sm font-semibold">Operational rules</h2>
    <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">Stock transfers need approval</p>
        <p className="text-xs text-muted-foreground">Nothing leaves a branch until an authorized user approves it.</p>
      </div>
      <Switch aria-label="Stock transfers need approval" checked={state.settings.integrations.requireTransferApproval}
        disabled={!canEdit || saving || settingsScopeLoading} onCheckedChange={enabled => {
          setSaving(true);
          void (async () => {
            try {
              updateSettings({ integrations: { ...state.settings.integrations, requireTransferApproval: enabled } });
              await saveConfiguredSettings();
              toast.success("Transfer approval policy saved");
            } catch (error) { notifyError(error, "Could not save transfer approval policy"); }
            finally { setSaving(false); }
          })();
        }} />
    </div>
  </section>;
}
