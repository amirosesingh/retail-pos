import { formatDateTime as posDisplayDateTime } from "@/lib/time-zone";
export const nativeApprovalCredentials = true;
import { useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/pos-auth";
import {
  enrollOwnApprovalToken, offlineTokenOwner, setupOfflineApprovalToken, unlockOfflineApprovalToken,
  loadApprovalToken,
  TOKEN_CHANGED,
  type ApprovalToken,
} from "@/lib/approval-token-client";
import { approvalTotp } from "@/lib/approval-totp";
import { subscribeBackgroundRefresh } from "@/lib/background-refresh";

export function ApprovalTokenAgent() {
  const { user } = useAuth();
  const id = user?.staffId;
  useEffect(() => {
    if (!id) return;
    const refresh = () => {
      void enrollOwnApprovalToken(id).catch(() => {
        /* Keep the last valid enrollment while reconnecting. */
      });
    };
    refresh();
    return subscribeBackgroundRefresh(refresh, 60_000);
  }, [id, user?.permissions.can_manage_staff]);
  return null;
}
/** Only an OS-vault enrollment bound to the retained sign-in and registered device is shown. */
export function ApprovalTokenButton() {
  const [token, setToken] = useState<ApprovalToken | null>(null);
  const [open, setOpen] = useState(false);
  const [owner, setOwner] = useState<{ name: string; userId: string } | null>(null);
  const [unlocked, setUnlocked] = useState<ApprovalToken | null>(null);
  const [pin, setPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const unlockGeneration = useRef(0);
  const displayed = token || unlocked;
  const close = () => { unlockGeneration.current++; setOpen(false); setUnlocked(null); setPin(""); setConfirmation(""); setError(""); setCode(""); };
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
    return () => {
      stopped = true;
      stopRefresh();
      window.removeEventListener(TOKEN_CHANGED, refresh);
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
  if (!token && !owner && !unlocked) return null;
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ShieldCheck className="size-4" /> Approval token
      </Button>
      <Dialog open={open} onOpenChange={value => { if (value) setOpen(true); else close(); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Approval token</DialogTitle>
          </DialogHeader>
          <p className="text-sm">{(displayed || owner)?.name} · {(displayed || owner)?.userId}</p>
          {!displayed && <form className="space-y-3" onSubmit={async event => {
            event.preventDefault(); if (busy) return; setBusy(true); setError("");
            try { const ticket = ++unlockGeneration.current; const value = await unlockOfflineApprovalToken(pin); if (!document.hidden && ticket === unlockGeneration.current) setUnlocked(value); setPin(""); }
            catch (e) { setError(e instanceof Error ? e.message : "Could not unlock token"); }
            finally { setBusy(false); }
          }}>
            <label className="text-sm" htmlFor="token-unlock-pin">Token unlock PIN</label>
            <input id="token-unlock-pin" className="h-10 w-full rounded-md border bg-background px-3" type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ""))} />
            <Button disabled={busy || pin.length < 6} type="submit">Unlock token</Button>
            <p className="text-xs text-muted-foreground">Unlocks only this approval token. You remain signed out of the POS.</p>
          </form>}
          {displayed && <>
          <p
            className="numeric text-center text-3xl font-semibold tracking-[0.2em]"
            aria-label="Your approval token"
          >
            {code || "••••••••"}
          </p>
          <p className="text-center text-sm text-muted-foreground">
            Changes in {seconds}s · Works without internet
          </p>
          <p className="text-xs text-muted-foreground">
            Enter your staff ID and this code in the approval field. Your approval permissions and
            limits still apply.
          </p>
          <p className="text-xs text-muted-foreground">
            Offline enrollment valid until {posDisplayDateTime(new Date(displayed.validUntil))}. Reconnect
            to renew.
          </p>
          </>}
          {token && <div className="space-y-2 border-t pt-3">
            <p className="text-xs text-muted-foreground">Set a separate 6–12 digit unlock PIN to use your token from the login screen offline. This replaces any other saved token owner on this device.</p>
            <label className="text-sm" htmlFor="token-setup-pin">New token unlock PIN</label>
            <input id="token-setup-pin" className="h-10 w-full rounded-md border bg-background px-3" type="password" inputMode="numeric" autoComplete="new-password" maxLength={12} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ""))} />
            <label className="text-sm" htmlFor="token-confirm-pin">Confirm unlock PIN</label>
            <input id="token-confirm-pin" className="h-10 w-full rounded-md border bg-background px-3" type="password" inputMode="numeric" autoComplete="new-password" maxLength={12} value={confirmation} onChange={e => setConfirmation(e.target.value.replace(/\D/g, ""))} />
            <Button disabled={busy || pin.length < 6} onClick={async () => {
              if (pin !== confirmation) { setError("Unlock PINs must match."); return; }
              setBusy(true); setError("");
              try { await setupOfflineApprovalToken(pin); setPin(""); setConfirmation(""); setError("Offline token access saved."); }
              catch (e) { setError(e instanceof Error ? e.message : "Could not save token access"); }
              finally { setBusy(false); }
            }}>Save offline access</Button>
          </div>}
          {error && <p role="status" className="text-sm">{error}</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}
