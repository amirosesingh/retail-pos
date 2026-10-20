import { HelpTip } from "@/components/ui/help-tip";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adminAccessToken, ADMIN_SIGN_IN_MESSAGE } from "@/lib/admin-session";
import {
  clearSecureSetting,
  listSecureSettings,
  saveSecureSetting,
} from "@/lib/secure-settings-client";

type Key =
  | "whatsapp_token"
  | "whatsapp_phone_number_id"
  | "bank_account_number"
  | "bank_account_name"
  | "bank_name"
  | "update_feed_token"
  | "integration_api_key"
  | "local_db_password"
  | "twilio_account_sid"
  | "twilio_auth_token"
  | "twilio_from"
  | "sendgrid_api_key"
  | "email_from";

const FIELDS: { key: Key; label: string; hint: string; placeholder: string }[] = [
  {
    key: "whatsapp_token",
    label: "WhatsApp permanent access token",
    hint: "Meta → WhatsApp → API setup. Encrypted with AES-256-GCM before storage.",
    placeholder: "EAAG...",
  },
  {
    key: "whatsapp_phone_number_id",
    label: "WhatsApp phone number ID",
    hint: "Overrides the plain-text value above when set.",
    placeholder: "123456789012345",
  },
  {
    key: "bank_account_number",
    label: "Bank account number (private copy)",
    hint: "Kept encrypted for reconciliation; the display shows the public value only.",
    placeholder: "0001234567",
  },
  {
    key: "bank_account_name",
    label: "Bank account holder name",
    hint: "Stored encrypted; shown masked here.",
    placeholder: "Retail",
  },
  {
    key: "bank_name",
    label: "Bank name",
    hint: "Stored encrypted alongside the account details.",
    placeholder: "Maybank",
  },
  {
    key: "update_feed_token",
    label: "Update feed token",
    hint: "Used by the desktop updater to fetch private releases.",
    placeholder: "ghp_...",
  },
  {
    key: "integration_api_key",
    label: "Integration API key",
    hint: "Any third-party key the POS calls on your behalf.",
    placeholder: "sk_live_...",
  },
  {
    key: "local_db_password",
    label: "Local SQL Server password",
    hint: "Never written to the till in plain text; the device copy is sealed too.",
    placeholder: "••••••••",
  },
  {
    key: "twilio_account_sid",
    label: "SMS gateway account SID",
    hint: "Used when member verification codes go out by SMS.",
    placeholder: "AC...",
  },
  {
    key: "twilio_auth_token",
    label: "SMS gateway auth token",
    hint: "Stored encrypted; never returned to the browser.",
    placeholder: "••••••••",
  },
  {
    key: "twilio_from",
    label: "SMS sender number",
    hint: "The number verification codes are sent from.",
    placeholder: "+15550001111",
  },
  {
    key: "sendgrid_api_key",
    label: "Email provider API key",
    hint: "Used when member verification codes go out by email.",
    placeholder: "SG...",
  },
  {
    key: "email_from",
    label: "Email sender address",
    hint: "Shown as the from address on verification emails.",
    placeholder: "no-reply@yourshop.com",
  },
];

/** Admin-only editor for credentials stored encrypted server-side. */
export function SecureCredentials() {
  const [hints, setHints] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const token = adminAccessToken;

  const refresh = async () => {
    const accessToken = await token();
    if (!accessToken) {
      setError(ADMIN_SIGN_IN_MESSAGE);
      return;
    }
    const res = await listSecureSettings({ data: { accessToken } });
    if (!res.ok) {
      setError(res.error ?? "Unable to load credentials");
      return;
    }
    setError("");
    setHints(Object.fromEntries(res.items.map((i) => [i.key, i.hint ?? "set"])));
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (key: Key) => {
    const value = (drafts[key] ?? "").trim();
    if (!value) return;
    setBusy(true);
    const accessToken = await token();
    const res = await saveSecureSetting({ data: { accessToken, key, value } });
    setBusy(false);
    if (!res.ok) return toast.error(res.error ?? "Could not save");
    setDrafts((d) => ({ ...d, [key]: "" }));
    toast.success("Credential encrypted and saved");
    void refresh();
  };

  const clear = async (key: Key) => {
    setBusy(true);
    const accessToken = await token();
    const res = await clearSecureSetting({ data: { accessToken, key } });
    setBusy(false);
    if (!res.ok) return toast.error(res.error ?? "Could not remove");
    toast.success("Credential removed");
    void refresh();
  };

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div>
        <p className="text-sm font-medium">Encrypted credentials</p>
        <p className="text-xs text-muted-foreground">
          Stored server-side with AES-256-GCM. Values can never be read back — only replaced.
        </p>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {FIELDS.map((f) => (
        <div key={f.key} className="space-y-1">
          <div className="flex items-center gap-1">
            <Label className="text-xs text-muted-foreground">{f.label}</Label>
            <HelpTip text={f.hint} label={`About ${f.label}`} />
          </div>
          <div className="flex gap-2">
            <Input
              type="password"
              autoComplete="off"
              placeholder={hints[f.key] ? `Saved · ${hints[f.key]}` : f.placeholder}
              value={drafts[f.key] ?? ""}
              onChange={(e) => setDrafts((d) => ({ ...d, [f.key]: e.target.value }))}
            />
            <Button
              size="sm"
              disabled={busy || !(drafts[f.key] ?? "").trim()}
              onClick={() => void save(f.key)}
            >
              Save
            </Button>
            {hints[f.key] && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void clear(f.key)}>
                Remove
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
