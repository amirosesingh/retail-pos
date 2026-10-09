/**
 * Connection gate for the browser and Android builds.
 *
 * Neither holds business data, so every screen needs the backend. Nothing is
 * ever declared offline on a guess: while the first heartbeat is still in
 * flight the app shows only the pulsing cloud icon — no logo, no toast, no
 * error — and it keeps showing it for as long as the check takes. The Windows
 * till never renders the gate: `isOnlineOnly()` is false there.
 */
import { useEffect, useState, type ReactNode } from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import { useRouterState } from "@tanstack/react-router";

import { EmergencyAccessLink } from "@/components/shared/EmergencyAccessLink";

import { isOnlineOnly } from "@/lib/live-mode";
import { isRecoveryPath, onRecoveryScreen } from "@/lib/recovery-route";
import {
  cloudDiagnosis,
  cloudVerdict,
  connectivity,
  heartbeat,
  subscribeConnectivity,
  type Connectivity,
} from "@/core/activation/connection-health";

export function OfflineGate({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [state, setState] = useState<Connectivity>(connectivity());
  const bypass = !isOnlineOnly() || isRecoveryPath(pathname) || onRecoveryScreen();
  const available = bypass || state === "online";
  const [mounted, setMounted] = useState(available);
  useEffect(() => subscribeConnectivity(setState), []);
  useEffect(() => { if (available) setMounted(true); }, [available]);
  // Keep providers and unsaved forms mounted across temporary network loss.
  // Hidden content is unavailable for interaction until connectivity returns.
  return <>
    <div hidden={!available} inert={!available} style={{ display: available ? "contents" : "none" }}>{(mounted || available) && children}</div>
    {!available && <OfflineStatus />}
  </>;
}

function OfflineStatus() {
  const live = isOnlineOnly();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Emergency access repairs the connection this gate is waiting for, so it
  // must never be gated — on any platform, including a cold deep link.
  const recovery = isRecoveryPath(pathname) || onRecoveryScreen();
  const [state, setState] = useState<Connectivity>(connectivity());
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (recovery) return;
    setState(connectivity());
    const off = subscribeConnectivity(setState);
    return () => {
      off();
    };
  }, [recovery]);

  if (!live || recovery) return null;

  // Still checking: the cloud icon alone, nothing else on screen.
  if (state === "connecting")
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-background"
        role="status"
        aria-label="Connecting"
      >
        <span className="relative flex size-12 items-center justify-center">
          <span className="absolute inline-flex size-12 animate-ping rounded-full bg-primary/20" />
          <CloudIconPulse />
        </span>
      </div>
    );

  if (state === "online") return null;

  const browserOffline = typeof navigator !== "undefined" && navigator.onLine === false;
  const verdict = cloudVerdict();
  const diagnosis = cloudDiagnosis();
  const title = browserOffline
    ? "No internet connection"
    : verdict === "unconfigured" || diagnosis.issue === "configuration"
      ? "Connection settings need attention"
      : diagnosis.issue === "authentication"
        ? "Sign-in expired"
        : diagnosis.issue === "permission"
          ? "Access not permitted"
          : diagnosis.issue === "timeout"
            ? "The central service is taking too long to respond"
            : diagnosis.issue === "rate-limited"
              ? "The central service is busy"
              : diagnosis.issue === "service-error"
                ? "Central service unavailable"
                : "Cannot reach the central service";
  const message = browserOffline
    ? "No internet connection. Please check your connection and try again. This screen will recover automatically when your connection returns."
    : verdict === "unconfigured" || diagnosis.issue === "configuration"
      ? "This device could not authenticate with the central system. Review its Database & Cloud Connection settings."
      : diagnosis.issue === "authentication"
        ? "Your session is no longer valid. The app is returning you to sign in safely."
        : diagnosis.issue === "permission"
          ? "The central service is available, but this account is not allowed to access the required data. Ask an administrator to review its access policy."
          : diagnosis.issue === "timeout"
            ? "The request timed out. The app will keep checking and recover automatically when the service responds."
            : diagnosis.issue === "rate-limited"
              ? "Too many requests were received. The app will retry automatically in the background."
              : diagnosis.issue === "service-error"
                ? `The central service returned an error${diagnosis.status ? ` (${diagnosis.status})` : ""}. The app will recover automatically when it is available.`
                : "The device has internet access, but it could not establish a connection to the central service. This can be caused by DNS, TLS, a proxy, or browser policy. The app will keep retrying automatically.";

  const retry = () => {
    setChecking(true);
    void heartbeat().finally(() => setChecking(false));
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-8 text-center">
      <CloudOff className="size-10 text-destructive" aria-hidden />
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      <p className="max-w-xs text-sm text-muted-foreground">{message}</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          onClick={retry}
          disabled={checking}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} aria-hidden />
          {checking ? "Checking…" : "Try again"}
        </button>
        {/* The way back in when the address itself is what is wrong. Router
            navigation, never a page load: a hard load would restart the shell
            and put this gate straight back in front of the repair screen. */}
        <EmergencyAccessLink />
      </div>
    </div>
  );
}

function CloudIconPulse() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="relative size-8 animate-pulse text-primary"
      aria-hidden
    >
      <path d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.6 1.6A3.7 3.7 0 0 0 6.5 19Z" />
    </svg>
  );
}
