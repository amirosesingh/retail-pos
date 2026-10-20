import { useEffect, useRef, useState } from "react";
import { Lock, ReceiptText, Wifi, WifiOff } from "lucide-react";
import { useBranding } from "@/lib/branding";
import { connectivity, subscribeConnectivity } from "@/core/activation/connection-health";
import { ApprovalTokenButton } from "@/platform-config/approval-token";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

/** Local interface only. No auth provider, cached staff list or business database. */
export function OfflineLoginInterface() {
  const brand = useBranding();
  return <div className="flex min-h-screen items-center justify-center bg-background px-4 py-16 text-foreground">
    <section className="w-full max-w-sm space-y-5 rounded-lg border border-border bg-card p-6" aria-label="Terminal sign in">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground"><ReceiptText className="size-5" /></div>
        <div className="min-w-0"><p className="break-words font-semibold">{brand.company}</p><p className="text-xs text-muted-foreground">Terminal sign in</p></div>
        <Lock className="ml-auto size-4 shrink-0 text-muted-foreground" />
      </div>
      <div className="space-y-4">
        <div className="space-y-1"><Label htmlFor="offline-username">Username</Label><Input id="offline-username" disabled placeholder="Connect to sign in" /></div>
        <div className="space-y-1"><Label htmlFor="offline-password">PIN or password</Label><Input id="offline-password" type="password" disabled /></div>
        <Button className="w-full" disabled>Sign in</Button>
        <p className="text-xs text-muted-foreground">Sign-in will be available when the connection returns.</p>
        <ApprovalTokenButton />
      </div>
    </section>
  </div>;
}

/** The shared heartbeat owns retries; this indicator only observes its verdict. */
export function NativeConnectionIndicator() {
  const [state, setState] = useState(connectivity);
  const wasOffline = useRef(false);
  const [recovered, setRecovered] = useState(false);
  useEffect(() => subscribeConnectivity(setState), []);
  useEffect(() => {
    if (state === "online") {
      if (!wasOffline.current) return;
      wasOffline.current = false;
      setRecovered(true);
      const timer = setTimeout(() => setRecovered(false), 2500);
      return () => clearTimeout(timer);
    }
    if (state !== "connecting") { wasOffline.current = true; setRecovered(false); }
  }, [state]);
  if (state === "online" && !recovered || state === "connecting" && !wasOffline.current) return null;
  const online = state === "online";
  const Icon = online ? Wifi : WifiOff;
  return <div className={`pointer-events-none fixed z-[60] top-[calc(var(--safe-top,env(safe-area-inset-top,0px))+0.75rem)] inset-x-3 flex justify-center`}>
    <div key={online ? "online" : "offline"} role="status" aria-live="polite" className={`flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-xs shadow-md animate-in fade-in slide-in-from-top-4 duration-[var(--motion-normal)] ease-[var(--motion-ease-emphasized)] motion-reduce:animate-none ${online ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
    <span className="size-2 rounded-full bg-current" aria-hidden /><Icon className="size-3.5" aria-hidden />{online ? "Online" : "Offline"}
    </div>
  </div>;
}
