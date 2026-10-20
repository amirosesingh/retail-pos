import { formatDateTime as posDisplayDateTime } from "@/lib/time-zone";
export const nativeApprovalCredentials = true;
import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/pos-auth";
import {
  enrollOwnApprovalToken,
  loadApprovalToken,
  TOKEN_CHANGED,
  type ApprovalToken,
} from "@/lib/approval-token-client";
import { approvalTotp } from "@/lib/approval-totp";
import { isWindowsShell } from "@/platform-config/features";
import { subscribeBackgroundRefresh } from "@/lib/background-refresh";

export function ApprovalTokenAgent() {
  const { user } = useAuth();
  const id = user?.staffId;
  useEffect(() => {
    if (!id || (isWindowsShell() && !user?.permissions.can_manage_staff)) return;
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
/** Only a Keystore enrollment bound to the retained sign-in and registered device is shown. */
export function ApprovalTokenButton() {
  const [token, setToken] = useState<ApprovalToken | null>(null);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [seconds, setSeconds] = useState(30);
  useEffect(() => {
    let stopped = false;
    let generation = 0;
    const refresh = () => {
      const request = ++generation;
      void loadApprovalToken()
        .then((value) => {
          if (!stopped && request === generation) setToken(value);
        })
        .catch(() => {
          if (!stopped) setToken(null);
        });
    };
    refresh();
    const timer = setInterval(refresh, 30_000);
    window.addEventListener(TOKEN_CHANGED, refresh);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener(TOKEN_CHANGED, refresh);
    };
  }, []);
  useEffect(() => {
    let stopped = false;
    if (!open || !token) return;
    const tick = () => {
      if (token.validUntil <= Date.now()) {
        setToken(null);
        return;
      }
      setSeconds(30 - (Math.floor(Date.now() / 1000) % 30));
      void approvalTotp(token.secret)
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
  }, [open, token]);
  if (!token) return null;
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ShieldCheck className="size-4" /> Approval token
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Approval token</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            {token.name} · {token.userId}
          </p>
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
            Offline enrollment valid until {posDisplayDateTime(new Date(token.validUntil))}. Reconnect
            to renew.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
