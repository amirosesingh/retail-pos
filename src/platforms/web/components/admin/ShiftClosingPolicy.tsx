import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/pos-auth";
import { usePos } from "@/lib/pos-store";
import { notifyError } from "@/lib/notify";
import { toast } from "sonner";

/** One owner for the existing company policy; per-user Close shift remains separate. */
export function ShiftClosingPolicy() {
  const { isAdmin } = useAuth();
  const { configuredGlobalSettings, updateGlobalSettings, saveConfiguredSettings, settingsScopeLoading } = usePos();
  const [saving, setSaving] = useState(false);
  if (!isAdmin) return null;
  return <section className="flex items-center justify-between gap-4 rounded-xl border p-4">
    <div><h2 className="font-semibold">Allow another authorized user to close the shift</h2><p className="text-sm text-muted-foreground">Company-wide. A user must still have Close shift permission and access to that branch. Both the opening and closing identities are recorded.</p></div>
    <Switch aria-label="Allow another authorized user to close the shift" checked={configuredGlobalSettings.integrations.allowAnyStaffCloseShift === true} disabled={saving || settingsScopeLoading} onCheckedChange={enabled => {
      void (async () => { setSaving(true); try {
        updateGlobalSettings({ integrations: { ...configuredGlobalSettings.integrations, allowAnyStaffCloseShift: enabled } });
        await saveConfiguredSettings(); toast.success("Shift closing policy saved");
      } catch (error) { notifyError(error, "Saving shift closing policy"); } finally { setSaving(false); } })();
    }} />
  </section>;
}
