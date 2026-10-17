import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "@tanstack/react-router";
import { isTerminalApp } from "@/platform-config/platform";
import { configuredPublicHost, publicHostPage, type PublicHostConfig } from "@/lib/public-host-routing";
import { readPublicHostConfig } from "@/lib/public-host-config.functions";
import { usePublicFlags } from "@/lib/public-flags";
import { PublicPageClosed } from "./PublicPageClosed";
import { Button } from "@/components/ui/button";

/** Classify web hosts before mounting any staff login, shift or till workers. */
export function PublicHostBoundary({ pathname, children }: { pathname: string; children: ReactNode }) {
  if (isTerminalApp()) return children;
  return <WebHostBoundary pathname={pathname}>{children}</WebHostBoundary>;
}

function WebHostBoundary({ pathname, children }: { pathname: string; children: ReactNode }) {
  const [config, setConfig] = useState<PublicHostConfig | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setFailed(false);
    void readPublicHostConfig({ signal: AbortSignal.timeout(8_000) }).then(
      (value) => { if (active) setConfig(value); },
      () => { if (active) setFailed(true); },
    );
    return () => { active = false; };
  }, [attempt]);
  if (!config) return <main className="flex min-h-screen items-center justify-center bg-background p-6" aria-live="polite">
    {failed ? <div className="max-w-sm space-y-3 text-center">
      <p className="text-sm text-muted-foreground">Unable to connect. Please try again.</p>
      <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>Retry</Button>
    </div> : <p className="text-sm text-muted-foreground">Loading…</p>}
  </main>;
  const host = configuredPublicHost(window.location.host, config);
  if (!host.member && !host.redeem) return children;
  return <CustomerHost host={host} pathname={pathname}>{children}</CustomerHost>;
}

function CustomerHost({ host, pathname, children }: {
  host: { member: boolean; redeem: boolean }; pathname: string; children: ReactNode;
}) {
  const { flags, ready } = usePublicFlags();
  if (!ready) return <main className="min-h-screen bg-background" aria-label="Loading" />;
  const page = publicHostPage(host, pathname, flags);
  if (page === "member-root") return <Navigate to="/join" replace />;
  if (page === "customer") return children;
  if (page === "voucher-root") return <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
    <section className="w-full max-w-sm space-y-3 rounded-xl border border-border bg-card p-6 text-center">
      <h1 className="text-lg font-semibold">Your vouchers</h1>
      <p className="text-sm text-muted-foreground">Open your personal voucher link or scan its QR code to view your voucher.</p>
    </section>
  </main>;
  return <PublicPageClosed what={host.member && !host.redeem ? "Membership" : "Voucher redemption"} />;
}
