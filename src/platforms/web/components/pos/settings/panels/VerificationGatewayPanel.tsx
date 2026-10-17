/**
 * Which channel carries member verification codes, and whether a member must
 * be verified before they can be used at the till.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { adminAccessToken, ADMIN_SIGN_IN_MESSAGE } from "@/lib/admin-session";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import { resetGateway } from "@/lib/verification-gateway";
import {
  getVerificationSettings,
  saveVerificationSettings,
} from "@/lib/verification-client";

type Channel = "email" | "sms" | "whatsapp";

const CHANNELS: { v: Channel; label: string }[] = [
  { v: "whatsapp", label: "WhatsApp" },
  { v: "sms", label: "SMS" },
  { v: "email", label: "Email" },
];

export function VerificationGatewayPanel() {
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [strict, setStrict] = useState(false);
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const { accessToken, cashierToken } = await getPosCallerAuth();
      const res = await getVerificationSettings({ data: { accessToken, cashierToken } }).catch(
        () => ({ ok: false as const, error: "Could not load the gateway settings" }),
      );
      if (!res.ok) return setError(res.error ?? "Could not load the gateway settings");
      setError("");
      setChannel(res.config.channel);
      setStrict(res.config.strict);
      setActive(res.config.active);
    })();
  }, []);

  const save = async () => {
    setBusy(true);
    const accessToken = await adminAccessToken();
    if (!accessToken) {
      setBusy(false);
      return toast.error(ADMIN_SIGN_IN_MESSAGE);
    }
    const res = await saveVerificationSettings({
      data: { accessToken, channel, strict, active },
    }).catch((e: unknown) => ({ ok: false as const, error: String(e) }));
    setBusy(false);
    if (!res.ok) return toast.error(res.error ?? "Could not save");
    resetGateway();
    toast.success("Verification gateway saved");
  };

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div>
        <p className="text-sm font-medium">Member verification</p>
        <p className="text-xs text-muted-foreground">
          One-time codes prove a member owns the number or address on file. Provider keys live in
          the encrypted credentials below.
        </p>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Channel</Label>
        <div className="grid grid-cols-3 gap-2">
          {CHANNELS.map((c) => (
            <button
              key={c.v}
              onClick={() => setChannel(c.v)}
              className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                channel === c.v
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-border px-3 py-2">
        <div className="min-w-0">
          <p className="text-sm">Verification switched on</p>
          <p className="text-[11px] text-muted-foreground">
            Turn off to hide the verify action everywhere.
          </p>
        </div>
        <Switch aria-label="Verification switched on" checked={active} onCheckedChange={setActive} />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-border px-3 py-2">
        <div className="min-w-0">
          <p className="text-sm">Strict mode</p>
          <p className="text-[11px] text-muted-foreground">
            Prompt staff to verify a member before points or tier discounts are applied.
          </p>
        </div>
        <Switch aria-label="Strict mode" checked={strict} onCheckedChange={setStrict} />
      </div>
      <Button size="sm" disabled={busy} onClick={() => void save()}>
        Save gateway
      </Button>
    </div>
  );
}
