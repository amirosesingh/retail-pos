import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/pos-auth";
import { usePos } from "@/lib/pos-store";
import { notifyError } from "@/lib/notify";
import { toast } from "sonner";
export function SponsorshipSalesPolicy() {
  const { isAdmin } = useAuth();
  const {
    configuredGlobalSettings,
    updateGlobalSettings,
    saveConfiguredSettings,
    settingsScopeLoading,
  } = usePos();
  const [saving, setSaving] = useState(false);
  if (!isAdmin) return null;
  const current = configuredGlobalSettings.integrations.includeSponsorshipInDailySales === true;
  return (
    <section className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
      <div>
        <h3 className="text-sm font-medium">Include sponsorship in daily sales summaries</h3>
        <p className="text-xs text-muted-foreground">
          Company-wide. Add handed-over sponsorship product value to daily sales summaries, shown
          separately from paid sales. Requests awaiting approval are excluded. Cash collected, tax,
          profit and drawer balances stay based on paid bills.
        </p>
      </div>
      <Switch
        aria-label="Include sponsorship in daily sales summaries"
        checked={current}
        disabled={saving || settingsScopeLoading}
        onCheckedChange={(enabled) => {
          if (saving) return;
          setSaving(true);
          void (async () => {
            try {
              updateGlobalSettings({
                integrations: {
                  ...configuredGlobalSettings.integrations,
                  includeSponsorshipInDailySales: enabled,
                },
              });
              await saveConfiguredSettings();
              toast.success("Sponsorship reporting policy saved");
            } catch (error) {
              updateGlobalSettings({
                integrations: {
                  ...configuredGlobalSettings.integrations,
                  includeSponsorshipInDailySales: current,
                },
              });
              notifyError(error, "Could not save sponsorship reporting policy");
            } finally {
              setSaving(false);
            }
          })();
        }}
      />
    </section>
  );
}
