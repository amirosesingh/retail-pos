import { formatDateTime as posDisplayDateTime } from "@/lib/time-zone";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, CircleSlash, Clock, Loader2, TriangleAlert } from "lucide-react";
import qrcode from "qrcode-generator";
import {
  discountLabel,
  loadVoucherByToken,
  scopeLabel,
  type VoucherView,
} from "@/lib/coupons";
import { voucherUrl } from "@/lib/coupon-hosts";
import { usePublicFlags } from "@/lib/public-flags";
import { PublicPageClosed } from "@/platforms/web/components/pos/PublicPageClosed";

export const Route = createFileRoute("/c/$tokenSlug")({
  head: () => ({
    meta: [
      { title: "Your voucher — Retail" },
      {
        name: "description",
        content:
          "Show this voucher at the counter to redeem your discount. Includes a scannable code and a live expiry countdown.",
      },
      { property: "og:title", content: "Your voucher — Retail" },
      { property: "og:description", content: "Scan at the till to redeem your discount." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: VoucherPage,
});

const qrDataUrl = (value: string) => {
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  return qr.createDataURL(6, 8);
};

/** "2 days 04:12:33" style countdown, or null once the deadline has passed. */
function countdown(target: Date, now: Date) {
  const ms = target.getTime() - now.getTime();
  if (ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  const days = Math.floor(s / 86400);
  const pad = (n: number) => String(n).padStart(2, "0");
  const clock = `${pad(Math.floor((s % 86400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return days > 0 ? `${days} day${days === 1 ? "" : "s"} ${clock}` : clock;
}

function VoucherPage() {
  const { tokenSlug } = Route.useParams();
  const { flags, ready: flagsReady } = usePublicFlags();
  const [view, setView] = useState<VoucherView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let alive = true;
    loadVoucherByToken(tokenSlug)
      .then((v) => {
        if (!alive) return;
        setView(v);
        if (!v) setError("That voucher code is not recognised.");
      })
      .catch((e: unknown) =>
        alive ? setError(e instanceof Error ? e.message : "Could not load this voucher.") : null,
      )
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [tokenSlug]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const qr = useMemo(() => (view ? qrDataUrl(voucherUrl(view.voucher.tokenSlug)) : ""), [view]);

  const expiresAt = view?.campaign.expiresAt ? new Date(view.campaign.expiresAt) : null;
  const remaining = expiresAt ? countdown(expiresAt, now) : null;
  const redeemed = view?.voucher.status === "REDEEMED";
  const expired = Boolean(view && !redeemed && expiresAt && !remaining);
  const usable = Boolean(view) && !redeemed && !expired;

  if (!flagsReady) return <main className="min-h-screen bg-background" />;
  if (!flags.redeem) return <PublicPageClosed what="Voucher redemption" />;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-lg">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !view ? (
          <div className="text-center">
            <TriangleAlert className="mx-auto h-10 w-10 text-destructive" aria-hidden />
            <h1 className="mt-4 text-xl font-semibold text-card-foreground">Voucher not found</h1>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          </div>
        ) : (
          <>
            <div className="text-center">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                Voucher for {view.memberName}
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-card-foreground">
                {view.campaign.name}
              </h1>
              <p className="mt-1 text-3xl font-bold text-primary">
                {discountLabel(view.campaign)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Applies to your {scopeLabel(view.campaign)}.
              </p>
            </div>

            {redeemed ? (
              <div className="mt-6 flex items-center gap-3 rounded-lg border border-border bg-muted p-4">
                <CircleSlash className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                <div>
                  <p className="text-sm font-medium text-card-foreground">Already redeemed</p>
                  <p className="text-xs text-muted-foreground">
                    Used{" "}
                    {view.voucher.redeemedAt
                      ? posDisplayDateTime(new Date(view.voucher.redeemedAt))
                      : "at the till"}
                    .
                  </p>
                </div>
              </div>
            ) : expired ? (
              <div className="mt-6 flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
                <TriangleAlert className="h-5 w-5 shrink-0 text-destructive" aria-hidden />
                <div>
                  <p className="text-sm font-medium text-card-foreground">This voucher expired</p>
                  <p className="text-xs text-muted-foreground">
                    Expired {(expiresAt ? posDisplayDateTime(expiresAt) : undefined)}.
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-6 flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/10 p-4">
                <BadgeCheck className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                <div>
                  <p className="text-sm font-medium text-card-foreground">Ready to use</p>
                  <p className="text-xs text-muted-foreground">
                    Show this screen at the counter — the cashier scans the code.
                  </p>
                </div>
              </div>
            )}

            <div className="mt-6 flex flex-col items-center">
              <img
                src={qr}
                alt={`QR code for voucher ${view.voucher.tokenSlug}`}
                className={`h-48 w-48 rounded-lg bg-white p-2 ${usable ? "" : "opacity-30 grayscale"}`}
              />
              <p className="mt-3 font-mono text-sm tracking-wider text-card-foreground">
                {view.voucher.tokenSlug}
              </p>
            </div>

            {usable && remaining ? (
              <p className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" aria-hidden />
                Expires in <span className="font-mono text-card-foreground">{remaining}</span>
              </p>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
