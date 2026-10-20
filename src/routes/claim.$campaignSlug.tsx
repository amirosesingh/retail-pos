import { formatDate as posDisplayDate } from "@/lib/time-zone";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, TicketPercent, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  campaignStatus,
  claimCampaign,
  discountLabel,
  loadCampaignBySlug,
  scopeLabel,
  type Campaign,
} from "@/lib/coupons";
import { usePublicFlags } from "@/lib/public-flags";
import { PublicPageClosed } from "@/platforms/web/components/pos/PublicPageClosed";

export const Route = createFileRoute("/claim/$campaignSlug")({
  head: () => ({
    meta: [
      { title: "Claim your coupon — Retail" },
      {
        name: "description",
        content:
          "Enter your mobile number to claim this offer. Your personal voucher is issued instantly with a scannable code.",
      },
      { property: "og:title", content: "Claim your coupon — Retail" },
      {
        property: "og:description",
        content: "Grab your personal voucher — one tap, no app needed.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ClaimPage,
});

function ClaimPage() {
  const { campaignSlug } = Route.useParams();
  const { flags, ready: flagsReady } = usePublicFlags();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [needName, setNeedName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    loadCampaignBySlug(campaignSlug)
      .then((c) => {
        if (!alive) return;
        setCampaign(c);
        if (!c) setLoadError("That coupon link is not valid.");
      })
      .catch((e: unknown) =>
        alive ? setLoadError(e instanceof Error ? e.message : "Could not load this offer.") : null,
      )
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [campaignSlug]);

  const status = campaign ? campaignStatus(campaign) : null;
  const live = status === "Live";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (phone.replace(/\D/g, "").length < 6) return setError("Enter a valid mobile number.");
    if (needName && !name.trim()) return setError("Please tell us your name.");
    setBusy(true);
    try {
      const token = await claimCampaign({
        slug: campaignSlug,
        phone,
        fullName: name.trim() || undefined,
        email: email.trim() || undefined,
      });
      navigate({ to: "/c/$tokenSlug", params: { tokenSlug: token } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not issue your coupon.";
      if (message.includes("NEW_MEMBER_NAME_REQUIRED")) {
        setNeedName(true);
        setError("You're new here — add your name and we'll set up your membership.");
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!flagsReady) return <main className="min-h-screen bg-background" />;
  if (!flags.redeem) return <PublicPageClosed what="Voucher redemption" />;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-lg">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !campaign ? (
          <div className="text-center">
            <TriangleAlert className="mx-auto h-10 w-10 text-destructive" aria-hidden />
            <h1 className="mt-4 text-xl font-semibold text-card-foreground">Coupon unavailable</h1>
            <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
          </div>
        ) : (
          <>
            <div className="text-center">
              <TicketPercent className="mx-auto h-10 w-10 text-primary" aria-hidden />
              <h1 className="mt-4 text-2xl font-semibold tracking-tight text-card-foreground">
                {campaign.name}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {discountLabel(campaign)} on your {scopeLabel(campaign)}.
              </p>
              {campaign.expiresAt ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Valid until {posDisplayDate(new Date(campaign.expiresAt))}
                </p>
              ) : null}
            </div>

            {!live ? (
              <p className="mt-6 rounded-lg bg-muted p-4 text-center text-sm text-muted-foreground">
                {status === "Expired"
                  ? "This promotion has ended."
                  : status === "Scheduled"
                    ? "This promotion has not started yet."
                    : status === "Fully claimed"
                      ? "Every coupon for this promotion has been claimed."
                      : "This promotion is not running right now."}
              </p>
            ) : (
              <form onSubmit={submit} className="mt-6 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="claim-phone">Mobile number</Label>
                  <Input
                    id="claim-phone"
                    value={phone}
                    maxLength={24}
                    inputMode="tel"
                    autoComplete="tel"
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. 012 345 6789"
                  />
                </div>
                {needName ? (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="claim-name">Full name</Label>
                      <Input
                        id="claim-name"
                        value={name}
                        maxLength={80}
                        autoComplete="name"
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Your name"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="claim-email">Email (optional)</Label>
                      <Input
                        id="claim-email"
                        type="email"
                        value={email}
                        maxLength={120}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                      />
                    </div>
                  </>
                ) : null}

                {error ? (
                  <p className="text-sm text-destructive" role="alert">
                    {error}
                  </p>
                ) : null}

                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Claim my coupon
                </Button>
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
