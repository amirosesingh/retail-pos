import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MEMBERSHIP_PRIVACY, MEMBERSHIP_PRIVACY_VERSION, MEMBERSHIP_TERMS, MEMBERSHIP_TERMS_VERSION } from "@/lib/membership-policies";

export function MembershipConsent({ accepted, marketing, disabled, onAccepted, onMarketing }: {
  accepted: boolean; marketing: boolean; disabled: boolean;
  onAccepted: (value: boolean) => void; onMarketing: (value: boolean) => void;
}) {
  const [policy, setPolicy] = useState<"terms" | "privacy" | null>(null);
  return <section className="mt-5 space-y-4 rounded-xl border border-border p-4" aria-label="Membership consent">
    <div className="flex items-start gap-3">
      <Checkbox id="join-terms" checked={accepted} disabled={disabled} onCheckedChange={(value) => onAccepted(value === true)} className="mt-0.5 shrink-0" aria-required="true" />
      <div className="min-w-0 space-y-1">
        <Label htmlFor="join-terms" className="text-sm leading-relaxed">I agree to the membership Terms &amp; Conditions and acknowledge the Privacy Notice. *</Label>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <button type="button" className="text-primary underline underline-offset-4" onClick={() => setPolicy("terms")}>Read Terms &amp; Conditions</button>
          <button type="button" className="text-primary underline underline-offset-4" onClick={() => setPolicy("privacy")}>Read Privacy Notice</button>
        </div>
      </div>
    </div>
    <div className="flex items-start gap-3">
      <Checkbox id="join-marketing" checked={marketing} disabled={disabled} onCheckedChange={(value) => onMarketing(value === true)} className="mt-0.5 shrink-0" />
      <Label htmlFor="join-marketing" className="min-w-0 text-sm leading-relaxed">I would like to receive offers and promotions by email or SMS. Optional; you can withdraw by contacting the store.</Label>
    </div>
    <Dialog open={policy !== null} onOpenChange={(open) => { if (!open) setPolicy(null); }}>
      <DialogContent className="flex max-h-[85dvh] max-w-2xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{policy === "terms" ? "Membership Terms & Conditions" : "Privacy Notice"}</DialogTitle>
          <DialogDescription>Version {policy === "terms" ? MEMBERSHIP_TERMS_VERSION : MEMBERSHIP_PRIVACY_VERSION}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto pr-2 text-sm">
          {(policy === "terms" ? MEMBERSHIP_TERMS : MEMBERSHIP_PRIVACY).map((item) => <section key={item.title} className="space-y-1">
            <h3 className="font-medium">{item.title}</h3><p className="leading-relaxed text-muted-foreground">{item.text}</p>
          </section>)}
        </div>
      </DialogContent>
    </Dialog>
  </section>;
}
