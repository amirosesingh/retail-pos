import { useEffect, useRef, useState } from "react";
import { Lock, ReceiptText, Settings2, Wifi, WifiOff } from "lucide-react";
import { useBranding } from "@/lib/branding";
import { cloudVerdict, cloudDiagnosis, connectivity, subscribeConnectivity } from "@/core/activation/connection-health";
import { connectionLabel } from "../connection-label";
import { ApprovalTokenButton } from "@/platform-config/approval-token";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { RECOVERY_PATH } from "@/lib/recovery-route";

export const supportsOfflineLogin = true;
/** Local interface only. No auth provider, cached staff list or business database. */
export function OfflineLoginInterface({ recovery = false }: { recovery?: boolean } = {}) {
  const brand = useBranding();
  return <div className="flex min-h-screen items-center justify-center bg-background px-4 py-16 text-foreground">
    {recovery && <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-3 top-[calc(var(--safe-top,env(safe-area-inset-top,0px))+0.75rem)] z-[60] flex justify-center">
      <span className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-xs text-destructive shadow-md animate-in fade-in slide-in-from-top-4 motion-reduce:animate-none">
        <span className="size-2 rounded-full bg-current" aria-hidden /><WifiOff className="size-3.5" aria-hidden />Offline
      </span>
    </div>}
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
        {recovery && <Button variant="outline" className="w-full" onClick={() => window.location.assign(RECOVERY_PATH)}>Emergency access</Button>}
      </div>
    </section>
  </div>;
}

/** The shared heartbeat owns retries; this indicator only observes its verdict. */
export function NativeConnectionIndicator() {
  const [snapshot, setSnapshot] = useState(() => ({ state: connectivity(), verdict: cloudVerdict(), issue: cloudDiagnosis().issue }));
  const { state, verdict, issue } = snapshot;
  const wasOffline = useRef(false);
  const [recovered, setRecovered] = useState(false);
  useEffect(() => subscribeConnectivity(state => setSnapshot({ state, verdict: cloudVerdict(), issue: cloudDiagnosis().issue })), []);
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
  const setup = verdict === "unconfigured" || issue === "configuration";
  const Icon = online ? Wifi : setup ? Settings2 : WifiOff;
  return <div className={`pointer-events-none fixed z-[60] top-[calc(var(--safe-top,env(safe-area-inset-top,0px))+0.75rem)] inset-x-3 flex justify-center`}>
    <div key={online ? "online" : "offline"} role="status" aria-live="polite" className={`flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-xs shadow-md animate-in fade-in slide-in-from-top-4 duration-[var(--motion-normal)] ease-[var(--motion-ease-emphasized)] motion-reduce:animate-none ${online ? "text-emerald-600 dark:text-emerald-400" : setup ? "text-amber-700 dark:text-amber-400" : "text-destructive"}`}>
    <span className="size-2 rounded-full bg-current" aria-hidden /><Icon className="size-3.5" aria-hidden />{connectionLabel(state, verdict, issue)}
    </div>
  </div>;
}
