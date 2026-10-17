import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { approvalCredentialCall } from "@/lib/approval-token-client";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import { broadcastSettingsChange } from "@/lib/sync-engine";
import { notifyError } from "@/lib/notify";
import type { ApprovalMethodPerson } from "@/platform-config/approval-methods";
export function NativeApprovalMethods({
  person,
  disabled,
  onUpdated,
}: {
  person: ApprovalMethodPerson | null;
  disabled: boolean;
  onUpdated: (
    userId: string,
    patch: Pick<ApprovalMethodPerson, "approval_pin_enabled" | "approval_totp_enabled">,
  ) => void;
}) {
  const [saving, setSaving] = useState(false);
  if (!person) return null;
  return (
    <div className="space-y-3 rounded-lg border p-3">
      {(["pin", "totp"] as const).map((method) => (
        <label key={method} className="flex items-center justify-between gap-3 text-sm">
          {method === "pin" ? "Enable authorization PIN" : "Enable soft token (TOTP)"}
          <Checkbox
            checked={method === "pin" ? person.approval_pin_enabled : person.approval_totp_enabled}
            disabled={saving || disabled}
            onCheckedChange={(value) => {
              const enabled = value === true;
              setSaving(true);
              const patch = {
                approval_pin_enabled: method === "pin" ? enabled : person.approval_pin_enabled,
                approval_totp_enabled: method === "totp" ? enabled : person.approval_totp_enabled,
              };
              void getPosCallerAuth()
                .then((auth) =>
                  approvalCredentialCall("methods", {
                    ...auth,
                    userId: person.user_id,
                    pinEnabled: patch.approval_pin_enabled,
                    totpEnabled: patch.approval_totp_enabled,
                  }),
                )
                .then((result) => {
                  if (!result.ok) throw new Error(result.error);
                  onUpdated(person.user_id, patch);
                  broadcastSettingsChange("app_users");
                })
                .catch((error) => notifyError(error, "Saving approval methods"))
                .finally(() => setSaving(false));
            }}
          />
        </label>
      ))}
      <p className="text-xs text-muted-foreground">
        Only users eligible under an approval rule can use these methods. Tokens enroll
        automatically on registered devices after sign-in.
      </p>
    </div>
  );
}
