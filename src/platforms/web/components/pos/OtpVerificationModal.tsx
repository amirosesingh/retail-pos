/**
 * Send a member a one-time code and check it back, on whichever channel the
 * business has switched on (WhatsApp, SMS or email).
 */
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import {
  confirmMemberVerification,
  startMemberVerification,
} from "@/lib/verification-client";
import { looksOffline, parkGovernanceRow } from "@/lib/governance-offline";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: { id?: string | null; name: string; phone?: string | null; email?: string | null };
  storeId?: string | null;
  onVerified?: () => void;
};

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "email",
};

export function OtpVerificationModal({
  open,
  onOpenChange,
  member,
  storeId,
  onVerified,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [id, setId] = useState<string | null>(null);
  const [channel, setChannel] = useState<string>("");
  const [code, setCode] = useState("");

  const auth = async () => {
    const { accessToken, cashierToken } = await getPosCallerAuth();
    return { accessToken, cashierToken };
  };

  const send = async () => {
    setBusy(true);
    const res = await startMemberVerification({
      data: {
        ...(await auth()),
        memberId: member.id ?? null,
        phone: member.phone ?? null,
        email: member.email ?? null,
        storeId: storeId ?? null,
      },
    }).catch((e: unknown) => ({ ok: false as const, error: String(e) }));
    setBusy(false);
    if (!res.ok) {
      // A code can only be delivered online, so the send is not retried on the
      // till. The attempt itself is kept locally so the branch can show it was
      // tried, and it travels up with the next sync.
      if (looksOffline(res.error)) {
        const parked = await parkGovernanceRow("member_verifications", {
          member_id: member.id ?? null,
          phone: member.phone ?? null,
          email: member.email ?? null,
          channel: "none",
          otp_code: "",
          attempts: 0,
          status: "failed",
          store_id: storeId ?? null,
        });
        return toast.error("No connection — the code could not be sent", {
          description: parked.parked
            ? "The attempt was recorded on this till and will sync later."
            : "The attempt could not be recorded on this till either.",
        });
      }
      return toast.error(res.error ?? "Could not send the code");
    }
    setId(res.id);
    setChannel(res.channel);
    toast.success(`Code sent on ${CHANNEL_LABEL[res.channel] ?? res.channel}`);
  };

  const confirm = async () => {
    if (!id) return;
    setBusy(true);
    const res = await confirmMemberVerification({
      data: { ...(await auth()), id, code: code.trim() },
    }).catch((e: unknown) => ({ ok: false as const, error: String(e) }));
    setBusy(false);
    if (!res.ok) return toast.error(res.error ?? "That code does not match");
    toast.success(`${member.name} is verified`);
    setId(null);
    setCode("");
    onVerified?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Verify {member.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            A six-digit code is sent to the member and expires in ten minutes. Ask them to read it
            back and enter it here.
          </p>
          <div className="rounded-md border border-border px-3 py-2 text-sm">
            <div>{member.phone || "No phone number on file"}</div>
            <div className="text-muted-foreground">{member.email || "No email on file"}</div>
          </div>
          <Button className="w-full" disabled={busy} onClick={() => void send()}>
            {id ? "Send a new code" : "Send code"}
          </Button>
          {id && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Code read back by the member{channel ? ` (sent on ${CHANNEL_LABEL[channel]})` : ""}
              </Label>
              <Input
                className="numeric tracking-[0.4em]"
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
              <Button
                className="w-full"
                variant="secondary"
                disabled={busy || code.trim().length < 4}
                onClick={() => void confirm()}
              >
                Confirm
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
