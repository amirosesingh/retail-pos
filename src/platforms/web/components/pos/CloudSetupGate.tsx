/**
 * One-time, never-blocking setup prompt shown on terminal apps (Windows till,
 * Android APK) when no central cloud keys are configured on this device yet.
 *
 * "Continue Offline" dismisses it and the device trades 100% locally —
 * cashier sign-in, scanning, checkout and printing are all unaffected.
 * "Open Settings" jumps straight to Database & Cloud Connection. The prompt
 * reappears on the next launch until keys are saved.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CloudOff, LifeBuoy, Settings } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { isTerminalApp } from "@/platform-config/platform";
import { subscribeConfigReady } from "@/lib/platform-config-ready";


export function CloudSetupGate() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isTerminalApp()) return;

    // Configuration readiness is a local fact: it does not depend on whether
    // the device happens to be online, and there is no web fallback to hide
    // behind. Missing configuration means setup, every launch, until saved.
    const offReady = subscribeConfigReady((state) => setOpen(state.state === "missing" || state.state === "incomplete"));
    // The desktop shell announces the missing keys as soon as the window shows.
    const offShell = window.pos?.onCloudSetupRequired?.(() => setOpen(true));
    return () => {
      offShell?.();
      offReady();
    };
  }, []);

  if (!isTerminalApp()) return null;

  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-md [&>button]:hidden"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CloudOff className="size-5 text-warning" />
            Terminal not configured
          </DialogTitle>
          <DialogDescription>
            This terminal has no central database configured yet. Nothing is assumed and nothing is
            inherited from another deployment: enter this shop&apos;s database address and API key
            in Settings, and the terminal continues to registration and sign-in once they are saved
            securely on this device.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:justify-between">

          <Button
            variant="outline"
            onClick={() => {
              setOpen(false);
              void navigate({ to: "/recovery" });
            }}
          >
            <LifeBuoy className="size-4" />
            Emergency access
          </Button>
          <Button
            onClick={() => {
              setOpen(false);
              void navigate({ to: "/settings/system" });
            }}
          >
            <Settings className="size-4" />
            Open Settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
