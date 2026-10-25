export const nativeApprovalCredentials = true;
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth, useAuthOptional } from "@/lib/pos-auth";
import {
  enrollOwnApprovalToken, offlineTokenOwner, setupOfflineApprovalToken, unlockOfflineApprovalToken,
  loadApprovalToken, revalidateOfflineApprovalToken,
  TOKEN_CHANGED, TOKEN_RENEWED,
  type ApprovalToken,
} from "@/lib/approval-token-client";
import { approvalTotp } from "@/lib/approval-totp";
import { subscribeBackgroundRefresh } from "@/lib/background-refresh";
import { approvalMethods } from "@/lib/approval-credentials";
import { readTerminalConfig, subscribeTerminalConfig } from "@/core/activation/terminal-tokens";
import { canIssueApprovalTokenOnDevice } from "@/lib/approval-token-device";
import { APP_RESUME_EVENT } from "@/core/activation/connection-health";

export function ApprovalTokenAgent() {
  const { user, appUser } = useAuth();
  const id = user?.staffId;
  const methodEnabled = approvalMethods(appUser?.permissions as Record<string, unknown> | null).totp;
  useEffect(() => {
    if (!id) return;
    const refresh = () => {
      void enrollOwnApprovalToken(id).catch(() => {
        /* Keep the last valid enrollment while reconnecting. */
      });
    };
    refresh();
    // Launch, foreground and reconnection revalidate immediately. A bounded
    // interval catches revocation without polling the database every minute.
    return subscribeBackgroundRefresh(refresh, 15 * 60_000);
  }, [id, methodEnabled]);
  return null;
}
/** Only an OS-vault enrollment bound to the retained sign-in and registered device is shown. */
export function ApprovalTokenButton({ compact = false }: { compact?: boolean }) {
  const eligible = useSyncExternalStore(subscribeTerminalConfig,
    canIssueApprovalTokenOnDevice, canIssueApprovalTokenOnDevice);
  return eligible ? <ApprovalTokenControl compact={compact} /> : null;
}

