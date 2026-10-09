import { queryReadsChangedTables } from "@/lib/live-query-tables";
import { notifyError } from "@/lib/notify";
import { subscribeDataChange } from "@/lib/sync-engine";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useLocation,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportAppReady } from "@/lib/app-health";
import { PosProvider } from "@/lib/pos-store";
import { usePosOptional } from "@/lib/pos-store";
import { PosRulesProvider } from "@/lib/pos-rules.tsx";
import { ManagerGateProvider } from "@/lib/manager-gate";
import { AuthProvider } from "@/lib/pos-auth";
import { PermissionsProvider } from "@/lib/pos-permissions";
import { Toaster } from "../components/ui/sonner";
import { PrivilegeGate } from "../platforms/windows/components/PrivilegeGate";

import { ErrorNotifier } from "@/platforms/web/components/pos/ErrorNotifier";
import { AuditTracker } from "@/platforms/web/components/pos/AuditTracker";
import { TelemetryAgent } from "@/platforms/web/components/pos/TelemetryAgent";
import { ConnectDatabaseScreen } from "@/platforms/web/components/pos/ConnectDatabaseScreen";
import { isTerminalApp } from "@/platform-config/platform";
import { FirstRunSetup } from "@/platforms/web/components/pos/FirstRunSetup";
import { LifeBuoy } from "lucide-react";
import { RECOVERY_PATH } from "@/lib/recovery-route";
import { ThemeProvider, themeBootScript } from "../lib/theme";
import { publicConfigScript } from "../lib/public-config-script";
import { NativeBoot } from "@/platforms/mobile/components/NativeBoot";
import { OfflineGate } from "@/platforms/mobile/components/OfflineGate";
import {
  APP_RESUME_EVENT,
  CONNECTIVITY_RESTORED_EVENT,
  connectivity,
  startConnectivityMonitor,
} from "@/core/activation/connection-health";
import { subscribeSyncConfig, syncConfig } from "@/lib/sync-config";
import { DesktopUpdateBanner, DesktopCloseSyncStatus } from "@/platforms/windows/components/DesktopUpdateBanner";
import { AndroidUpdateBanner } from "@/platforms/mobile/components/AndroidUpdateBanner";
import { usePublicHostLanding } from "../lib/coupon-hosts";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { bypassPersistentAppShell, isCustomerPublicRoute } from "@/lib/app-shell-routes";
import { useNativeBackNavigation } from "@/platforms/mobile/use-native-back";
import { hydrateConnectionProfile } from "@/lib/connection-profile";
import { TillLoader } from "@/components/shared/TillLoader";
import { staleAssetRecoveryScript } from "@/lib/stale-asset-recovery";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  const normalizedError = useMemo(
    () => (error instanceof Error ? error : new Error(String(error))),
    [error],
  );
  if (import.meta.env.DEV) console.error(normalizedError);
  const router = useRouter();
  useEffect(() => {
    // Something on screen beats a blank window: the desktop shell must know the
    // build started, or its 60-second watchdog tears the till down.
    reportAppReady();
  }, [normalizedError]);

  const notConfigured = normalizedError.name === "SupabaseConfigError";

  // Missing device configuration is step one of terminal setup, never a cue
  // to attempt activation. Reset the boundary after a successful save/probe
  // so the shared startup decision can proceed to activation or sign-in.
  if (notConfigured && isTerminalApp()) {
    return (
      <ConnectDatabaseScreen
        cloudConfigured={false}
        onRetry={() => {
          router.invalidate();
          reset();
        }}
      />
    );
  }

  const clearAndRestart = async () => {
    try {
      window.localStorage.removeItem("pos.offline.snapshot.v1");
      window.localStorage.removeItem("pos-state-v2");
      window.sessionStorage.clear();
    } catch {
      /* nothing else we can do */
    }
    await window.pos?.clearAppCache?.().catch(() => undefined);
    window.location.reload();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {notConfigured ? "Database not configured" : "This page didn't load"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {notConfigured
            ? "This server has not been told where the database lives. Set SUPABASE_URL and SUPABASE_ANON_KEY in the hosting variables (Cloudflare: Workers → Settings → Variables & Secrets), then reload."
            : "Something went wrong on our end. You can try refreshing or head back home."}
        </p>
        {import.meta.env.DEV && (
          <p className="mt-2 break-words text-xs text-muted-foreground/80">
            {normalizedError.message}
          </p>
        )}
        {import.meta.env.DEV && normalizedError.stack && (
          <details className="mt-3 text-left">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Technical details
            </summary>
            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2 text-[10px] leading-snug text-muted-foreground">
              {normalizedError.stack}
            </pre>
          </details>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              reset();
              void router.invalidate();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <button
            onClick={clearAndRestart}
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Clear local cache and restart
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
          {/* Connection repair must stay reachable from the failure screen. */}
          {/* A full load, not in-app navigation: whatever broke the app would
              otherwise break the repair screen on the way in too. */}
          {isTerminalApp() && (
            <button
              onClick={() => window.location.assign(RECOVERY_PATH)}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              <LifeBuoy className="size-4" aria-hidden />
              Emergency access
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1.0, minimum-scale=0.5, maximum-scale=2.0, user-scalable=yes, viewport-fit=cover",
      },
      { title: "Retail — Register, Shifts & Inventory" },
      {
        name: "description",
        content:
          "Touch point of sale with shift open/close, inventory, central membership, cash drawer control and thermal receipt printing.",
      },
      { property: "og:title", content: "Retail" },
      {
        property: "og:description",
        content: "Point of sale with shifts, inventory, membership and receipt printing.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: staleAssetRecoveryScript }} />
        <HeadContent />
        {/* The server owns this payload. In browsers and device renderers the
            same call intentionally resolves to an empty string after the
            server-emitted script has already populated window.__POS_CONFIG__.
            Suppress only this expected text difference during hydration. */}
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: publicConfigScript() }}
        />
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  const pathname = useLocation({ select: (location) => location.pathname });
  usePublicHostLanding();
  useNativeBackNavigation(router);

  // One long-lived owner for connectivity on every platform. Platform-specific
  // configuration remains separate; this only owns the shared heartbeat
  // lifecycle so temporary screens can never stop it when they unmount.
  useEffect(() => {
    let appliedHeartbeat = syncConfig().heartbeatMs;
    let stop = startConnectivityMonitor(appliedHeartbeat);
    const offConfig = subscribeSyncConfig(() => {
      const nextHeartbeat = syncConfig().heartbeatMs;
      if (nextHeartbeat === appliedHeartbeat) return;
      appliedHeartbeat = nextHeartbeat;
      stop();
      stop = startConnectivityMonitor(appliedHeartbeat);
    });
    return () => {
      offConfig();
      stop();
    };
  }, []);

  // A confirmed reconnect or foreground resume wakes every data mechanism in
  // one place. The current URL stays intact while active queries and route
  // loaders refresh; queued mutations are allowed to continue automatically.
  useEffect(() => {
    let refreshing = false;
    const recover = () => {
      if (refreshing || connectivity() !== "online") return;
      refreshing = true;
      void Promise.allSettled([
        queryClient.resumePausedMutations(),
        queryClient.refetchQueries({ type: "active" }),
        router.invalidate(),
        import("@/lib/terminal-session").then(({ ensureTerminalSession }) =>
          ensureTerminalSession(),
        ),
      ]).finally(() => {
        refreshing = false;
      });
    };
    window.addEventListener(CONNECTIVITY_RESTORED_EVENT, recover);
    window.addEventListener(APP_RESUME_EVENT, recover);
    return () => {
      window.removeEventListener(CONNECTIVITY_RESTORED_EVENT, recover);
      window.removeEventListener(APP_RESUME_EVENT, recover);
    };
  }, [queryClient, router]);

  // Coalesce a committed sync page into one active-query refresh.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tables = new Set<string>();
    const off = subscribeDataChange((change) => {
      tables.add(change.table);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        const changed = new Set(tables); tables.clear();
        void queryClient.invalidateQueries({refetchType:"active", predicate: query => queryReadsChangedTables(query.meta, changed)}).catch(cause => notifyError(cause, "Refreshing live data"));
      }, 400);
    });
    return () => { off(); if (timer) clearTimeout(timer); };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <NativeBoot>
          <OfflineGate>
            <ConnectionProfileBoot>
              {isCustomerPublicRoute(pathname) ? (
                <>
                  <Outlet />
                  <Toaster position="top-right" closeButton />
                </>
              ) : (
                <TillRuntime />
              )}
            </ConnectionProfileBoot>
          </OfflineGate>
        </NativeBoot>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

/** Till-only runtime. Never mount this on customer-facing URLs. */
function TillRuntime() {
  return (
    // Single mount point for staff auth. Customer authentication has its own
    // isolated client and storage key in external-client.ts.
    <AuthProvider>
      <PermissionsProvider>
        <PosProvider>
          <RulesBridge>
            <AuditTracker />
            <TelemetryAgent />
            <FirstRunSetup>
              <PrivilegeGate>
                <PersistentRouteOutlet />
              </PrivilegeGate>
            </FirstRunSetup>

            <AndroidUpdateBanner />
            <DesktopUpdateBanner />
            <DesktopCloseSyncStatus />
            <Toaster position="top-right" closeButton />
            <ErrorNotifier />
          </RulesBridge>
        </PosProvider>
      </PermissionsProvider>
    </AuthProvider>
  );
}

/** Do not resolve a cloud client before Electron restores its DPAPI values. */
function ConnectionProfileBoot({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let current = true;
    void hydrateConnectionProfile().catch(cause => notifyError(cause, "Restoring database connection")).finally(() => {
      if (current) setReady(true);
    });
    return () => {
      current = false;
    };
  }, []);
  if (!ready) return <TillLoader message="Restoring secure connection…" />;
  return children;
}

/** The shell survives every protected in-app route change. */
function PersistentRouteOutlet() {
  const pathname = useLocation({ select: (location) => location.pathname });
  if (bypassPersistentAppShell(pathname)) return <Outlet />;
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

/**
 * Rules are per-branch, so the provider needs the active store from the till.
 * Read the store optionally: during a hot reload the POS context can briefly be
 * missing, and that must degrade to "no branch yet" rather than blank the app.
 */
function RulesBridge({ children }: { children: ReactNode }) {
  const pos = usePosOptional();
  const storeId = pos?.currentStore?.id ?? "";
  return (
    <PosRulesProvider storeId={storeId}>
      <ManagerGateProvider storeId={storeId}>{children}</ManagerGateProvider>
    </PosRulesProvider>
  );
}
