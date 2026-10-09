/**
 * Asks for an administrator's own username and PIN when the till refuses a
 * privileged action, and stops the register outright when the desktop process
 * reports that its records or identity can no longer be trusted.
 *
 * The refusal itself is made by the desktop process, not here: this component
 * only turns that refusal into something an operator can act on. It wraps the
 * bridge once, so every existing screen gets the prompt without being changed.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { wrapBridge, registerDesktopBridge } from "@/platforms/windows/privilege-bridge";
import { onRecoveryScreen } from "@/lib/recovery-route";
import { useAuth } from "@/lib/pos-auth";
import { readCredentials } from "@/lib/pos-credentials";
import { readTerminalConfig } from "@/core/activation/terminal-tokens";
import { toast } from "sonner";

type Ask = {
  message: string;
  requiredLevel?: "admin" | "supervisor";
  resolve: (unlocked: boolean) => void;
};

/** Bridges that carry privileged calls. */
const BRIDGES = ["pos", "electronAPI", "sqlAdmin"] as const;

export function PrivilegeGate({ children }: { children: React.ReactNode }) {
  const { ready, user } = useAuth();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const asking = useRef<Promise<boolean> | null>(null);
  // Emergency Access exists to repair a broken till; it must never be gated or
  // blanked by this component.
  const recovery = useRef(onRecoveryScreen()).current;

  // Reuse the already validated online identity. The main process sends the
  // token only to the configured backend and derives the privilege there; it
  // never trusts a role claimed by this window.
  useEffect(() => {
    if (recovery || !ready) return;
    const bridge = window.sqlAdmin;
    if (!bridge?.adoptSession || !bridge.lockAdmin) return;
    let active = true;
    const sync = async () => {
      if (!user) {
        await bridge.lockAdmin?.();
        return;
      }
      const proof = await readCredentials();
      if (!active) return;
      await bridge.adoptSession?.(proof, readTerminalConfig());
    };
    void sync();
    return () => {
      active = false;
    };
  }, [ready, recovery, user]);

  /* One prompt at a time, however many calls are refused at once. */
  const requestUnlock = useCallback(
    async (message: string, requiredLevel?: "admin" | "supervisor"): Promise<boolean> => {
      // A live online account gets one immediate server-verified refresh before
      // any local override is requested. This also closes the small launch race
      // between auth hydration and the first protected click.
      // Always ask the backend to adopt a live signed-in session. The client
      // may be carrying older cached permissions; the server re-reads
      // public.app_users before granting desktop database access.
      if (user) {
        const adopted = await window.sqlAdmin?.adoptSession?.(
          await readCredentials(),
          readTerminalConfig(),
        );
        if (adopted?.ok) {
          if (requiredLevel === "admin" && adopted.level !== "admin") {
            toast.error("Administrator access required", {
              description:
                "Your Supervisor account can use read-only database tools, but cannot make this change.",
            });
            return false;
          }
          return true;
        }
      }
      if (!asking.current) {
        asking.current = new Promise<boolean>((resolve) => {
          setAsk({
            message,
            requiredLevel,
            resolve: (ok) => {
              asking.current = null;
              setAsk(null);
              setUsername("");
              setPin("");
              setError("");
              resolve(ok);
            },
          });
        });
      }
      return asking.current;
    },
    [user],
  );

  useEffect(() => {
    const win = window as unknown as Record<string, Record<string, unknown> | undefined>;
    const pos = win["pos"] as
      { onFatal?: (cb: (p: { message: string }) => void) => () => void } | undefined;
    if (!pos || recovery) return; // web and Android have no desktop bridge

    const undo: Array<() => void> = [];
    let off: (() => void) | undefined;

    // The desktop shell hands these objects over read-only, so their functions
    // can never be replaced in place. A stand-in in front of the whole bridge
    // forwards every call untouched and only adds the administrator prompt
    // when a call comes back refused. Anything that goes wrong here must leave
    // the till running rather than blanking the screen.
    try {
      for (const name of BRIDGES) {
        const bridge = win[name];
        if (!bridge) continue;
        const proxy = wrapBridge(bridge, requestUnlock);
        undo.push(registerDesktopBridge(name, proxy));
        try {
          win[name] = proxy as unknown as Record<string, unknown>;
          undo.push(() => {
            win[name] = bridge;
          });
        } catch {
          /* this shell will not let us stand in front of the bridge */
        }
      }

      off = pos.onFatal?.((payload) => setFatal(payload?.message ?? "This till has stopped."));
    } catch {
      /* never block the till from loading */
    }

    return () => {
      for (const restore of undo) {
        try {
          restore();
        } catch {
          /* ignore */
        }
      }
      off?.();
    };
  }, [recovery, requestUnlock]);

  const submit = async () => {
    setBusy(true);
    setError("");
    const bridge = (
      window as unknown as {
        sqlAdmin?: {
          unlock?: (
            u: string,
            p: string,
          ) => Promise<{ ok: boolean; level?: "admin" | "supervisor" | "staff"; error?: string }>;
        };
      }
    ).sqlAdmin;
    const result = (await bridge?.unlock?.(username, pin)) ?? {
      ok: false,
      error: "This terminal cannot be unlocked from here.",
    };
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "That username or PIN was not accepted on this till.");
      return;
    }
    if (ask?.requiredLevel === "admin" && result.level !== "admin") {
      setError("This action requires an Administrator account.");
      return;
    }
    ask?.resolve(true);
  };

  if (recovery) return <>{children}</>;

  if (fatal) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-8">
        <div className="max-w-md space-y-3 rounded-lg border border-destructive/40 bg-card p-6 text-center">
          <h1 className="text-lg font-semibold text-destructive">This till has stopped</h1>
          <p className="text-sm text-muted-foreground">{fatal}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {children}
      <Dialog open={Boolean(ask)} onOpenChange={(open) => !open && ask?.resolve(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Unlock this terminal</DialogTitle>
            <DialogDescription>
              {ask?.message ||
                "This action needs an administrator. Enter your username and PIN to continue."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="unlock-username">Username</Label>
              <Input
                id="unlock-username"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="unlock-pin">PIN</Label>
              <Input
                id="unlock-pin"
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => ask?.resolve(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={busy || !username || !pin}>
                {busy ? "Checking…" : "Unlock"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default PrivilegeGate;
