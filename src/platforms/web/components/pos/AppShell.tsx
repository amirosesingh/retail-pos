import { useLocalStartupReady } from "@/lib/use-local-startup";
import { useNotificationDeliveryPump } from "@/lib/use-notification-delivery-pump";
import { signInDestination } from "@/lib/sign-in-destination";
import { isManagementDevice } from "@/lib/management-device";
import { useIsMobile } from "@/hooks/use-mobile";
import { ApprovalTokenButton } from "@/platform-config/approval-token";
import { isLocationSetupRoute } from "@/lib/app-shell-routes";
import { usePersonalAppearance, usePersonalAppearanceSync } from "@/lib/personal-appearance";
import { setPersonalLanguage } from "@/lib/time-zone";
import { useDisplayProfile } from "@/lib/display-profile";
import { setSharedPrinterPrefs } from "@/lib/receipt-printer";
import { LogOut, Menu, MapPin, ReceiptText, Store } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePos } from "@/lib/pos-store";
import { useAuth, type PermissionFlag } from "@/lib/pos-auth";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { TerminalLogin } from "@/platforms/web/components/pos/TerminalLogin";
import {
  TerminalActivation,
  TerminalRevokedScreen,
} from "@/platforms/web/components/pos/TerminalActivation";
import { clearRevocation, useRevocationCheck } from "@/lib/use-revocation-check";
import { useStartupGate, startupDecision } from "@/core/activation/registration-status";
import { hasFeature } from "@/platform-config/features";
import { ConnectDatabaseScreen } from "@/platforms/web/components/pos/ConnectDatabaseScreen";
import { sessionIdleSeconds, useAutoLock } from "@/lib/auto-lock";
import { SidebarNav, useSidebarCollapsed } from "@/platforms/web/components/pos/SidebarNav";
import {
  ConnectionStatusButton,
  SystemAlertsButton,
} from "@/platforms/web/components/pos/StatusCluster";

import { ActivityBell } from "@/platforms/web/components/pos/ActivityBell";
import { MobileStatusSheet } from "@/platforms/web/components/pos/MobileStatusSheet";
import { ShiftGuard } from "@/platforms/web/components/pos/ShiftGuard";
import { PermissionDenied } from "@/platforms/web/components/pos/PermissionGate";
import { useVisibility } from "@/lib/ui-visibility";

import { LiveClock } from "@/platforms/web/components/pos/LiveClock";
import { ThemeToggle } from "@/platforms/web/components/pos/ThemeToggle";
import { hydrateBillSequence } from "@/lib/bill-number";
import { DbConnectionModal } from "@/platforms/windows/components/DbConnectionModal";
import { canSeeNavigationItem, routePermissionForPath, type NavItem } from "@/platforms/web/components/pos/nav-config";
import { setPrintStore, setPrintSettings, setServiceTerms } from "@/lib/pos-print";
import { bookingRulesOf } from "@/core/types/pos-types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useUiScale } from "@/lib/use-ui-scale";
import { useBranding, isDesktop } from "@/lib/branding";
import { isNative } from "@/platform-config/platform";
import { setBranchId } from "@/lib/activity-journal";
import { soleBranchId } from "@/lib/active-branch";
import { flushWhatsAppQueue } from "@/lib/whatsapp";
import { closeCustomerDisplay } from "@/lib/customer-display";
import { reportAppReady } from "@/lib/app-health";
import { hydrateConnectionProfile, isConnectionProfileHydrated } from "@/lib/connection-profile";
import { CloudSetupGate } from "@/platforms/web/components/pos/CloudSetupGate";
import { OfflineStatus } from "@/platforms/mobile/components/OfflineGate";
import { TillLoader } from "@/components/shared/TillLoader";
import { LocationBootGuard } from "@/platforms/web/components/pos/LocationBootGuard";
import { activeLocations } from "@/lib/locations";
import { flushTicketDrafts } from "@/lib/session-draft";
import { localDb } from "@/core/local-db/local-db";
import { startSyncEngine } from "@/lib/sync-engine";

