import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/pos-auth";
import { isDesktop } from "@/lib/branding";
import { createLoginView, type LoginView } from "@/lib/login-view";
import { ensureDesktopPosSession } from "@/lib/desktop-pos-session";
import { LegacyShiftRecoveryReview } from "./LegacyShiftRecoveryReview";
import { HeldBillRecoveryReview } from "./HeldBillRecoveryReview";

/** Recovery presentation only. NativeBoot still prevents trading; Main still
 * verifies the real POS Administrator, author, terminal and every SQL write. */
export function StartupShiftRecoveryReview({ connected, renderLogin }: { connected: boolean; renderLogin: (view: LoginView) => ReactNode }) {
  const { ready, user, isAdmin, authUserId, logout } = useAuth();
  const personId = user?.staffId ?? null;
  const [view] = useState(() => { const value = createLoginView(); value.chooseMode("admin"); return value; });
  const [verified, setVerified] = useState(false), [error, setError] = useState<string | null>(null), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true; setVerified(false); setError(null);
    if (!connected || !ready || !personId || !isAdmin || !isDesktop()) return;
    void (async () => {
      const result = await ensureDesktopPosSession();
      if (!result.ok) throw new Error(result.error ?? "Administrator sign-in could not be verified on this PC.");
      const status = await window.sqlAdmin?.adminStatus?.();
      if (!status?.unlocked || status.source !== "pos" || status.level !== "admin") throw new Error("Sign in as Administrator through the POS to review saved closings.");
      if (current) setVerified(true);
    })().catch(cause => { if (current) setError(cause instanceof Error ? cause.message : "Administrator sign-in could not be verified."); });
    return () => { current = false; };
  }, [connected, ready, personId, isAdmin, authUserId, attempt]);
  if (!isDesktop() || !connected) return null;
  return <section className="space-y-3 rounded-md border p-4" aria-label="Administrator shift recovery">
    <h2 className="font-semibold">Review saved shifts</h2>
    <p className="text-sm text-muted-foreground">Trading remains blocked until database recovery is verified. Use your ordinary Administrator account to compare saved closings; Emergency access does not authorize this review.</p>
    {!ready ? <p role="status" className="text-sm">Checking your POS sign-in…</p>
      : !user ? <div className="[&>div]:min-h-0 [&>div]:p-0 [&>div>div]:max-w-none">{renderLogin(view)}</div>
        : !isAdmin ? <><p role="alert" className="text-sm">This signed-in account cannot approve saved shift recovery.</p><Button variant="outline" onClick={() => void logout()}>Sign in as Administrator</Button></>
          : verified ? <div className="flex flex-wrap gap-2"><LegacyShiftRecoveryReview /><HeldBillRecoveryReview /></div>
            : <p role={error ? "alert" : "status"} className="text-sm">{error ?? "Verifying Administrator access on this PC…"}</p>}
    {error ? <Button variant="outline" onClick={() => setAttempt(value => value + 1)}>Retry Administrator verification</Button> : null}
  </section>;
}
