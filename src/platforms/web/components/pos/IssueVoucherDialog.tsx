import { copyText } from "@/platform-config/clipboard";
/** Backoffice: hand a voucher to a member (existing or brand new) by phone. */
import { useMemo, useState } from "react";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { notifyError } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { issueVoucherManually, type Campaign } from "@/lib/coupons";
import { voucherUrl } from "@/lib/coupon-hosts";

export function IssueVoucherDialog({
  campaign,
  members,
  staffName,
  staffRole,
  storeId,
  onClose,
  onIssued,
}: {
  campaign: Campaign | null;
  members: { id: string; name: string; phone: string }[];
  staffName?: string;
  staffRole?: string;
  storeId?: string;
  onClose: () => void;
  onIssued: () => void;
}) {
  const [query, setQuery] = useState("");
  const [phone, setPhone] = useState("");
  const [fullName, setFullName] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [ignoreLimit, setIgnoreLimit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return members
      .filter((m) => m.name.toLowerCase().includes(q) || m.phone.includes(q))
      .slice(0, 6);
  }, [members, query]);

  async function issue() {
    if (!campaign) return;
    if (!phone.trim()) return toast.error("Enter the member's mobile number");
    setBusy(true);
    try {
      const t = await issueVoucherManually({
        slug: campaign.slug,
        phone: phone.trim(),
        fullName: fullName.trim() || undefined,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        staff: staffName,
        role: staffRole,
        storeId,
        ignoreLimit,
      });
      setToken(t);
      toast.success("Voucher issued");
      onIssued();
    } catch (e) {
      notifyError(e, "Could not issue the voucher");
    } finally {
      setBusy(false);
    }
  }

  const reset = () => {
    setQuery("");
    setPhone("");
    setFullName("");
    setExpiresAt("");
    setIgnoreLimit(false);
    setToken("");
  };

  return (
    <Dialog
      open={Boolean(campaign)}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Issue a voucher — {campaign?.name}</DialogTitle>
        </DialogHeader>

        {token ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Voucher issued. Send this link to the member:
            </p>
            <p className="break-all rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs">
              {voucherUrl(token)}
            </p>
            <Button
              variant="outline"
              onClick={() => {
                void copyText(voucherUrl(token)).then(() => toast.success("Link copied"))
                  .catch(() => toast.error("Could not copy. Please try again."));
              }}
            >
              <Copy className="mr-2 h-4 w-4" /> Copy link
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="iv-search">Find an existing member</Label>
              <Input
                id="iv-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name or phone…"
              />
              {matches.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="flex w-full items-center justify-between rounded-md border border-border px-2 py-1.5 text-left text-xs hover:bg-muted"
                  onClick={() => {
                    setPhone(m.phone);
                    setFullName(m.name);
                    setQuery("");
                  }}
                >
                  <span>{m.name}</span>
                  <span className="text-muted-foreground">{m.phone}</span>
                </button>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="iv-phone">Mobile number</Label>
              <Input
                id="iv-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="01x xxx xxxx"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="iv-name">Full name (only needed for a new member)</Label>
              <Input
                id="iv-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Customer name"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="iv-exp">Custom expiry (optional)</Label>
              <Input
                id="iv-exp"
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to follow the campaign's own expiry.
              </p>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium">Ignore per-member limit</p>
                <p className="text-xs text-muted-foreground">
                  Issue even if this member already reached the cap.
                </p>
              </div>
              <Switch checked={ignoreLimit} onCheckedChange={setIgnoreLimit} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            {token ? "Done" : "Cancel"}
          </Button>
          {token ? null : (
            <Button onClick={() => void issue()} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Issue voucher
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
