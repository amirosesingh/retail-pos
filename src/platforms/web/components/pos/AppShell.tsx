import { useDisplayProfile } from "@/lib/display-profile";
import { setSharedPrinterPrefs } from "@/lib/receipt-printer";
import {
  Loader2,
  Lock,
  LogOut,
  Menu,
  MapPin,
  ReceiptText,
  Settings as SettingsIcon,
  Store,
} from "lucide-react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePos } from "@/lib/pos-store";
import { useAuth, type PermissionFlag } from "@/lib/pos-auth";
import { Link, useLocation } from "@tanstack/react-router";
import { TerminalLogin } from "@/platforms/web/components/pos/TerminalLogin";
import {
  TerminalActivation,
  TerminalRevokedScreen,
} from "@/platforms/web/components/pos/TerminalActivation";
import { clearRevocation, useRevocationCheck } from "@/lib/use-revocation-check";
import { useStartupGate, startupDecision } from "@/core/activation/registration-status";
import { hasFeature } from "@/platform-config/features";
import { ConnectDatabaseScreen } from "@/platforms/web/components/pos/ConnectDatabaseScreen";
import { useAutoLock } from "@/lib/auto-lock";
import { usePosRules } from "@/lib/pos-rules.tsx";
import { SidebarNav, useSidebarCollapsed } from "@/platforms/web/components/pos/SidebarNav";
import {
  ConnectionStatusButton,
  SystemAlertsButton,
} from "@/platforms/web/components/pos/StatusCluster";
import { WindowControls } from "@/platforms/windows/components/WindowControls";

import { ActivityBell } from "@/platforms/web/components/pos/ActivityBell";
import { MobileStatusSheet } from "@/platforms/web/components/pos/MobileStatusSheet";
import { ShiftGuard } from "@/platforms/web/components/pos/ShiftGuard";
import { PermissionDenied } from "@/platforms/web/components/pos/PermissionGate";
import { useVisibility } from "@/lib/ui-visibility";