/** The only screens any signed-in account may open. Everything else must have
 *  an entry above — unknown paths are denied, never silently allowed. */
const PUBLIC_ROUTES = new Set(["/", "/display"]);

/** Section landing pages. They only list links, and every card is filtered by
 *  the same permission as the sidebar entry, so the hub itself carries no
 *  protected data. */
const SECTION_HUBS = new Set(["/sales", "/inventory-hub", "/customers", "/admin"]);

/** Longest matching prefix wins so a child page can tighten its parent gate. */
function requiredPermission(pathname: string): PermissionFlag | null | "unknown" {
  if (PUBLIC_ROUTES.has(pathname)) return null;
  if (SECTION_HUBS.has(pathname)) return null;
  // Approvals is scoped by the authenticated backend per request/action.
  // Its page visibility flag still applies; absence of an action flag is intentional.
  if (pathname.replace(/\/+$/, "") === "/approvals") return null;
  return routePermissionForPath(pathname) ?? "unknown";
}

const AppShellContext = createContext(false);

/**
 * Route components still wrap their content in AppShell for backwards
 * compatibility. Inside the root-owned shell those wrappers become a no-op,
 * which lets us move the ownership without rewriting every route at once.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const nested = useContext(AppShellContext);
  if (nested) return <>{children}</>;
  return <AppShellFrame>{children}</AppShellFrame>;
}

function AppShellFrame({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  useEffect(() => startSyncEngine(), []);
  useEffect(() => localDb()?.onBeforeClose?.(() => flushTicketDrafts().then(() => undefined)), []);
  const { stores, currentStore, setCurrentStore, state, ready: dataReady, retryLoad } = usePos();
  useEffect(() => {
    setSharedPrinterPrefs(state.settings.integrations.receiptPrinter);
    return () => setSharedPrinterPrefs(undefined);
  }, [state.settings.integrations.receiptPrinter]);
  const {
    ready,
    user,
    isAdmin,
    canSwitchStores,
    terminalStoreId,
    authUserId,
    terminalUser,
    logout,
    lock,
    can,
  } = useAuth();
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  useNotificationDeliveryPump(Boolean(user) && dataReady);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // The drawer is portalled outside the hidden mobile header. Close it when
  // desktop navigation takes over, and do not reopen it on the next resize.
  useEffect(() => {
    if (!isMobile) setDrawerOpen(false);
  }, [isMobile]);
  // Set when the operator chooses to carry on from the terminal's own copy
  // after the first load could not reach the central database.
  const [offlineBypass, setOfflineBypass] = useState(false);
  const [activationFlowOpen, setActivationFlowOpen] = useState(false);
  const beginActivationReview = useCallback(() => setActivationFlowOpen(true), []);
  // The saved connection profile is read out of platform storage, which takes
  // a moment. Until it is back, this device's configuration is unknown — not
  // absent — so no start-up decision may be taken on it.
  const [profileHydrated, setProfileHydrated] = useState(() => isConnectionProfileHydrated());
  const branding = useBranding();

  // Windows tills must be registered to a location before they can be used.
  const terminal = useRevocationCheck();
  // Registration and connectivity are read separately: a dead link must never
  // look like a failed activation.
  const startup = useStartupGate();
  const localStartupReady = useLocalStartupReady() && startup.registration === "registered";
  const location = useLocation();
  const { visibleRoute } = useVisibility();

  const navigate = useNavigate();
  const sawSignedOut = useRef(false);
  const handledIdentity = useRef<string | null>(null);
  // Apply the default once per sign-in, not on navigation or permission refresh.
  // A restored session keeps its current page and any in-progress selling flow.
  useEffect(() => {
    if (!ready) return;
    if (!user) {
      sawSignedOut.current = true;
      handledIdentity.current = null;
      return;
    }
    const identity = terminalUser?.userCode
      ? `terminal:${terminalUser.userCode}`
      : authUserId ? `auth:${authUserId}` : `user:${user.email || user.staffId || user.name}`;
    if (handledIdentity.current === identity) return;
    handledIdentity.current = identity;
    let previous = "";
    try {
      previous = window.sessionStorage.getItem("pos.last-signed-in-identity") ?? "";
      window.sessionStorage.setItem("pos.last-signed-in-identity", identity);
    } catch { /* In-memory tracking still prevents repeated redirects. */ }
    const freshSignIn = sawSignedOut.current || (previous !== identity);
    sawSignedOut.current = false;
    if (freshSignIn) {
      const to = signInDestination(isAdmin, can("can_view_dashboard"), visibleRoute("/dashboard"));
      void navigate({ to, search: {}, replace: true });
    }
  }, [ready, user, authUserId, terminalUser?.userCode, isAdmin, can, visibleRoute, navigate]);

  const appearance = usePersonalAppearance();
  usePersonalAppearanceSync(appearance.key, appearance.owner);
  useDisplayProfile(appearance.profile);
  useEffect(() => {
    document.documentElement.lang = appearance.profile.language;
    setPersonalLanguage(appearance.profile.language);
    return () => {
      setPersonalLanguage("en");
      document.documentElement.lang = "en";
    };
  }, [appearance.profile.language]);
  // Terminal-wide font / control scaling preference.
  useUiScale();

  // The server stamps the effective branch/personal limit on sign-in. The
  // visible lock and the revocable server session therefore expire together.
  useAutoLock(
    !!user,
    () => {
      void lock();
    },
    sessionIdleSeconds(),
  );

  // The bill counter lives in the branch database; restore it before the first
  // sale so a cleared browser profile cannot restart numbering.
  useEffect(() => {
    void hydrateBillSequence();
  }, []);
  // Restore the OS-sealed cloud profile before the online client is used.
  useEffect(() => {
    void hydrateConnectionProfile();
  }, []);

  // Tells the desktop shell this build actually started, so it never falls
  // back into safe mode after a healthy launch.
  useEffect(() => reportAppReady(), []);

  // Bills queued while offline go out as soon as the link is back.
  useEffect(() => {
    const flush = () => void flushWhatsAppQueue().catch(() => {});
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, []);

  // The customer screen must never outlive the till: when this window goes
  // away, shut the second screen down with it.
  useEffect(() => {
    if (window.location.pathname.startsWith("/display")) return;
    const shutdown = () => closeCustomerDisplay();
    window.addEventListener("pagehide", shutdown);
    window.addEventListener("beforeunload", shutdown);
    return () => {
      window.removeEventListener("pagehide", shutdown);
      window.removeEventListener("beforeunload", shutdown);
    };
  }, []);

  useEffect(() => {
    setPrintStore(currentStore ?? null);
  }, [currentStore]);

  // Stamp every journal entry and queued write with the branch in use.
  useEffect(() => {
    setBranchId(currentStore?.id ?? null);
  }, [currentStore]);

  useEffect(() => {
    setPrintSettings(
      state.settings.receipt,
      state.settings.tax,
      state.settings.integrations.rounding,
    );
  }, [state.settings]);

  // The liability wording lives with the booking rules but is printed by the
  // receipt layer, so push it across whenever the rules change.
  useEffect(() => {
    setServiceTerms(bookingRulesOf(state.settings.integrations.bookingRules).serviceTerms);
  }, [state.settings]);

  // A registered till fixes the branch for everyone signed in on it; otherwise
  // an account with a single assigned branch is pinned to that one.
  // Unbound management phones follow the signed-in account branch assignment.
  useEffect(() => {
    const pinned = terminalStoreId ?? (canSwitchStores ? null : (user?.storeId ?? soleBranchId()));
    if (user && pinned && currentStore.id !== pinned) setCurrentStore(pinned);
  }, [user, isAdmin, canSwitchStores, terminalStoreId, currentStore.id, setCurrentStore]);

  // Restore the saved profile once per launch, then release the gate below.
  useEffect(() => {
    if (profileHydrated) return;
    let cancelled = false;
    void hydrateConnectionProfile().finally(() => {
      if (!cancelled) setProfileHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [profileHydrated]);

  // Every activated terminal, including a browser-based till, must finish
  // unsealing its tenant configuration before any data read or write starts.
  // The connection profile is part of that: showing setup while it is still
  // being read out of the vault is what used to send a working till back to
  // the connection screen after a restart.
  // Online-only devices wait for cloud checks. An activated Windows till with
  // validated local SQL may start immediately while revocation checks continue.
  // A confirmed revocation still blocks the terminal below.
  const awaitingVerdict =
    (isDesktop() || isNative()) && Boolean(terminal.config) && !terminal.verified && !localStartupReady;
  // Persist the activation summary until Continue. Saving the verified config
  // causes background startup checks, which previously unmounted it immediately.
  if ((isDesktop() || isNative()) && activationFlowOpen && !terminal.revoked)
    return (
      <TerminalActivation
        onActivationStarted={beginActivationReview}
        onActivated={() => {
          setActivationFlowOpen(false);
          clearRevocation();
          startup.refresh();
        }}
      />
    );
  if (!ready) return <TillLoader message="Restoring your workspace…" />;
  if (
    terminal.hydrating ||
    ((isDesktop() || isNative()) && startup.loading) ||
    !profileHydrated ||
    awaitingVerdict ||
    ((isDesktop() || isNative()) && startup.probing && !localStartupReady)
  )
    return <TillLoader message="Checking terminal connection…" onRetry={startup.refresh} />;

  // Desktop tills and Android terminals both have to register before use.
  if (isDesktop() || isNative()) {
    if (terminal.revoked) return <TerminalRevokedScreen reason={terminal.reason} />;
    // A stored activation is not a licence to sign in: the connection has to
    // be proven every launch, unless this platform may trade offline.
    const decision = startupDecision({
      registration: startup.registration,
      verdict: startup.verdict,
      activated: Boolean(terminal.config),
      offlineCapable: hasFeature("offlineFirst") && !isManagementDevice(),
    });
    // Step 1 — no usable database connection: ask for the URL and key.
    if (decision === "offline-blocked") return <OfflineStatus force />;
    if (decision === "connect-database" && startup.cloudConfigured !== false)
      return <OfflineStatus force />;
    if (decision === "connect-database")
      return (
        <ConnectDatabaseScreen
          cloudConfigured={startup.verdict !== "unconfigured"}
          onRetry={startup.refresh}
        />
      );
    // Step 2 — connection is proven, the terminal itself is not registered.
    if (decision === "activate")
      return (
        <TerminalActivation
          onActivationStarted={beginActivationReview}
          onActivated={() => {
            clearRevocation();
            startup.refresh();
          }}
        />
      );
  }
  if (!user)
    return (
      <>
        <CloudSetupGate />
        {startup.offlineAvailable && (
          <div className="bg-warning/15 px-3 py-1.5 text-center text-xs text-warning">
            Offline mode — this terminal is registered and keeps working locally.
          </div>
        )}
        <TerminalLogin />
      </>
    );
  if ((isDesktop() || isNative()) && isManagementDevice() && !can(isNative() ? "can_use_management_mobile" : "can_use_management_pc"))
    return <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-lg font-semibold">Management device</h1>
      <p>Sign in with an account permitted to use this management device. Your page and branch permissions still apply.</p>
      <Button onClick={() => void logout()}>Use another account</Button>
    </div>;
  if (!dataReady && !offlineBypass)
    return <TillLoader onRetry={retryLoad} onContinueOffline={() => setOfflineBypass(true)} />;
  // Nothing can be sold, received or moved without somewhere to book it to.
  if (!activeLocations(stores).length && !isLocationSetupRoute(location.pathname))
    return <LocationBootGuard />;

  // Anything that needs a hand here: goods on their way in, or notes this
  // branch still has to authorise or send.
  const inbound = (state.transfers ?? []).filter(
    (t) =>
      (t.toStoreId === currentStore?.id && t.status === "dispatched") ||
      (t.fromStoreId === currentStore?.id &&
        (t.status === "awaiting_approval" || t.status === "approved")),
  ).length;

  // Receipt identity wins; the locally captured install name is the fallback.
  const companyName =
    (typeof state.settings.receipt.companyName === "string"
      ? state.settings.receipt.companyName.trim()
      : "") || branding.company;

  // The sidebar and the route guard below run exactly the same test, so a link
  // that is shown always opens, and a link that is hidden cannot be reached by
  // typing its address either.
  const canSee = (item: NavItem) => canSeeNavigationItem(item, can, isAdmin, visibleRoute);

  const Brand = ({ mini }: { mini?: boolean }) => (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-4 transition-[gap,padding] duration-[var(--motion-normal)] motion-reduce:transition-none",
        mini && "gap-0 px-3.5",
      )}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <ReceiptText className="size-5" />
      </div>
      <div
        aria-hidden={mini || undefined}
        className={cn(
          "min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-[var(--motion-normal)] ease-[var(--motion-ease-emphasized)] motion-reduce:transition-none",
          mini ? "max-w-0 -translate-x-2 opacity-0" : "max-w-48 translate-x-0 opacity-100",
        )}
      >
        <p className="truncate text-sm font-semibold leading-tight">{companyName}</p>
        <p className="text-[11px] text-muted-foreground">{branding.terminal}</p>
      </div>
    </div>
  );

  // An admin on the phone browses every branch even though the device itself
  // is registered to one.
  const mayPickStore = canSwitchStores;

  const StorePicker = ({ compact = false }: { compact?: boolean } = {}) =>
    mayPickStore ? (
      <Select value={currentStore.id} onValueChange={setCurrentStore}>
        <SelectTrigger
          aria-label="Select store"
          className="h-9 w-full gap-2 text-xs [&>span]:min-w-0 [&>span]:flex-1 [&>span]:truncate [&>span]:text-left"
          // Drawer sizing also applies on tablets and is not enlarged by popup/touch rules.
          style={compact ? { height: 36, minHeight: 36, padding: "4px 10px", fontSize: 12, lineHeight: 1.25 } : undefined}
        >
          <Store className="size-3.5 shrink-0 text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {stores.map((s) => (
            <SelectItem key={s.id} value={s.id} className="text-xs">
              {s.code} · {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : (
      <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2 py-2 text-xs">
        <Store className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">
          {currentStore.code} · {currentStore.name}
        </span>
      </div>
    );

  const ProfileMenu = () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 rounded-full"
          aria-label={`Open profile for ${user.name}`}
          title={user.name}
        >
          <span className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
            {user.name
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part[0])
              .join("")
              .toUpperCase() || "U"}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <span className="block truncate text-sm">{user.name}</span>
          <span className="block text-xs font-normal capitalize text-muted-foreground">
            {user.metaRole ?? user.role}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void logout()}>
          <LogOut className="mr-2 size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={100} disableHoverableContent>
      <div className="pos-scaled flex h-dvh min-h-dvh flex-col overflow-hidden bg-background text-foreground">
        <DbConnectionModal />
        <CloudSetupGate />
        <ShiftGuard>
          <div className="flex min-h-0 min-w-0 flex-1">
            {/* Desktop / tablet sidebar */}
            <aside
              className={cn(
                "hidden shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar transition-[width] duration-[var(--motion-normal)] ease-[var(--motion-ease-standard)] motion-reduce:transition-none md:flex",
                collapsed ? "w-16" : "w-60",
              )}
            >
              <SidebarNav
                collapsed={collapsed}
                onToggleCollapse={() => setCollapsed(!collapsed)}
                canSee={canSee}
                inbound={inbound}
                header={
                  <>
                    {Brand({ mini: collapsed })}
                    <div
                      inert={collapsed || undefined}
                      aria-hidden={collapsed || undefined}
                      className={cn(
                        "overflow-hidden px-3 transition-[max-height,opacity,padding] duration-[var(--motion-normal)] ease-[var(--motion-ease-emphasized)] motion-reduce:transition-none",
                        collapsed ? "max-h-0 pb-0 opacity-0" : "max-h-16 pb-3 opacity-100",
                      )}
                    >
                      <div className="w-54">{StorePicker()}</div>
                    </div>
                  </>
                }
              />
            </aside>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {/* Mobile top bar + slide-out drawer */}
              <header className="pt-safe sticky top-0 z-30 flex shrink-0 items-center gap-2 border-b border-border/70 bg-background px-3 pb-2 md:hidden">
                <Sheet open={isMobile && drawerOpen} onOpenChange={setDrawerOpen}>
                  <SheetTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Open menu"
                      className="touch-target"
                    >
                      <Menu className="size-5" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent
                    side="left"
                    className="pt-safe pb-safe z-50 w-72 max-w-[calc(100vw-1rem)] bg-sidebar p-0"
                  >
                    <SheetTitle className="sr-only">Navigation</SheetTitle>
                    <SidebarNav
                      canSee={canSee}
                      inbound={inbound}
                      onNavigate={() => setDrawerOpen(false)}
                      header={
                        <>
                          <Brand />
                          <div className="px-3 pb-3">
                            <StorePicker compact />
                          </div>
                        </>
                      }
                    />
                  </SheetContent>
                </Sheet>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <ReceiptText className="size-4 shrink-0 text-primary" />
                  <span className="truncate text-sm font-semibold">{companyName}</span>
                </div>
                {/* The branch picker lives in the side menu only; the top bar
                  just states which branch is in use. */}
                <Badge variant="outline" className="hidden shrink-0 text-[10px] sm:inline-flex">
                  {currentStore.code}
                </Badge>
                {/* Narrow phones only get the essentials; the rest lives in the sheet. */}
                <span className="hidden sm:inline-flex">
                  <LiveClock compact />
                </span>
                <MobileStatusSheet />
                <ApprovalTokenButton compact />
                {isMobile && <ActivityBell />}
                <span className="hidden sm:inline-flex">
                  <ThemeToggle />
                </span>
                <ProfileMenu />
              </header>

              {/* Desktop header: system controls and signed-in operator profile. */}
              <header className="sticky top-0 z-30 hidden shrink-0 items-center gap-3 border-b border-border/70 bg-background px-4 py-2 md:flex">
                <div className="ml-auto" />
                <span className="hidden xl:inline-flex">
                  <LiveClock />
                </span>
                <ConnectionStatusButton />
                <SystemAlertsButton />
                <ApprovalTokenButton />
                {!isMobile && <ActivityBell />}

                {terminal.config && (
                  <Badge
                    variant="outline"
                    className="hidden shrink-0 gap-1 border-primary/40 bg-primary/10 text-[11px] text-primary 2xl:inline-flex"
                  >
                    <MapPin className="size-3" />
                    {terminal.config.locationName || currentStore.name}
                  </Badge>
                )}
                <ThemeToggle />
                <ProfileMenu />
              </header>

              <main
                className={cn(
                  "min-h-0 min-w-0 flex-1",
                  ["/inventory", "/analytics"].includes(location.pathname) && "no-scrollbar",
                  location.pathname.startsWith("/settings") ? "overflow-hidden" : "overflow-y-auto",
                )}
              >
                {(() => {
                  // Decided before the page body renders: no flash of protected data.
                  const required = requiredPermission(location.pathname);
                  const terminalManagement =
                    location.pathname === "/settings/terminals" ||
                    location.pathname === "/settings/mobile-terminals";
                  const settingsHome =
                    location.pathname === "/settings" || location.pathname === "/settings/";
                  const reportsHome =
                    location.pathname === "/reports" || location.pathname === "/reports/";
                  const allowed = terminalManagement
                    ? can("can_manage_terminals")
                    : settingsHome
                      ? can("can_access_pos_settings")
                      : reportsHome
                        ? can("can_view_sales_reports") || can("can_view_audit_trail")
                        : required === null
                          ? true
                          : required === "unknown"
                            ? isAdmin
                            : can(required);
                  if (allowed && visibleRoute(location.pathname))
                    return <AppShellContext.Provider value>{children}</AppShellContext.Provider>;
                  if (allowed) return <PermissionDenied title="Hidden for your role" flag={null} />;
                  return <PermissionDenied flag={required === "unknown" ? null : required} />;
                })()}
              </main>
            </div>
          </div>
        </ShiftGuard>
      </div>
    </TooltipProvider>
  );
}
