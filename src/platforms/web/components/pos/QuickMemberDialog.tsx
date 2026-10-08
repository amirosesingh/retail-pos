/**
 * Compact enrolment form used at the register when a phone number matches no
 * member. Saves through the same member upsert as the members page and hands
 * the new record back so the till can attach it to the open ticket.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import { OtpVerificationModal } from "@/platforms/web/components/pos/OtpVerificationModal";
import { usePos } from "@/lib/pos-store";
import { useVerificationGateway } from "@/lib/verification-gateway";
import { describeError } from "@/lib/notify";
import { newMemberCode } from "@/lib/member-code";
import type { Member } from "@/core/types/pos-types";

const looksNumeric = (v: string) => /^[\d+\s-]+$/.test(v.trim());

export function QuickMemberDialog({
  open,
  onOpenChange,
  prefill,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whatever the cashier typed into the member search box. */
  prefill?: string;
  onCreated: (member: Member) => void;
}) {
  const { upsertMember } = usePos();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [tier, setTier] = useState<Member["tier"]>("Bronze");
  const [verifying, setVerifying] = useState<Member | null>(null);
  const gateway = useVerificationGateway();

  useEffect(() => {
    if (!open) return;
    const seed = (prefill ?? "").trim();
    setName(seed && !looksNumeric(seed) ? seed : "");
    setPhone(seed && looksNumeric(seed) ? seed : "");
    setEmail("");
    setTier("Bronze");
  }, [open, prefill]);

  const save = async () => {
    if (!name.trim()) {
      toast.error("Member name is required");
      return;
    }
    const member: Member = {
      id: crypto.randomUUID(),
      code: newMemberCode(),
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim(),
      tier,
      points: 0,
      totalSpend: 0,
      joinedAt: new Date().toISOString().slice(0, 10),
    };
    try {
      await upsertMember(member);
      onOpenChange(false);
      toast.success(`${member.name} enrolled and attached`);
      onCreated(member);
      // Strict gateways want the number proven before the member earns points.
      if (gateway?.active && (member.phone || member.email)) setVerifying(member);
    } catch (error) {
      toast.error("Member was not saved", { description: describeError(error, "Saving the member") });
    }
  };

  if (verifying) {
    return (
      <OtpVerificationModal
        open
        onOpenChange={(o) => !o && setVerifying(null)}
        member={{
          id: verifying.id,
          name: verifying.name,
          phone: verifying.phone,
          email: verifying.email,
        }}
        onVerified={async () => {
          try {
            await upsertMember({ ...verifying, verified: true });
            setVerifying(null);
          } catch (error) {
            toast.error("Verification was not saved", {
              description: describeError(error, "Saving member verification"),
            });
          }
        }}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Enroll new member</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <Label className="text-xs text-muted-foreground">Full name</Label>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Phone</Label>
            <Input className="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Email (optional)</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-xs text-muted-foreground">Tier</Label>
            <ThemedSelect
              ariaLabel="Tier"
              value={tier}
              onChange={(v) => setTier(v as Member["tier"])}
              options={[
                { value: "Bronze", label: "Bronze" },
                { value: "Silver", label: "Silver" },
                { value: "Gold", label: "Gold" },
              ]}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save}>Save &amp; attach</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