import { LiveClock } from "@/platforms/web/components/pos/LiveClock";
import { ThemeToggle } from "@/platforms/web/components/pos/ThemeToggle";
import { hydrateBillSequence } from "@/lib/bill-number";
import { DbConnectionModal } from "@/platforms/windows/components/DbConnectionModal";
import { UpdateHeaderButton } from "@/platforms/web/components/pos/UpdateHeaderButton";
import { routePermissionForPath, type NavItem } from "@/platforms/web/components/pos/nav-config";
import { setPrintStore, setPrintSettings, setServiceTerms } from "@/lib/pos-print";
import { bookingRulesOf } from "@/core/types/pos-types";
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
import { TillLoader } from "@/components/shared/TillLoader";
import { LocationBootGuard } from "@/platforms/web/components/pos/LocationBootGuard";
import { activeLocations } from "@/lib/locations";
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
  useEffect(() => startSyncEngine(), []);
  const { stores, currentStore, setCurrentStore, state, ready: dataReady } = usePos();
  useEffect(() => {
    setSharedPrinterPrefs(state.settings.integrations.receiptPrinter);
    return () => setSharedPrinterPrefs(undefined);
  }, [state.settings.integrations.receiptPrinter]);
  const {
    ready,
    user,
    isAdmin,
    isSupervisor,
    canSwitchStores,
    terminalStoreId,
    logout,
    lock,
    can,
  } = useAuth();
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Set when the operator chooses to carry on from the terminal's own copy
  // after the first load could not reach the central database.
  const [offlineBypass, setOfflineBypass] = useState(false);
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
  const location = useLocation();
  const { visibleRoute } = useVisibility();

  useDisplayProfile(state.settings.integrations.displayProfile);
  // Terminal-wide font / control scaling preference.
  useUiScale();

  // Idle screens return to the sign-in keypad. The shift stays open.
  // Synchronized terminal settings are the source of truth. The legacy POS
  // rule remains a compatibility fallback for databases upgraded in stages.
  const posRules = usePosRules();
  const ruleLockSeconds =
    state.settings.integrations.autoLockTimeoutSeconds ??
    (posRules.source === "DATABASE" || posRules.source === "LAST_KNOWN_GOOD"
      ? posRules.rules.auto_lock_timeout_seconds
      : undefined);
  useAutoLock(
    !!user,
    () => {
      void lock();
    },
    ruleLockSeconds,
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
  // The phone app is an admin tool: an admin on Android keeps the freedom to
  // look at any branch, so the terminal pin does not apply to them there.
  useEffect(() => {
    if (isNative() && isAdmin) return;
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

  if (!ready) return <TillLoader message="Restoring your workspace…" />;
  // Every activated terminal, including a browser-based till, must finish
  // unsealing its tenant configuration before any data read or write starts.
  // The connection profile is part of that: showing setup while it is still
  // being read out of the vault is what used to send a working till back to
  // the connection screen after a restart.
  // The first connection check of the launch is part of that same window: a
  // decision taken before it has answered is a decision taken on a guess.
  // A registered till also waits for the first answer about its own
  // registration, so a deleted terminal never reaches the sales screen.
  const awaitingVerdict =
    (isDesktop() || isNative()) && Boolean(terminal.config) && !terminal.verified;
  if (
    terminal.hydrating ||
    !profileHydrated ||
    awaitingVerdict ||
    ((isDesktop() || isNative()) && startup.probing)
  )
    return (
      <div className="flex h-dvh items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );

  // Desktop tills and Android terminals both have to register before use.
  if (isDesktop() || isNative()) {
    if (terminal.revoked)
      return <TerminalRevokedScreen onReactivate={clearRevocation} reason={terminal.reason} />;
    // A stored activation is not a licence to sign in: the connection has to
    // be proven every launch, unless this platform may trade offline.
    const decision = startupDecision({
      registration: startup.registration,
      verdict: startup.verdict,
      activated: Boolean(terminal.config),
      offlineCapable: hasFeature("offlineFirst"),
    });
    // Step 1 — no usable database connection: ask for the URL and key.
    if (decision === "connect-database" || decision === "offline-blocked")
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
  if (!dataReady && !offlineBypass)
    return <TillLoader onContinueOffline={() => setOfflineBypass(true)} />;
  // Nothing can be sold, received or moved without somewhere to book it to.
  if (!activeLocations(stores).length && !location.pathname.startsWith("/stores"))
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
  const companyName = state.settings.receipt.companyName?.trim() || branding.company;

  // The sidebar and the route guard below run exactly the same test, so a link
  // that is shown always opens, and a link that is hidden cannot be reached by
  // typing its address either.
  const canSee = (item: NavItem) => {
    if (item.flag && !can(item.flag)) return false;
    if (item.adminOnly && !isAdmin && !item.flag) return false;
    return visibleRoute(item.to);
  };

  const Brand = ({ mini }: { mini?: boolean }) => (
    <div className={cn("flex items-center gap-2 px-3 py-4", mini && "justify-center px-0")}>
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <ReceiptText className="size-5" />
      </div>
      {!mini && (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">{companyName}</p>
          <p className="text-[11px] text-muted-foreground">{branding.terminal}</p>
        </div>
      )}
    </div>
  );

  // An admin on the phone browses every branch even though the device itself
  // is registered to one.
  const mayPickStore = canSwitchStores || (isNative() && isAdmin);

  const StorePicker = () =>
    mayPickStore ? (
      <Select value={currentStore.id} onValueChange={setCurrentStore}>
        <SelectTrigger className="h-9 w-full text-xs">
          <Store className="size-3.5 text-muted-foreground" />
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

  const Footer = ({ mini }: { mini?: boolean }) =>
    mini ? (
      <div className="px-2 pb-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-full justify-center px-0"
          onClick={logout}
          aria-label="Sign out"
        >
          <LogOut className="size-4" />
        </Button>
      </div>
    ) : (
      <div className="space-y-2 px-3 pb-2">
        <div className="rounded-md border border-border px-2 py-2">
          <p className="truncate text-xs font-medium">{user.name}</p>
          <p className="text-[11px] capitalize text-muted-foreground">{user.role}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 h-7 w-full justify-start px-1 text-xs"
            onClick={logout}
          >
            <LogOut className="size-3.5" /> Sign out
          </Button>
        </div>
      </div>
    );

  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={100} disableHoverableContent>
      <div className="pos-scaled flex h-dvh min-h-dvh flex-col overflow-hidden bg-background text-foreground">
        <DbConnectionModal />
        <CloudSetupGate />
        {/* Frameless desktop shell: draggable strip under the native window buttons. */}
        {isDesktop() && (
          <div className="app-drag flex h-[34px] shrink-0 items-center gap-2 border-b border-border bg-sidebar pl-3">
            <ReceiptText className="size-3.5 shrink-0 text-primary" />
            <span className="truncate text-[11px] font-semibold text-muted-foreground">
              {companyName}
            </span>
            <WindowControls />
          </div>
        )}
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
                    <Brand mini={collapsed} />
                    {!collapsed && <div className="px-3 pb-3">{<StorePicker />}</div>}
                  </>
                }
                footer={<div className="mt-auto">{<Footer mini={collapsed} />}</div>}
              />
            </aside>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {/* Mobile top bar + slide-out drawer */}
              <header className="pt-safe sticky top-0 z-30 flex shrink-0 items-center gap-2 border-b border-border bg-sidebar px-3 pb-2 md:hidden">
                <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
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
                            <StorePicker />
                          </div>
                        </>
                      }
                      footer={<div className="mt-auto">{<Footer />}</div>}
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
                <span className="hidden sm:inline-flex">
                  <UpdateHeaderButton />
                </span>
                <span className="hidden sm:inline-flex">
                  <Button
                    asChild
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    aria-label="Settings"
                  >
                    <Link to="/settings">
                      <SettingsIcon className="size-4" />
                    </Link>
                  </Button>
                </span>
                <span className="hidden sm:inline-flex">
                  <ThemeToggle />
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="touch-target shrink-0 px-2 text-[11px]"
                  onClick={() => void lock()}
                >
                  <Lock className="size-3.5" /> <span className="hidden sm:inline">Lock</span>
                </Button>
              </header>

              {/* Desktop header: signed-in cashier + quick lock / switch user */}
              <header className="sticky top-0 z-30 hidden shrink-0 items-center gap-3 border-b border-border bg-sidebar px-4 py-2 md:flex">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{user.name}</p>
                  <p className="text-[11px] capitalize text-muted-foreground">
                    {user.metaRole ?? user.role}
                  </p>
                </div>
                <div className="ml-auto" />
                <span className="hidden xl:inline-flex">
                  <LiveClock />
                </span>
                <ConnectionStatusButton />
                <SystemAlertsButton />
                <ActivityBell />

                {terminal.config && (
                  <Badge
                    variant="outline"
                    className="hidden shrink-0 gap-1 border-primary/40 bg-primary/10 text-[11px] text-primary 2xl:inline-flex"
                  >
                    <MapPin className="size-3" />
                    {terminal.config.locationName || currentStore.name}
                  </Badge>
                )}
                <span className="hidden lg:inline-flex">
                  <UpdateHeaderButton />
                </span>
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  aria-label="Settings"
                >
                  <Link to="/settings">
                    <SettingsIcon className="size-4" />
                  </Link>
                </Button>
                <ThemeToggle />
                <Button
                  variant="outline"
                  size="sm"
                  className="size-8 shrink-0 px-0 text-xs xl:h-8 xl:w-auto xl:px-3"
                  onClick={() => void lock()}
                >
                  <Lock className="size-3.5" />{" "}
                  <span className="hidden xl:inline">Lock / Switch user</span>
                </Button>
              </header>

              <main
                className={cn(
                  "min-h-0 min-w-0 flex-1",
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
                  const allowed = terminalManagement
                    ? can("can_manage_terminals")
                    : settingsHome
                      ? isSupervisor || can("can_access_pos_settings")
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
