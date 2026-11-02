import { ApprovalTokenButton } from "@/platform-config/approval-token";
import { OfflineLoginInterface } from "@/platform-config/offline-interface";
import { isNative } from "@/platform-config/platform";
/**
 * Connection gate for the browser and Android builds.
 *
 * Neither holds business data, so every screen needs the backend. Nothing is
 * ever declared offline on a guess: while the first heartbeat is still in
 * flight the app shows only the pulsing cloud icon — no logo, no toast, no
 * error. A slow check offers recovery without unlocking protected data. The Windows
 * till never renders the gate: `isOnlineOnly()` is false there.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import { useRouterState } from "@tanstack/react-router";

import { EmergencyAccessLink } from "@/components/shared/EmergencyAccessLink";
import { Button } from "@/components/ui/button";
import { useStartupGate } from "@/core/activation/registration-status";
import { subscribeConfigReady, type ConfigReadiness } from "@/lib/platform-config-ready";
import { needsSetupRecovery } from "@/lib/startup-recovery";
import { OfflineGatePortalContext, OfflineGateSnapshotContext } from "@/lib/offline-gate-snapshot-context";
import { hasOnlyFiniteEntrance, pauseOfflineInteraction, retainOfflineSnapshot } from "@/lib/offline-gate-visibility";
import "@/lib/offline-gate-portals.css";

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

const useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function OfflineGate({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [connection, setConnection] = useState(() => ({ state: connectivity(), issue: cloudDiagnosis().issue }));
  const { state } = connection;
  const bypass = !isOnlineOnly() || isRecoveryPath(pathname) || onRecoveryScreen();
  const available = bypass || state === "online";
  const [mounted, setMounted] = useState(available);
  const [portalSlot, setPortalSlot] = useState<HTMLDivElement | null>(null);
  const [portalContainer] = useState(() => {
    if (typeof document === "undefined") return null;
    const host = document.createElement("div");
    host.dataset.offlineGatePortals = "";
    host.style.display = "contents";
    return host;
  });
  const parkedPortals = useRef<DocumentFragment | null>(null);
  const recoveryRef = useRef<HTMLDivElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  const wasPaused = useRef(false);
  const portalDepths = useRef(new Map<symbol, number>());
  const registerDepth = useCallback((depth: number) => {
    const id = Symbol();
    portalDepths.current.set(id, depth);
    return () => { portalDepths.current.delete(id); };
  }, []);
  type PortalPhase = { stage: "live" | "hide" | "hidden" | "restore" | "settle"; depth: number; revision: number };
  const [portalPhase, setPortalPhase] = useState<PortalPhase>({ stage: available ? "live" : "hidden", depth: available ? Infinity : -1, revision: 0 });
  const phaseRef = useRef(portalPhase);
  phaseRef.current = portalPhase;
  const availableRef = useRef(available);
  availableRef.current = available;
  const isPortalPaused = useCallback(() => !availableRef.current || phaseRef.current.stage !== "live", []);
  const visibleDepth = portalPhase.depth;
  const portalReady = available && portalPhase.stage === "live";
  useClientLayoutEffect(() => {
    if (!available && portalPhase.stage !== "hide" && portalPhase.stage !== "hidden") {
      const depth = Math.max(0, ...portalDepths.current.values());
      setPortalPhase(previous => ({ stage: "hide", depth: depth - 1, revision: previous.revision + 1 }));
    }
  }, [available, portalPhase.stage]);
  useClientLayoutEffect(() => {
    if (!portalContainer || !portalSlot) return;
    portalContainer.inert = !portalReady;
    portalContainer.style.visibility = portalReady ? "" : "hidden";
    if (available) portalSlot.appendChild(portalContainer);
    else {
      // Preserve settled geometry before Activity/display changes can replay a
      // finite entrance. Infinite indicators and ordinary new opens are intact.
      for (const surface of portalContainer.querySelectorAll<HTMLElement>('[data-offline-gate-surface][data-state="open"]')) {
        // Activity may already have removed WebAnimation effects in this commit;
        // computed CSS still records the entrance and its iteration counts.
        const motion = getComputedStyle(surface);
        if (hasOnlyFiniteEntrance(motion.animationName, motion.animationIterationCount)) {
          surface.dataset.offlineGateRestored = "";
        }
      }
      parkedPortals.current ??= document.createDocumentFragment();
      // Only this imperative host moves. React owns its portaled children, not
      // its placement. Detach before passive Vaul Root cleanup so its own iOS
      // scroll restoration sees no active drawer left in the document.
      parkedPortals.current.appendChild(portalContainer);
    }
  }, [available, portalReady, portalContainer, portalSlot]);
  // Placement changes never discard this host. Only Gate unmount removes it.
  useClientLayoutEffect(() => () => { portalContainer?.remove(); }, [portalContainer]);
  useClientLayoutEffect(() => {
    if (!portalContainer) return;
    const observer = new MutationObserver(records => {
      for (const record of records) {
        const surface = record.target as HTMLElement;
        if (surface.dataset.state !== "open") delete surface.dataset.offlineGateRestored;
      }
    });
    observer.observe(portalContainer, { subtree: true, attributes: true, attributeFilter: ["data-state"] });
    return () => observer.disconnect();
  }, [portalContainer]);
  const [snapshotScope, setSnapshotScope] = useState<string | null>(null);
  const reportOwner = useRef<symbol | null>(null);
  const onlineScope = useRef<string | null>(null);
  const reportSnapshot = useCallback((scope: string | null) => {
    const owner = Symbol();
    reportOwner.current = owner;
    setSnapshotScope(scope);
    return () => {
      if (reportOwner.current !== owner) return;
      reportOwner.current = null;
      setSnapshotScope(null);
    };
  }, []);
  // A diagnosis may change while connectivity remains offline. Do not retain
  // the page after a later configuration or authorization refusal.
  useEffect(() => subscribeConnectivity(next => {
    const issue = cloudDiagnosis().issue;
    setConnection(previous => previous.state === next && previous.issue === issue
      ? previous : { state: next, issue });
  }), []);
  useEffect(() => { if (available) setMounted(true); }, [available]);
  if (state === "online") onlineScope.current = snapshotScope;
  const retained = !bypass && retainOfflineSnapshot({
    web: !isNative(), state, issue: connection.issue,
    currentScope: snapshotScope, onlineScope: onlineScope.current,
  });
  // Capture remains a fallback for in-flight events; popup DOM itself now lives
  // below inert and its modal effects pause without discarding draft inputs.
  const pauseInteraction = !isNative() && !available ? pauseOfflineInteraction : undefined;
  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof setTimeout> | undefined;
    const next = (stage: PortalPhase["stage"], depth: number) => {
      if (!cancelled) setPortalPhase(previous => ({ stage, depth, revision: previous.revision + 1 }));
    };
    if (portalPhase.stage === "hide") {
      // Activity's passive cleanup schedules FocusScope's public close event in
      // a task. Queue our task after the whole passive cleanup pass, so every
      // old scope is removed before its preserved component can be restored.
      // This is a task-order barrier, not a timeout guessed from animation length.
      queueMicrotask(() => {
        if (cancelled) return;
        task = setTimeout(() => next(portalPhase.depth < 0 ? "hidden" : "hide", Math.max(-1, portalPhase.depth - 1)), 0);
      });
    } else if (portalPhase.stage === "hidden" && available) {
      next("restore", 0);
    } else if (portalPhase.stage === "restore") {
      // First passive pass installs the primitive's node and layer effects.
      // A new context commit then refreshes its render-time highest-layer bit.
      next("settle", portalPhase.depth);
    } else if (portalPhase.stage === "settle") {
      // Only after that committed listener update may a child layer restore.
      queueMicrotask(() => {
        const deepest = Math.max(0, ...portalDepths.current.values());
        if (availableRef.current) next(portalPhase.depth >= deepest ? "live" : "restore", portalPhase.depth >= deepest ? Infinity : portalPhase.depth + 1);
      });
    }
    return () => { cancelled = true; if (task !== undefined) clearTimeout(task); };
  }, [portalPhase, available]);
  useEffect(() => {
    if (!available) {
      wasPaused.current = true;
      if (visibleDepth !== -1) return;
    } else {
      if (!wasPaused.current || !portalReady) return;
      wasPaused.current = false;
    }
    const frame = requestAnimationFrame(() => {
      if (!available) {
        const recovery = recoveryRef.current;
        const target = recovery?.querySelector<HTMLButtonElement>("button:not([disabled])");
        (target ?? recovery)?.focus({ preventScroll: true });
      } else if (lastFocused.current?.isConnected) {
        lastFocused.current.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [available, visibleDepth, portalReady]);
  // Keep providers and unsaved forms mounted across temporary network loss.
  // Only an already loaded, same-scope browser snapshot stays visible. It is
  // still inert; initial loading and access/configuration failures stay gated.
  return <OfflineGateSnapshotContext.Provider value={reportSnapshot}>
    <OfflineGatePortalContext.Provider value={{ container: portalContainer, visibleDepth, registerDepth, revision: portalPhase.revision, isPaused: isPortalPaused }}>
    <div hidden={!available && !retained} inert={!available} style={{ display: available || retained ? "contents" : "none" }}
      onFocusCapture={event => { if (available && !wasPaused.current && event.target instanceof HTMLElement) lastFocused.current = event.target; }}
      onClickCapture={pauseInteraction} onDoubleClickCapture={pauseInteraction} onPointerDownCapture={pauseInteraction}
      onPointerUpCapture={pauseInteraction} onPointerCancelCapture={pauseInteraction}
      onMouseDownCapture={pauseInteraction} onMouseUpCapture={pauseInteraction}
      onTouchStartCapture={pauseInteraction} onTouchEndCapture={pauseInteraction}
      onKeyDownCapture={pauseInteraction} onKeyUpCapture={pauseInteraction} onSubmitCapture={pauseInteraction}
      onChangeCapture={pauseInteraction} onInputCapture={pauseInteraction}>
      {(mounted || available) && children}
      <div ref={setPortalSlot} data-offline-gate-portal-slot style={{ display: "contents" }} />
    </div>
    </OfflineGatePortalContext.Provider>
    {!available && <div ref={recoveryRef} tabIndex={-1} data-offline-gate-recovery>
      {retained ? <RetainedConnectionStatus /> : <OfflineStatus />}
    </div>}
  </OfflineGateSnapshotContext.Provider>;
}

function RetainedConnectionStatus() {
  const [checking, setChecking] = useState(false);
  const retry = () => {
    setChecking(true);
    void heartbeat().finally(() => setChecking(false));
  };
  return <div role="status" aria-live="polite" className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-xl items-center gap-3 rounded-lg border border-warning/40 bg-background p-3 text-sm shadow-lg">
    <CloudOff className="size-4 shrink-0 text-warning" aria-hidden />
    <p className="min-w-0 flex-1 text-xs leading-relaxed">Connection interrupted. Showing the last loaded data. Actions are paused while reconnecting.</p>
    <Button size="sm" variant="outline" className="shrink-0" onClick={retry} disabled={checking}>
      <RefreshCw className={`mr-1.5 size-3.5 ${checking ? "animate-spin" : ""}`} aria-hidden />
      {checking ? "Checking…" : "Try again"}
    </Button>
  </div>;
}

export function OfflineStatus({ force = false }: { force?: boolean } = {}) {
  const startup = useStartupGate();
  const [profile, setProfile] = useState<ConfigReadiness | null>(null);
  useEffect(() => subscribeConfigReady(setProfile), []);
  const live = isOnlineOnly();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Emergency access repairs the connection this gate is waiting for, so it
  // must never be gated — on any platform, including a cold deep link.
  const recovery = isRecoveryPath(pathname) || onRecoveryScreen();
  const [state, setState] = useState<Connectivity>(connectivity());
  const [checking, setChecking] = useState(false);
  const [connectingDelayed, setConnectingDelayed] = useState(false);
  useEffect(() => {
    setConnectingDelayed(false);
    if (state !== "connecting") return;
    const timer = setTimeout(() => setConnectingDelayed(true), 15_000);
    return () => clearTimeout(timer);
  }, [state]);
  const retry = () => {
    setChecking(true);
    void heartbeat().finally(() => setChecking(false));
  };

  useEffect(() => {
    if (recovery) return;
    setState(connectivity());
    const off = subscribeConnectivity(setState);
    return () => {
      off();
    };
  }, [recovery]);

  if ((!live && !force) || recovery) return null;

  // Never guess that the service is ready; offer recovery if checking stalls.
  if (state === "connecting" && isNative() && typeof navigator !== "undefined" && navigator.onLine === false)
    return <OfflineLoginInterface />;
  if (state === "connecting")
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center"
        role="status"
        aria-label="Connecting"
      >
        <span className="relative flex size-12 items-center justify-center">
          <span className="absolute inline-flex size-12 animate-ping rounded-full bg-primary/20" />
          <CloudIconPulse />
        </span>
        {connectingDelayed && <>
          <p className="max-w-sm text-sm text-muted-foreground">Checking the central database is taking longer than usual. Your saved connection has not been changed.</p>
          <Button variant="outline" onClick={retry} disabled={checking}>
            <RefreshCw className="mr-2 size-4" /> {checking ? "Checking…" : "Try again"}
          </Button>
        </>}
      </div>
    );

  if (state === "online" && !force) return null;

  const browserOffline = typeof navigator !== "undefined" && navigator.onLine === false;
  const verdict = cloudVerdict();
  const diagnosis = cloudDiagnosis();
  const needsRepair = needsSetupRecovery(profile, startup.registration,
    !browserOffline && (verdict === "unconfigured" || diagnosis.issue === "configuration"));
  // Show the packaged sign-in interface during a network outage, while keeping
  // the online-only runtime hidden and inert. Configuration/auth failures retain
  // their existing recovery UI; an outage never grants offline sign-in.
  if (isNative() && !needsRepair && (browserOffline || verdict === "unreachable"))
    return <OfflineLoginInterface />;
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
        <ApprovalTokenButton />
        {needsRepair && <EmergencyAccessLink />}
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
