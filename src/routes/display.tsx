import { useEffect, useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { X } from "lucide-react";

import {
  readDisplaySnapshot,
  subscribeDisplay,
  subscribeDisplayShutdown,
  type DisplaySnapshot,
} from "@/lib/customer-display";
import { qrSvg } from "@/lib/pos-print";
import { resolvePaymentQr, whatsappLink } from "@/core/types/pos-types";

export const Route = createFileRoute("/display")({
  head: () => ({
    meta: [
      { title: "Customer Display — Live Order Screen" },
      {
        name: "description",
        content:
          "Second-screen customer display showing the live basket, discounts, totals and bank transfer details.",
      },
      { property: "og:title", content: "Customer Display — Live Order Screen" },
      {
        property: "og:description",
        content: "Live basket, totals and payment instructions for the customer-facing screen.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CustomerDisplay,
});

const money = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });

/** A basket left on screen this long without an update is stale: fall back to
 *  the idle screen rather than showing customers an abandoned order. */
const STALE_MS = 5 * 60 * 1000;

function CustomerDisplay() {
  const [snap, setSnap] = useState<DisplaySnapshot | null>(null);
  const [tillClosed, setTillClosed] = useState(false);
  const router = useRouter();

  // The display is often launched from the sidebar in the same window, so it
  // needs its own way back to the till.
  const exit = () => {
    if (typeof window !== "undefined" && window.opener) {
      window.close();
      return;
    }
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.history.back();
      return;
    }
    void router.navigate({ to: "/" });
  };

  useEffect(() => {
    setSnap(readDisplaySnapshot());
    return subscribeDisplay((s) => {
      setTillClosed(false);
      setSnap(s);
    });
  }, []);

  // The till went away: close with it, or say so if the browser refuses.
  useEffect(
    () =>
      subscribeDisplayShutdown(() => {
        setSnap(null);
        setTillClosed(true);
        try {
          window.close();
        } catch {
          /* closing is only allowed for script-opened windows */
        }
      }),
    [],
  );

  // Drop back to idle when the counter stops publishing.
  useEffect(() => {
    if (!snap) return;
    const age = Date.now() - (snap.at || 0);
    const timer = setTimeout(() => setSnap(null), Math.max(1000, STALE_MS - age));
    return () => clearTimeout(timer);
  }, [snap]);

  const pay = snap?.payment ?? null;
  const transferMode = snap?.mode === "transfer";
  const wa = pay?.whatsapp ? whatsappLink(pay.whatsapp) : "";
  const payQr = resolvePaymentQr(pay?.paymentQr, snap?.total ?? 0, snap?.reference ?? "");
  const showTransfer =
    !!pay && (!!pay.accountNumber || !!pay.whatsapp || !!pay.accountName || !!payQr);

  if (tillClosed)
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-background p-8 text-center text-foreground">
        <h1 className="text-4xl font-bold tracking-tight">Till closed</h1>
        <p className="mt-2 text-muted-foreground">
          This counter has shut down. You may close this window.
        </p>
      </main>
    );

  const idle = !snap || snap.mode === "idle" || snap.lines.length === 0;
  if (idle)
    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-8 text-foreground">
        <div className="absolute -left-24 top-[-12rem] size-[34rem] rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -bottom-48 right-[-8rem] size-[38rem] rounded-full bg-accent/20 blur-3xl" />
        <button
          type="button"
          onClick={exit}
          aria-label="Close customer display"
          className="absolute right-6 top-6 z-10 flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-4 py-2 text-sm text-muted-foreground backdrop-blur hover:text-foreground"
        >
          <X className="size-4" /> Back to till
        </button>
        <div className="relative z-10 flex max-w-2xl flex-col items-center rounded-[2rem] border border-white/10 bg-card/60 px-16 py-14 text-center shadow-2xl backdrop-blur-xl">
          <BrandMark logo={snap?.logo} name={snap?.companyName || "Welcome"} large />
          <h1 className="mt-7 text-5xl font-bold tracking-tight">
            {snap?.companyName || "Welcome"}
          </h1>
          <p className="mt-3 text-lg text-muted-foreground">
            {snap?.storeName || "Your items will appear here as they are scanned."}
          </p>
        </div>
      </main>
    );

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-baseline justify-between border-b border-border px-8 py-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{snap?.companyName || "Welcome"}</h1>
          <p className="text-sm text-muted-foreground">
            {snap?.storeName ?? "Please wait for the cashier"}
          </p>
        </div>
        {snap?.memberName && (
          <div className="text-right">
            <p className="text-sm font-semibold">{snap.memberName}</p>
            <p className="numeric text-xs text-muted-foreground">{snap.memberPoints ?? 0} points</p>
          </div>
        )}
        <button
          type="button"
          onClick={exit}
          aria-label="Close customer display"
          className="ml-4 flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
          Back to till
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 p-8 lg:grid-cols-[minmax(15rem,0.7fr)_minmax(0,1.6fr)]">
        <section className="relative hidden min-h-0 overflow-hidden rounded-[2rem] border border-border bg-gradient-to-br from-primary/20 via-card to-accent/15 p-8 lg:row-span-2 lg:flex lg:flex-col lg:items-center lg:justify-center lg:text-center">
          <div className="absolute -left-20 -top-20 size-64 rounded-full bg-primary/25 blur-3xl" />
          <div className="absolute -bottom-24 -right-20 size-72 rounded-full bg-accent/20 blur-3xl" />
          <div className="relative z-10">
            <BrandMark logo={snap.logo} name={snap.companyName} large />
            <p className="mt-6 text-2xl font-bold tracking-tight">{snap.companyName}</p>
            <p className="mt-2 text-sm text-muted-foreground">{snap.storeName}</p>
            <p className="mt-8 text-xs uppercase tracking-[0.24em] text-muted-foreground">
              Thank you for shopping with us
            </p>
          </div>
        </section>

        <section className="flex min-h-0 flex-col lg:col-start-2">
          <ul className="min-h-0 flex-1 space-y-2 overflow-auto pr-2">
            {snap.lines.map((l, i) => (
              <li
                key={`${l.name}-${i}`}
                className="flex items-start justify-between rounded-lg border border-border px-4 py-3"
              >
                <div>
                  <p className="text-lg font-medium">
                    {l.name}
                    {l.foc && (
                      <span className="ml-2 rounded bg-success/15 px-2 py-0.5 text-xs text-success">
                        FREE
                      </span>
                    )}
                    {l.credit && (
                      <span className="ml-2 rounded bg-accent/15 px-2 py-0.5 text-xs text-accent">
                        RETURN
                      </span>
                    )}
                  </p>
                  <p className="numeric text-sm text-muted-foreground">
                    {l.qty} × {money(l.price)}
                    {l.discount ? ` · less ${money(l.discount)}` : ""}
                  </p>
                </div>
                <span className="numeric text-lg font-semibold">{money(l.lineTotal)}</span>
              </li>
            ))}
          </ul>
        </section>

        <aside className="flex flex-col gap-4 lg:col-start-2">
          <div className="rounded-xl border border-border p-5">
            <Row label="Subtotal" value={money(snap?.subtotal ?? 0)} />
            <Row label="Discount" value={`-${money(snap?.discount ?? 0)}`} />
            {snap?.taxEnabled && (snap.tax ?? 0) > 0 ? (
              <Row label={`Tax ${snap.taxRate ?? 0}%`} value={money(snap.tax)} />
            ) : null}
            {snap?.promos?.length ? (
              <ul className="mt-2 space-y-0.5 border-t border-border pt-2">
                {snap.promos.map((p) => (
                  <li key={p} className="text-xs text-success">
                    {p}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-3 flex items-end justify-between border-t border-border pt-3">
              <span className="text-sm uppercase tracking-wide text-muted-foreground">
                {snap?.mode === "booking"
                  ? "Booking total"
                  : transferMode
                    ? "Amount to transfer"
                    : "Total"}
              </span>
              <span className="numeric text-4xl font-bold text-primary">
                {money(snap?.total ?? 0)}
              </span>
            </div>
            {snap?.mode === "paid" && (
              <div className="mt-3 space-y-1 border-t border-border pt-3">
                <Row label="Paid" value={money(snap.paid)} />
                <Row label="Change" value={money(snap.change)} />
                <p className="numeric text-xs text-muted-foreground">Receipt {snap.reference}</p>
              </div>
            )}
            {snap?.mode === "booking" && (
              <div className="mt-3 space-y-1 border-t border-border pt-3">
                <Row label="Deposit paid" value={money(snap.paid)} />
                <Row label="Balance due" value={money(snap.balance)} />
                <p className="text-xs text-muted-foreground">
                  Booking {snap.reference} · collect by{" "}
                  {snap.dueDate ? new Date(snap.dueDate).toDateString() : "—"}
                </p>
              </div>
            )}
          </div>

          {showTransfer && (
            <div
              className={`rounded-xl border p-5 ${
                transferMode ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {transferMode ? "Please transfer to" : "Pay by bank transfer"}
              </p>
              {transferMode && (
                <p className="numeric mt-1 text-3xl font-bold text-primary">
                  {money(snap?.total ?? 0)}
                </p>
              )}
              <div className="mt-3 space-y-1 text-sm">
                {pay?.bankName && <Row label="Bank" value={pay.bankName} />}
                {pay?.accountName && <Row label="Account name" value={pay.accountName} />}
                {pay?.accountNumber && <Row label="Account no." value={pay.accountNumber} strong />}
                {pay?.whatsapp && <Row label="WhatsApp" value={pay.whatsapp} />}
                {transferMode && snap?.transferRef && (
                  <Row label="Reference" value={snap.transferRef} strong />
                )}
              </div>
              {pay?.note && <p className="mt-2 text-xs text-muted-foreground">{pay.note}</p>}
              <div className="mt-3 flex flex-wrap items-start gap-4">
                {payQr && (
                  <div className="text-center">
                    <div
                      className="rounded bg-white p-2"
                      dangerouslySetInnerHTML={{
                        __html: qrSvg(payQr, transferMode ? 190 : 130),
                      }}
                    />
                    <p className="mt-1 text-xs font-medium">
                      {pay?.paymentQr?.label || "Scan to pay"}
                    </p>
                  </div>
                )}
                {wa && (
                  <div className="text-center">
                    <div
                      className="rounded bg-white p-2"
                      dangerouslySetInnerHTML={{ __html: qrSvg(wa, transferMode ? 150 : 110) }}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">Send your slip on WhatsApp</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`numeric text-sm ${strong ? "font-bold" : ""}`}>{value}</span>
    </div>
  );
}

function BrandMark({
  logo,
  name,
  large = false,
}: {
  logo?: string;
  name: string;
  large?: boolean;
}) {
  const size = large ? "size-36" : "size-20";
  if (logo) {
    return (
      <img
        src={logo}
        alt={`${name} logo`}
        className={`${size} mx-auto rounded-3xl object-contain drop-shadow-2xl`}
      />
    );
  }
  return (
    <div
      className={`${size} mx-auto grid place-items-center rounded-3xl bg-primary text-5xl font-bold text-primary-foreground shadow-2xl`}
    >
      {(name.trim()[0] || "P").toUpperCase()}
    </div>
  );
}