function ApprovalTokenControl({ compact = false }: { compact?: boolean }) {
  // The sign-in and offline recovery screens can render outside AuthProvider.
  // A saved, device-bound token must remain unlockable there without signing in.
  const auth = useAuthOptional();
  const user = auth?.user ?? null;
  const appUser = auth?.appUser ?? null;
  const maySetUp = Boolean(user && appUser && readTerminalConfig()?.tokenId &&
    approvalMethods(appUser.permissions as Record<string, unknown> | null).totp);
  const [token, setToken] = useState<ApprovalToken | null>(null);
  const [open, setOpen] = useState(false);
  const [owner, setOwner] = useState<{ name: string; userId: string; validUntil: number; expired: boolean } | null>(null);
  const [unlocked, setUnlocked] = useState<ApprovalToken | null>(null);
  const [pin, setPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [replacePin, setReplacePin] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const unlockGeneration = useRef(0);
  const visibleToken = token && user?.staffId.toLowerCase() === token.userId.toLowerCase() ? token : null;
  const visibleUnlocked = unlocked && (!user || user.staffId.toLowerCase() === unlocked.userId.toLowerCase()) ? unlocked : null;
  const displayed = visibleToken || visibleUnlocked;
  // A different signed-in operator may set up their own token without being
  // shown the previous operator's offline enrollment.
  const visibleOwner = owner && (!user || owner.userId.toLowerCase() === user.staffId.toLowerCase())
    ? owner : null;
  const renewalNeeded = Boolean(visibleOwner && visibleOwner.validUntil - Date.now() <= 7 * 24 * 60 * 60 * 1000);
  const close = () => { unlockGeneration.current++; setOpen(false); setUnlocked(null); setPin(""); setConfirmation(""); setReplacePin(false); setError(""); setCode(""); };
  useEffect(() => {
    const lock = () => { if (document.hidden) close(); };
    const reset = () => { unlockGeneration.current++; setUnlocked(null); setCode(""); };
    document.addEventListener("visibilitychange", lock);
    window.addEventListener(TOKEN_CHANGED, reset);
    return () => { document.removeEventListener("visibilitychange", lock); window.removeEventListener(TOKEN_CHANGED, reset); };
  }, []);
  const [code, setCode] = useState("");
  const [seconds, setSeconds] = useState(30);
  useEffect(() => {
    let stopped = false;
    let generation = 0;
    const refresh = () => {
      const request = ++generation;
      void offlineTokenOwner().then(value => { if (!stopped && request === generation) setOwner(value); }).catch(() => { if (!stopped) setOwner(null); });
      void loadApprovalToken()
        .then((value) => {
          if (!stopped && request === generation) setToken(value);
        })
        .catch(() => {
          if (!stopped) setToken(null);
        });
    };
    refresh();
    const stopRefresh = subscribeBackgroundRefresh(refresh, 30_000);
    window.addEventListener(TOKEN_CHANGED, refresh);
    window.addEventListener(TOKEN_RENEWED, refresh);
    return () => {
      stopped = true;
      stopRefresh();
      window.removeEventListener(TOKEN_CHANGED, refresh);
      window.removeEventListener(TOKEN_RENEWED, refresh);
    };
  }, []);
  useEffect(() => {
    const check = () => {
      if (document.hidden || !navigator.onLine) return;
      void revalidateOfflineApprovalToken().catch(() => {
        // Keep the last verified enrollment during transient network failures.
      });
    };
    check();
    const timer = window.setInterval(check, 15 * 60_000);
    window.addEventListener("online", check);
    window.addEventListener(APP_RESUME_EVENT, check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", check);
      window.removeEventListener(APP_RESUME_EVENT, check);
    };
  }, []);
  useEffect(() => {
    let stopped = false;
    if (!open || !displayed) return;
    let lastStep = -1;
    const tick = () => {
      if (displayed.validUntil <= Date.now()) {
        setToken(null); setUnlocked(null); setCode("");
        return;
      }
      setSeconds(30 - (Math.floor(Date.now() / 1000) % 30));
      const step = Math.floor(Date.now() / 30000);
      if (step === lastStep) return;
      lastStep = step;
      void approvalTotp(displayed.secret)
        .then((value) => {
          if (!stopped) setCode(value);
        })
        .catch(() => {
          if (!stopped) setCode("");
        });
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [open, displayed]);
  if (!visibleToken && !visibleOwner && !visibleUnlocked && !maySetUp) return null;
  return (
    <>
      <Button variant="outline" size={compact ? "icon" : "sm"} aria-label="Soft token" onClick={() => setOpen(true)}>
        <ShieldCheck className="size-4" /> {!compact && (visibleToken && !visibleOwner ? "Register soft token" : !displayed && !visibleOwner ? "Set up soft token" : "Soft token")}
      </Button>
      <Dialog open={open} onOpenChange={value => { if (value) setOpen(true); else close(); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Soft token</DialogTitle>
          </DialogHeader>
          {(displayed || visibleOwner) && <p className="text-sm">{(displayed || visibleOwner)?.name} · {(displayed || visibleOwner)?.userId}</p>}
          {!displayed && !visibleOwner && maySetUp && <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Connect once to register your permitted soft token on this device. Then set an unlock PIN to use it from the sign-in screen offline.</p>
            <Button disabled={busy} onClick={async () => {
              setBusy(true); setError("");
              try {
                if (!navigator.onLine) throw new Error("Connect once to register this soft token. An already registered soft token can still be unlocked offline.");
                await enrollOwnApprovalToken(appUser!.user_id);
                const value = await loadApprovalToken();
                if (!value) throw new Error("This device or account is not enabled for soft tokens. Ask an administrator to check both settings and the approval rule.");
                setToken(value);
              } catch (e) { setError(e instanceof Error ? e.message : "Could not register soft token"); }
              finally { setBusy(false); }
            }}>Retry soft token registration</Button>
          </div>}
          {!displayed && visibleOwner && !visibleOwner.expired && <form className="space-y-3" onSubmit={async event => {
            event.preventDefault(); if (busy) return; setBusy(true); setError("");
            try { const ticket = ++unlockGeneration.current; const value = await unlockOfflineApprovalToken(pin); if (!document.hidden && ticket === unlockGeneration.current) setUnlocked(value); setPin(""); }
            catch (e) { setError(e instanceof Error ? e.message : "Could not unlock soft token"); }
            finally { setBusy(false); }
          }}>
            <label className="text-sm" htmlFor="token-unlock-pin">Soft token unlock PIN</label>
            <input id="token-unlock-pin" className="h-10 w-full rounded-md border bg-background px-3" type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ""))} />
            <Button disabled={busy || pin.length < 6} type="submit">Unlock soft token</Button>
            <p className="text-xs text-muted-foreground">Unlocks only this soft token. You remain signed out of the POS.</p>
          </form>}
          {visibleOwner?.expired && <p className="text-xs text-amber-700 dark:text-amber-400">Connect to the internet to renew the soft token.</p>}
          {displayed && <>
          <p
            className="numeric text-center text-3xl font-semibold tracking-[0.2em]"
            aria-label="Your soft token"
          >
            {code || "••••••••"}
          </p>
          <p className="text-center text-sm text-muted-foreground">
            Changes in {seconds}s · {visibleOwner ? "Works without internet" : "Save an unlock PIN for offline access"}
          </p>
          <p className="text-xs text-muted-foreground">
            Choose Soft token and enter this code in the approval field. Your account is identified automatically; your approval permissions and
            limits still apply.
          </p>
          {renewalNeeded && <p className="text-xs text-amber-700 dark:text-amber-400">Connect to the internet to renew the soft token.</p>}
          </>}
          {visibleToken && visibleOwner && !replacePin && <Button variant="outline" size="sm" onClick={() => { setPin(""); setConfirmation(""); setReplacePin(true); }}>Change soft token unlock PIN</Button>}
          {visibleToken && (!visibleOwner || replacePin) && <div className="space-y-2 border-t pt-3">
            <p className="text-xs text-muted-foreground">Register this signed-in user’s token on this device with a separate 6–12 digit unlock PIN. You can then open it from the login screen without internet. This replaces any other saved token owner on this device.</p>
            <label className="text-sm" htmlFor="token-setup-pin">New soft token unlock PIN</label>
            <input id="token-setup-pin" className="h-10 w-full rounded-md border bg-background px-3" type="password" inputMode="numeric" autoComplete="new-password" maxLength={12} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ""))} />
            <label className="text-sm" htmlFor="token-confirm-pin">Confirm unlock PIN</label>
            <input id="token-confirm-pin" className="h-10 w-full rounded-md border bg-background px-3" type="password" inputMode="numeric" autoComplete="new-password" maxLength={12} value={confirmation} onChange={e => setConfirmation(e.target.value.replace(/\D/g, ""))} />
            <Button disabled={busy || pin.length < 6} onClick={async () => {
              if (pin !== confirmation) { setError("Unlock PINs must match."); return; }
              setBusy(true); setError("");
              try { await setupOfflineApprovalToken(pin); setPin(""); setConfirmation(""); setReplacePin(false); setError("Soft token access saved."); }
              catch (e) { setError(e instanceof Error ? e.message : "Could not save soft token access"); }
              finally { setBusy(false); }
            }}>Register soft token</Button>
          </div>}
          {error && <p role="status" className="text-sm">{error}</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}
