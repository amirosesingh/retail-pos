import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Context,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import {
  discardRejectedExternalAuthSession,
  supabaseExternal as supabase,
} from "@/integrations/supabase/external-client";
import { type MetaRole } from "@/lib/pos-users";
import { clearStoredCredentials, readCredentials, saveCashierToken } from "@/lib/pos-credentials";
import { issueCashierSession } from "@/lib/pos-session.functions";
import { startDeviceSession, endDeviceSession } from "@/lib/user-sessions.functions";
import { loadSessionToken, saveSessionToken } from "@/lib/pos-credentials";
import { toLoginAddress, usernameFromAddress } from "@/lib/internal-domains";
import { activeBranchId, activeBranchName, bindTerminalBranch } from "@/lib/active-branch";
import { verifyCachedPin } from "@/lib/offline-credentials";
import { recordSignIn } from "@/lib/shift-attendance";
import { endShiftSessions } from "@/lib/shift-sessions";
import { notifySessionExpired, onSessionExpired } from "@/lib/session-expiry";
import { validateStoredAuthSession } from "@/lib/auth-session-guard";
import { setCentralAuthSessionPresent } from "@/lib/session-presence";
import { APP_RESUME_EVENT } from "@/core/activation/connection-health";
import {
  clearAutoLockActivity,
  markAutoLockActivity,
  setSessionIdleMinutes,
} from "@/lib/auto-lock";
import { markStartupStage, resetStartupTiming } from "@/lib/startup-timing";
import { setActivityAudienceIdentity } from "@/lib/activity-audience";
import { bumpSessionEpoch, isCurrentEpoch, sessionEpoch } from "@/lib/session-epoch";
import { awaitProfileHydrated } from "@/lib/connection-profile";
import { hydrateTerminalConfig, readTerminalConfig } from "@/core/activation/terminal-tokens";
import { hasRequiredPlatformConfig, subscribeConfigReady } from "@/lib/platform-config-ready";
import { isTerminalApp } from "@/platform-config/platform";
import { recordDiagnostic, reasonCode } from "@/lib/diagnostics";
import {
  failureFromAuthError,
  failureFromReadiness,
  loginFailureMessage,
  type LoginFailure,
} from "@/lib/login-failure";

import {
  CASHIER_PERMISSIONS,
  FULL_PERMISSIONS,
  NO_PERMISSIONS,
  WAREHOUSE_PERMISSIONS,
  SUPERVISOR_PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  fromDbRole,
  hasPermission,
  normalizePermissions,
  toDbRole,
  type PermissionFlag,
  type PermissionKey,
  type StaffPermissions,
  type StaffRole,
} from "@/lib/permissions";

async function validateCentralAuthSession(online: boolean) {
  return validateStoredAuthSession(supabase.auth, {
    online,
    verifySession: async (current) => {
      const { verifySession } = await import("@/lib/session-verify.functions");
      const checked = await verifySession({
        data: { accessToken: current.access_token },
      });
      if (checked.reason === "unavailable") return "unavailable";
      return checked.ok ? "verified" : "rejected";
    },
  });
}

export {
  CASHIER_PERMISSIONS,
  FULL_PERMISSIONS,
  NO_PERMISSIONS,
  WAREHOUSE_PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  fromDbRole,
  hasPermission,
  normalizePermissions,
  toDbRole,
};
export type { PermissionFlag, PermissionKey, StaffPermissions, StaffRole };

export type PosRole = "cashier" | "admin";

/** Roles stored in the backend `user_roles` table. */
export type AppRole = "admin" | "manager" | "staff";
export const APP_ROLES: AppRole[] = ["admin", "manager", "staff"];

const offlineAppRole = (roleSlug: string | null | undefined): AppRole => {
  const role = String(roleSlug ?? "")
    .trim()
    .toLowerCase();
  if (role === "admin") return "admin";
  if (role === "manager" || role === "supervisor") return "manager";
  return "staff";
};

export const DEFAULT_PERMISSIONS = CASHIER_PERMISSIONS;

/** An employee record the admin can edit at any time. */
export type StaffMember = {
  id: string;
  name: string;
  /** unique staff id used to sign in */
  staffId: string;
  /** Supabase login email linking this duty record to a backend account */
  email: string;
  /** legacy local password (unused since Supabase auth) */
  password?: string;
  /** current assigned store duty */
  storeId: string;
  permissions: StaffPermissions;
};

export type PosUser = {
  staffId: string;
  name: string;
  email: string;
  role: PosRole;
  /** role stored on the Supabase account (user_metadata.role) */
  metaRole: MetaRole | null;
  /** backend roles granted to this account */
  roles: AppRole[];
  /** null for admin = access to every store */
  storeId: string | null;
  permissions: StaffPermissions;
};

/**
 * No demo staff. Records only ever appear because someone created them, so a
 * deleted person never comes back after a restart.
 */
const SEED_STAFF: StaffMember[] = [];

const STAFF_KEY = "pos-staff-v1";
/** Terminal identity of the cashier at the till. Never stores the PIN. */
const TERMINAL_KEY = "pos-terminal-user-v1";

export type TerminalUser = {
  userCode: string;
  name: string;
  role: AppRole;
  /** The optional custom role held by the central staff record. */
  roleSlug?: string | null;
  storeId: string | null;
  email: string;
  /** row id in public.cashiers when this is a cashier terminal session */
  cashierId?: string;
  /** permission matrix loaded with the cashier row */
  permissions?: Partial<StaffPermissions>;
  /** signed in locally because the backend terminal tables are not provisioned yet */
  local?: boolean;
};

/** Row loaded from public.app_users for the signed-in account. */
export type AppUserProfile = {
  user_id: string;
  full_name: string;
  role: AppRole;
  store_id: string | null;
  email: string;
  permissions: Partial<StaffPermissions> | null;
  is_active: boolean;
};

/** Offline bootstrap admin so the terminal is never locked out before the
 *  backend auth tables (app_users / user_roles) have been provisioned. */

type AuthCtx = {
  ready: boolean;
  user: PosUser | null;
  isAdmin: boolean;
  /** supervisor or admin — may reach settings, reports, inventory, user management */
  isSupervisor: boolean;
  /** admin, or a supervisor assigned to "All stores" — may switch branches */
  canSwitchStores: boolean;
  /** Branch this PC is registered to. When set, every account signed in here
   *  trades in this branch — the staff record's own store never applies. */
  terminalStoreId: string | null;
  /** Human name of the branch this PC is registered to, for lock messages. */
  terminalStoreName: string | null;
  /** cashier accounts are limited to the POS terminal */
  isCashier: boolean;
  /** warehouse account — stock/receiving user driven purely by its toggles */
  isWarehouse: boolean;
  /** raw Supabase user id of the signed-in account */
  authUserId: string | null;
  /** cashier currently signed in at the terminal (User ID + PIN) */
  terminalUser: TerminalUser | null;
  /** public.app_users record backing the signed-in account */
  appUser: AppUserProfile | null;
  /** permission check that always passes for the admin */
  can: (flag: PermissionFlag) => boolean;
  staff: StaffMember[];
  addStaff: (member: Omit<StaffMember, "id">) => void;
  updateStaff: (member: StaffMember) => void;
  removeStaff: (id: string) => void;
  login: (
    email: string,
    password: string,
  ) => Promise<{ ok: boolean; error?: string; code?: LoginFailure }>;
  /** Cashier tab: numeric User ID + PIN mapped onto a Supabase email account. */
  cashierLogin: (
    userId: string,
    pin: string,
  ) => Promise<{ ok: boolean; error?: string; code?: LoginFailure | "session-open-failed" }>;
  logout: () => Promise<void>;
  /** Lock the till / switch user — clears the session without losing local data. */
  lock: () => Promise<void>;
  /** Where this device stands right now. */
  sessionState: SessionState;
};

/** The named states a device can be in. They never overlap. */
export type SessionState = "active" | "locked" | "logged-out" | "expired" | "signed-out";

/**
 * The auth context is stored on a global registry key rather than as a plain
 * module constant. If the module ever gets evaluated twice (mixed `@/lib/...`
 * and relative import paths, or a stale dev cache), both copies then share one
 * context object instead of silently creating two — which is what produced the
 * "useAuth must be used inside AuthProvider" crash on pages like /settings.
 */
const AUTH_CTX_KEY = "__nwPosAuthContext__";

type AuthGlobal = {
  [AUTH_CTX_KEY]?: Context<AuthCtx | null>;
};

const authGlobal = globalThis as unknown as AuthGlobal;

const AuthContext: Context<AuthCtx | null> =
  authGlobal[AUTH_CTX_KEY] ?? createContext<AuthCtx | null>(null);
authGlobal[AUTH_CTX_KEY] = AuthContext;

const norm = (v: string) => v.trim().toLowerCase();

export function AuthProvider({ children }: { children: ReactNode }) {
  const [staff, setStaff] = useState<StaffMember[]>(SEED_STAFF);
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [authReady, setAuthReady] = useState(false);
  const [rolesReady, setRolesReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [authEnabled, setAuthEnabled] = useState(() => !isTerminalApp());
  const [terminalUser, setTerminalUser] = useState<TerminalUser | null>(null);
  const [appUser, setAppUser] = useState<AppUserProfile | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>("signed-out");
  const centralIdentityRef = useRef<string | null>(null);
  const centralSessionVerifiedRef = useRef(false);

  useEffect(() => {
    try {
      const rawStaff = window.localStorage.getItem(STAFF_KEY);
      if (rawStaff)
        setStaff(
          (JSON.parse(rawStaff) as StaffMember[]).map((s) => ({
            ...s,
            email: s.email ?? "",
            permissions: { ...DEFAULT_PERMISSIONS, ...(s.permissions ?? {}) },
          })),
        );
    } catch {
      /* ignore corrupt storage */
    }
    try {
      const rawTerminal = window.sessionStorage.getItem(TERMINAL_KEY);
      if (rawTerminal) setTerminalUser(JSON.parse(rawTerminal) as TerminalUser);
    } catch {
      /* ignore corrupt storage */
    }
  }, []);

  // A terminal's cloud client must not be touched until its OS vault/Keystore
  // profile has been restored and found complete. Missing configuration is a
  // normal first-install state; AppShell owns that setup screen. Web keeps its
  // existing hosting-variable path and enables auth immediately.
  useEffect(() => {
    if (!isTerminalApp()) return;
    let cancelled = false;
    const apply = (configured: boolean) => {
      if (cancelled) return;
      setAuthEnabled(configured);
      if (!configured) {
        setSession(null);
        setRoles([]);
        setAppUser(null);
        setAuthReady(true);
        setRolesReady(true);
        setProfileReady(true);
      }
    };
    void awaitProfileHydrated()
      .then(() => hasRequiredPlatformConfig())
      .then((state) => apply(state.ready))
      .catch(() => apply(false));
    const unsubscribe = subscribeConfigReady((state) => apply(state.ready));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Cloud session: hydrate once configuration is ready, then follow auth
  // state changes. No auth request is made before that point on a terminal.
  useEffect(() => {
    if (!authEnabled) return;
    let active = true;
    let bootstrapped = false;
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      // INITIAL_SESSION is only the token restored from storage. Do not expose
      // it to the application until the server has proved that its Supabase
      // session still exists. This also keeps sync/telemetry quiet on boot.
      if (event === "INITIAL_SESSION") {
        if (!next) setCentralAuthSessionPresent(false);
        return;
      }
      if (!bootstrapped) {
        return;
      }
      const nextIdentity = next?.user?.id ?? null;
      const continuingSession =
        !!nextIdentity &&
        nextIdentity === centralIdentityRef.current &&
        (event === "TOKEN_REFRESHED" || event === "SIGNED_IN");
      if (continuingSession) {
        // Supabase may repeat SIGNED_IN when a window regains focus. The
        // identity did not change, so retain the already-proven role/profile
        // instead of replacing the whole POS with its startup loader.
        // TOKEN_REFRESHED/SIGNED_IN can also be emitted for a restored local
        // session. Preserve a previous server proof; never create one merely
        // because the client replayed or refreshed its cached token.
        setCentralAuthSessionPresent(centralSessionVerifiedRef.current);
        if (!centralSessionVerifiedRef.current && event === "TOKEN_REFRESHED") return;
        setSession(next);
        return;
      }
      // A refreshed token is the same sign-in continuing, not a new one: only
      // a genuine sign-in starts a new generation.
      if (next && event !== "TOKEN_REFRESHED") bumpSessionEpoch();
      centralIdentityRef.current = nextIdentity;
      centralSessionVerifiedRef.current = Boolean(next && event === "SIGNED_IN");
      setCentralAuthSessionPresent(centralSessionVerifiedRef.current);
      setSession(next);
      if (!next) {
        setRoles([]);
        setAppUser(null);
        setRolesReady(true);
        setProfileReady(true);
      } else {
        setRolesReady(false);
        setProfileReady(false);
      }
    });
    void (async () => {
      const checked = await validateCentralAuthSession(
        typeof navigator === "undefined" || navigator.onLine !== false,
      );
      if (!active) return;
      bootstrapped = true;
      const next = checked.session;
      centralIdentityRef.current = next?.user?.id ?? null;
      centralSessionVerifiedRef.current = checked.state === "verified";
      setCentralAuthSessionPresent(centralSessionVerifiedRef.current);
      setSession(next);
      if (!next) {
        setRoles([]);
        setAppUser(null);
        setRolesReady(true);
        setProfileReady(true);
      } else {
        setRolesReady(false);
        setProfileReady(false);
      }
      setAuthReady(true);
      if (checked.state === "rejected") notifySessionExpired();
    })();
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [authEnabled]);

  // Backend roles for the signed-in account.
  const userId = session?.user?.id ?? null;
  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setRoles([]);
      setRolesReady(true);
      return;
    }
    setRolesReady(false);
    void supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .then(
        ({ data, error }) => {
          if (cancelled) return;
          setRoles(error ? [] : ((data ?? []) as { role: AppRole }[]).map((r) => r.role));
          setRolesReady(true);
          markStartupStage("roles");
        },
        () => {
          if (!cancelled) {
            setRoles([]);
            setRolesReady(true);
          }
        },
      );
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Identity + permission toggles from public.app_users for the signed-in account.
  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setAppUser(null);
      setProfileReady(true);
      return;
    }
    setProfileReady(false);
    void supabase.rpc("current_app_user" as never).then(
      ({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setAppUser(null);
          setProfileReady(true);
          return;
        }
        const row = (Array.isArray(data) ? data[0] : data) as unknown as AppUserProfile | undefined;
        setAppUser(row ?? null);
        setProfileReady(true);
        markStartupStage("profile");
      },
      () => {
        if (!cancelled) {
          setAppUser(null);
          setProfileReady(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const persist = useCallback((next: StaffMember[]) => {
    setStaff(next);
    try {
      window.localStorage.setItem(STAFF_KEY, JSON.stringify(next));
    } catch {
      /* storage full */
    }
  }, []);

  const addStaff = useCallback(
    (member: Omit<StaffMember, "id">) =>
      persist([...staff, { ...member, id: crypto.randomUUID() }]),
    [persist, staff],
  );

  const updateStaff = useCallback(
    (member: StaffMember) => persist(staff.map((s) => (s.id === member.id ? member : s))),
    [persist, staff],
  );

  const removeStaff = useCallback(
    (id: string) => persist(staff.filter((s) => s.id !== id)),
    [persist, staff],
  );

  const login = useCallback(async (email: string, password: string) => {
    // Terminal credentials are restored asynchronously from DPAPI/Keystore.
    // Never construct the lazy cloud client until the current saved profile
    // has replaced any older cloud pair carried by terminal activation.
    await awaitProfileHydrated();
    // A missing or half-saved connection is a configuration problem, and
    // must never be reported as a wrong password.
    const readiness = await hasRequiredPlatformConfig();
    const configFailure = failureFromReadiness(readiness);
    if (configFailure)
      return {
        ok: false,
        code: configFailure,
        error: loginFailureMessage(configFailure),
      };
    // This is an interactive sign-in, not a restored browser session.
    // Start its idle allowance before Auth publishes SIGNED_IN so the old
    // user's timestamp cannot race the new account onto the lock screen.
    markAutoLockActivity();
    resetStartupTiming();
    // Check the account after authentication. A pre-login app_users read
    // sends an old bearer token (or no user token) to a protected table and
    // produces a noisy 401 before the password is even submitted.
    // One handler for both worlds: a plain username belongs to a terminal
    // account and is mapped onto its hidden internal address; anything with
    // an "@" is used exactly as typed.
    const address = toLoginAddress(email);
    // Make a same-account interactive sign-in distinguishable from a replayed
    // SIGNED_IN event for an unverified restored token.
    centralIdentityRef.current = null;
    centralSessionVerifiedRef.current = false;
    setCentralAuthSessionPresent(false);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: address,
      password,
    });
    if (error) {
      const code = failureFromAuthError(error);
      return { ok: false, code, error: loginFailureMessage(code) };
    }
    markStartupStage("authentication");
    // The account must resolve to a profile with a role before it is let in.
    try {
      const { data: profileRows, error: profileError } = await supabase.rpc("current_app_user");
      const profile = (Array.isArray(profileRows) ? profileRows[0] : null) as Record<
        string,
        unknown
      > | null;
      if (profileError || !profile) {
        await supabase.auth.signOut({ scope: "local" });
        return {
          ok: false,
          code: "permission-denied" as const,
          error: loginFailureMessage("permission-denied"),
        };
      }
      if (profile["is_active"] === false) {
        await supabase.auth.signOut({ scope: "local" });
        return {
          ok: false,
          code: "account-inactive" as const,
          error: loginFailureMessage("account-inactive"),
        };
      }
    } catch {
      await supabase.auth.signOut({ scope: "local" });
      return {
        ok: false,
        code: "permission-denied" as const,
        error: loginFailureMessage("permission-denied"),
      };
    }

    // Whoever signs in on this device trades in the terminal's branch.
    bindTerminalBranch();
    // Register this device so it can be listed and reset remotely, and so
    // it signs itself out once it has been left idle for too long.
    try {
      const token = data.session?.access_token;
      if (token) {
        const started = await startDeviceSession({
          data: {
            kind: "staff",
            accessToken: token,
            label: data.user?.email ?? email.trim(),
            platform: typeof navigator === "undefined" ? "web" : navigator.platform || "web",
          },
        });
        if (started.ok) {
          await saveSessionToken(started.token);
          setSessionIdleMinutes(started.idleMinutes);
        }
      }
    } catch {
      /* the account token still works on its own */
    }
    return { ok: true };
  }, []);

  const cashierLogin = useCallback(
    async (
      userId: string,
      pin: string,
    ): Promise<{
      ok: boolean;
      error?: string;
      code?: LoginFailure | "session-open-failed";
    }> => {
      const code = usernameFromAddress(userId);
      if (!code) return { ok: false, error: "Enter your username" };
      // Accounts are provisioned with a 4-32 character credential, so the till
      // accepts the same range: short numeric PINs and longer passcodes alike.
      if (pin.length < 4 || pin.length > 32)
        return { ok: false, error: "Enter your PIN or passcode" };
      // A till that was never connected has nowhere to check a PIN against.
      // Saying "PIN not recognised" there sends people hunting for the wrong
      // fix, so the configuration problem is named instead.
      const readiness = await hasRequiredPlatformConfig();
      const configFailure = failureFromReadiness(readiness);
      if (configFailure)
        return {
          ok: false,
          code: configFailure,
          error: loginFailureMessage(configFailure),
        };
      markAutoLockActivity();
      resetStartupTiming();

      let offline = false;
      if (typeof navigator !== "undefined" && !navigator.onLine) offline = true;

      // The stored PIN hash is the authority. The hosted endpoint verifies it
      // and returns the already-provisioned Auth identity for this account.
      type ServerLogin = {
        ok?: boolean;
        status?: number;
        code?: string;
        error?: string;
        authTokenHash?: string;
        cashierToken?: string;
        sessionToken?: string;
        idleMinutes?: number;
        cashier?: {
          id: string;
          username: string;
          full_name: string;
          store_id: string | null;
          role: AppRole;
          role_slug: string | null;
          permissions: Record<string, boolean>;
        };
      };
      let verified: ServerLogin | null = null;
      let failure = "";
      /** True when the server never got to judge the credential itself. */
      let unreachable = offline;
      if (!offline) {
        try {
          let payload: ServerLogin | null;
          let status: number;
          if (window.pos?.cashierLogin) {
            // Electron performs the HTTPS request in its main process. The PIN
            // is still verified and throttled by the hosted backend, but an
            // expected rejection no longer appears as repeated failed network
            // resources in Chromium's console.
            payload = await window.pos.cashierLogin(code, pin);
            status = payload?.status ?? 503;
          } else {
            const { serverUrl } = await import("@/lib/server-origin");
            // A till on a flaky line must not hang on the keypad: after six
            // seconds the local database answers instead.
            const abort = new AbortController();
            const timer = window.setTimeout(() => abort.abort(), 6_000);
            const res = await fetch(serverUrl("/api/public/cashier-login"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: abort.signal,
              body: JSON.stringify({
                username: code,
                pin,
                platform: typeof navigator === "undefined" ? "web" : navigator.platform || "web",
                // An all-branches account has no branch of its own, so the
                // terminal's branch is what the session is stamped with.
                branchId: activeBranchId(null),
              }),
            }).finally(() => window.clearTimeout(timer));
            status = res.status;
            payload = (await res.json().catch(() => null)) as ServerLogin | null;
          }
          if (payload?.ok) verified = payload;
          else {
            failure = payload?.error ?? "";
            // A server that cannot reach the central database (missing key,
            // 5xx, gateway) has not rejected anyone — fall through to the local
            // database. A 401 is a real rejection and must stay one.
            const code503 = payload?.code;
            if (status >= 500 || code503 === "no_service_key" || code503 === "no_server")
              unreachable = true;
          }
        } catch {
          unreachable = true;
        }
      }

      let next: TerminalUser;
      let signedInOffline = false;
      if (!verified && unreachable) {
        // Tier 1: the till's own local SQL database.
        const { verifyLocalPin } = await import("@/core/local-db/local-staff");
        const local = await verifyLocalPin(code, pin);
        if (local.ok) {
          signedInOffline = true;
          next = {
            userCode: local.staff.username,
            name: local.staff.full_name,
            role: offlineAppRole(local.staff.roleSlug),
            roleSlug: local.staff.roleSlug,
            storeId: activeBranchId(null) ?? (local.staff.store_id?.trim() || null),
            email: "",
            cashierId: local.staff.id,
            permissions: local.staff.permissions as unknown as TerminalUser["permissions"],
          };
        } else if (local.reason === "inactive") {
          return { ok: false, error: "Account deactivated" };
        } else {
          // Tier 2: the browser-storage verifier kept by earlier builds.
          const cached = await verifyCachedPin(code, pin);
          if (!cached)
            return {
              ok: false,
              error:
                local.reason === "invalid" || local.reason === "bad-pin"
                  ? "Invalid username or PIN"
                  : local.reason === "locked"
                    ? local.error
                    : "No connection and this account has not signed in on this terminal before. Connect once, then you can sign in offline.",
            };
          signedInOffline = true;
          next = {
            userCode: cached.username,
            name: cached.fullName,
            role: offlineAppRole(cached.roleSlug),
            roleSlug: cached.roleSlug ?? "staff",
            storeId: activeBranchId(null) ?? (cached.storeId?.trim() || null),
            email: "",
            cashierId: cached.cashierId,
            permissions: cached.permissions as unknown as TerminalUser["permissions"],
          };
        }
      } else if (verified?.cashier) {
        markStartupStage("authentication");
        const account = verified.cashier;
        next = {
          userCode: account.username,
          name: account.full_name || account.username,
          // The protected PIN endpoint reads this from public.app_users. This
          // preserves an administrator's existing session for the desktop gate;
          // the desktop process independently verifies it before granting IPC.
          role: account.role,
          roleSlug: account.role_slug,
          storeId: activeBranchId(account.store_id ?? null),
          email: "",
          cashierId: account.id,
          permissions: account.permissions as unknown as TerminalUser["permissions"],
        };
        // The PIN is only in hand at this moment: keep a verifier and the
        // profile in the local database so the next outage is survivable.
        try {
          const { cacheStaffRoster, rememberLocalPin } =
            await import("@/core/local-db/local-staff");
          await cacheStaffRoster([
            {
              id: account.id,
              user_id: account.username,
              full_name: account.full_name,
              store_id: account.store_id,
              permissions: account.permissions,
              role_slug: account.role_slug ?? account.role,
              is_active: true,
              pin_length: pin.length,
            },
          ]);
          await rememberLocalPin(account.username, pin);
        } catch {
          /* offline sign-in stays on the browser-storage tier */
        }
      } else {
        return { ok: false, error: failure || "Invalid username or PIN" };
      }
      if (signedInOffline) {
        // Queue the sign-in so head office sees it once the line is back. The id
        // is derived from terminal + person + minute, so a replay is an upsert.
        try {
          const { queueOfflineSignIn } = await import("@/lib/offline-sign-ins");
          await queueOfflineSignIn({
            username: next.userCode,
            fullName: next.name,
            storeId: next.storeId,
          });
        } catch {
          /* the sign-in itself still stands */
        }
      }

      // Establish the proven relay credentials before publishing terminalUser.
      // PosProvider starts bootstrap as soon as terminalUser exists; publishing
      // it first raced the encrypted credential write and produced an anonymous
      // `stores` request whose RLS-filtered `200 []` looked authoritative.
      let desktopRelaySessionReady = false;
      try {
        let cashierToken = verified?.cashierToken ?? "";
        const sessionToken = verified?.sessionToken ?? "";
        if (!cashierToken) {
          const issued = await issueCashierSession({ data: { username: next.userCode, pin } });
          if (issued.ok) cashierToken = issued.token;
        }
        if (cashierToken) {
          await saveCashierToken(cashierToken);
          if (sessionToken) {
            await saveSessionToken(sessionToken);
            setSessionIdleMinutes(Number(verified?.idleMinutes ?? 0));
            // The hosted endpoint has verified the PIN, signed the cashier
            // identity and opened this server-side device session. In Electron
            // these are the authoritative credentials used by local SQL and
            // the relay; the direct Supabase browser session below is an
            // additional RLS identity, not permission to discard this proof.
            desktopRelaySessionReady = Boolean(window.pos?.cashierLogin);
          } else {
            const started = await startDeviceSession({
              data: {
                kind: "cashier",
                cashierToken,
                label: next.name,
                staffUserId: next.userCode,
                ...(next.cashierId ? { cashierId: next.cashierId } : {}),
                ...(next.storeId ? { branchId: next.storeId } : {}),
                platform: typeof navigator === "undefined" ? "web" : navigator.platform || "web",
              },
            });
            if (started.ok) {
              await saveSessionToken(started.token);
              setSessionIdleMinutes(started.idleMinutes);
            }
          }
        }
      } catch {
        /* Auth fallback below may still establish a direct database session. */
      }

      // A PIN login is verified by the hosted endpoint first. It returns a
      // one-use Auth proof only after that succeeds, so every shell establishes
      // RLS identity without guessing an address, changing a user's ordinary
      // password, or invoking a server function against its local app origin.
      if (verified?.authTokenHash) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: verified.authTokenHash,
          // Supabase now treats the former signup and magic-link verification
          // types as deprecated aliases. Admin generate_link still mints the
          // proof as a magic link, but token-hash exchange uses the unified
          // email sign-in type. Keeping the old value makes a correctly
          // verified PIN fail here with "invalid verification type".
          type: "email",
        });
        if (error) {
          recordDiagnostic({
            kind: "soft_write_failed",
            entity: "cashier_auth_session",
            code: reasonCode(error),
            recordId: next.userCode,
            storeId: next.storeId,
          });
          if (!desktopRelaySessionReady) {
            clearStoredCredentials();
            if (verified.sessionToken) {
              void endDeviceSession({ data: { sessionToken: verified.sessionToken } }).catch(
                () => undefined,
              );
            }
            return {
              ok: false,
              code: "session-open-failed",
              error:
                "Your PIN was verified, but the secure database session could not be opened. Ask an administrator to repair this staff login.",
            };
          }
        }
      }

      bumpSessionEpoch();
      setTerminalUser(next);
      // The branch is in place before the register mounts, so nothing renders
      // against an unresolved branch.
      try {
        const { writeBranch } = await import("@/core/local-db/local-db");
        if (next.storeId)
          writeBranch({ branchId: next.storeId, branchName: activeBranchName(null) });
      } catch {
        /* branch mirroring is best-effort */
      }
      try {
        window.sessionStorage.setItem(TERMINAL_KEY, JSON.stringify(next));
      } catch {
        /* session storage unavailable */
      }
      // Sign the till itself in to the central database (machine account), so
      // shifts, sessions and sales are accepted instead of being refused.
      try {
        const { ensureTerminalSession } = await import("@/lib/terminal-session");
        void ensureTerminalSession();
      } catch {
        /* the server relay still carries the writes */
      }
      return { ok: true };
    },
    [],
  );

  /**
   * End the person's session. `startedAt` is the sign-in generation this
   * teardown belongs to: if somebody has signed in since, the screen is left
   * exactly as it is, so a slow sign-out can never cancel a fresh sign-in.
   *
   * The terminal's own registration and activation are untouched — only the
   * person is signed out. `reason` names the state for the caller.
   */
  const endSession = useCallback(
    async (reason: "logged-out" | "locked" | "expired", startedAt = sessionEpoch()) => {
      if (!isCurrentEpoch(startedAt)) return;
      // Quiesce the UI and every cloud background job before revoking tokens.
      // Otherwise timers can send authenticated work at the same instant the
      // logout request invalidates that session, producing a burst of 401/403s.
      const sessionToken = await loadSessionToken().catch(() => null);
      if (!isCurrentEpoch(startedAt)) return;
      // Stamp the sign-out time on this user's open shift sessions first.
      endShiftSessions({});
      setSessionState(reason === "locked" ? "locked" : reason);
      centralSessionVerifiedRef.current = false;
      setCentralAuthSessionPresent(false);
      setSession(null);
      setRoles([]);
      setAppUser(null);
      setTerminalUser(null);
      try {
        window.sessionStorage.removeItem(TERMINAL_KEY);
      } catch {
        /* ignore */
      }
      clearAutoLockActivity();
      clearStoredCredentials();
      // End the session record so the token stops working everywhere at once.
      try {
        if (sessionToken) await endDeviceSession({ data: { sessionToken } });
      } catch {
        /* offline — the local purge below still applies */
      }
      if (!isCurrentEpoch(startedAt)) return;
      if (reason === "expired") {
        // This JWT was already rejected. Calling /logout with it only creates
        // another expected 401/403 and cannot revoke anything further.
        await discardRejectedExternalAuthSession();
      } else {
        await supabase.auth.signOut({ scope: "local" });
      }
      // Signing out fires an auth change; anything newer than this teardown
      // wins and the rest is skipped.
      if (!isCurrentEpoch(startedAt)) return;
      try {
        await window.sqlAdmin?.lockAdmin?.();
      } catch {
        /* web/Android, or a desktop bridge that is already closing */
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    await endSession("logged-out");
  }, [endSession]);

  /** Idle lock / switch user: the person goes, the till stays registered. */
  const lock = useCallback(async () => {
    await endSession("locked");
  }, [endSession]);

  // Resolved fresh from the staff list so a duty change applies immediately.
  const user = useMemo<PosUser | null>(() => {
    const account = session?.user;
    if (!account) {
      if (!terminalUser) return null;
      // Local bootstrap / offline terminal session.
      // `role` is the stable database level; roleSlug also covers older
      // centrally-managed admin/supervisor role definitions during migration.
      const isLocalAdmin = terminalUser.role === "admin" || terminalUser.roleSlug === "admin";
      const isLocalSupervisor =
        isLocalAdmin || terminalUser.role === "manager" || terminalUser.roleSlug === "supervisor";
      return {
        staffId: terminalUser.userCode,
        name: terminalUser.name,
        email: terminalUser.email,
        role: isLocalAdmin ? "admin" : "cashier",
        metaRole:
          terminalUser.role === "admin"
            ? "admin"
            : terminalUser.role === "manager"
              ? "supervisor"
              : ((terminalUser.roleSlug as MetaRole | null | undefined) ?? "cashier"),
        roles: [terminalUser.role],
        storeId: isLocalAdmin ? null : terminalUser.storeId,
        permissions: isLocalAdmin
          ? FULL_PERMISSIONS
          : isLocalSupervisor
            ? SUPERVISOR_PERMISSIONS
            : normalizePermissions(terminalUser.permissions ?? {}, "cashier"),
      };
    }
    const email = account.email ?? "";
    const meta = account.user_metadata ?? {};
    const metaRole = (meta["role"] as MetaRole | undefined) ?? null;
    const isTrueAdmin =
      roles.includes("admin") ||
      appUser?.role === "admin" ||
      terminalUser?.role === "admin" ||
      terminalUser?.roleSlug === "admin";
    // Supervisors reach the same management screens as admins, but their
    // store scope is their own assignment (null = all stores).
    const isElevated =
      isTrueAdmin ||
      roles.includes("manager") ||
      appUser?.role === "manager" ||
      terminalUser?.role === "manager" ||
      terminalUser?.roleSlug === "supervisor";
    const found = email ? staff.find((s) => s.email && norm(s.email) === norm(email)) : undefined;
    const fallbackName = (meta["full_name"] as string | undefined) || email.split("@")[0] || "User";
    return {
      staffId:
        appUser?.user_id ??
        (meta["user_id"] as string | undefined) ??
        terminalUser?.userCode ??
        found?.staffId ??
        email,
      name: appUser?.full_name ?? terminalUser?.name ?? found?.name ?? fallbackName,
      email,
      role: isTrueAdmin ? "admin" : "cashier",
      metaRole,
      roles,
      storeId: isTrueAdmin
        ? null
        : isElevated
          ? (appUser?.store_id ?? (meta["store_id"] as string | null | undefined) ?? null)
          : (appUser?.store_id ??
            (meta["store_id"] as string | null | undefined) ??
            terminalUser?.storeId ??
            found?.storeId ??
            null),
      permissions: isTrueAdmin
        ? { ...FULL_PERMISSIONS }
        : isElevated
          ? normalizePermissions(appUser?.permissions ?? null, "supervisor")
          : // public.app_users is the source of truth when the account has a row.
            normalizePermissions(
              Object.keys({
                ...(found?.permissions ?? {}),
                ...(appUser?.permissions ?? {}),
              }).length
                ? { ...(found?.permissions ?? {}), ...(appUser?.permissions ?? {}) }
                : null,
              fromDbRole(appUser?.role ?? null),
            ),
    };
  }, [session, roles, staff, terminalUser, appUser]);

  // "Active" is simply the state of having somebody signed in; the other
  // states are set by the teardown that produced them.
  useEffect(() => {
    if (user) setSessionState("active");
  }, [user]);

  useEffect(() => {
    setActivityAudienceIdentity(
      user
        ? {
            userIds: [user.staffId, user.email].filter(Boolean),
            role: user.metaRole ?? user.roles[0] ?? user.role,
            storeId: user.storeId,
            terminalId: readTerminalConfig()?.tokenId ?? null,
            mayViewGeneralActivity:
              user.role === "admin" || user.permissions.can_view_audit_trail === true,
          }
        : null,
    );
    return () => setActivityAudienceIdentity(null);
  }, [user]);

  // Local, per-terminal record of who signed in today. Lets a shift opened by
  // one cashier be continued by another while still showing every user.
  useEffect(() => {
    if (!user) return;
    recordSignIn({
      staffId: user.staffId,
      name: user.name,
      role: user.metaRole ?? user.role,
    });
  }, [user]);

  // The server rejected our token (missing, stale or revoked): end the session
  // here rather than leaving a signed-out screen that still looks signed in.
  // Connectivity problems never reach this listener.
  useEffect(() => {
    return onSessionExpired(() => {
      const startedAt = sessionEpoch();
      void (async () => {
        await endSession("expired", startedAt);
        if (!isCurrentEpoch(startedAt)) return;
        void import("sonner").then(({ toast }) =>
          toast.error("Session ended", {
            id: "pos-session-expired",
            description: "Your session or branch is no longer active. Please sign in again.",
          }),
        );
      })().catch(() => {
        // Best-effort teardown must not become an unhandled browser promise.
      });
    });
  }, [endSession]);

  // An account switched off by a manager must lose the till straight away, not
  // at the next sign-in. Re-checked on a timer and whenever the screen is
  // brought back into view; with no connection the check simply does not run.
  const centralUserId = session?.user?.id ?? null;
  useEffect(() => {
    // A PIN/offline terminal user has no Supabase bearer. Its status is
    // enforced by the signed device session, not by an authenticated-only RPC.
    if (!centralUserId || typeof window === "undefined") return;
    let alive = true;
    const check = async () => {
      if (document.visibilityState === "hidden") return;
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      const startedAt = sessionEpoch();
      try {
        const { data, error } = await supabase.rpc("current_app_user");
        if (!alive || error) return;
        const profile = (Array.isArray(data) ? data[0] : null) as Record<string, unknown> | null;
        if (profile && profile["is_active"] === false) {
          await endSession("expired", startedAt);
          if (!isCurrentEpoch(startedAt)) return;
          void import("sonner").then(({ toast }) =>
            toast.error("Account deactivated", {
              id: "pos-account-deactivated",
              description: "This account has been switched off. Please contact an administrator.",
            }),
          );
        }
      } catch {
        /* advisory only — the row rules still guard every write */
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 60_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [centralUserId, endSession]);

  // Boot / resume check: before the dashboard trusts what it has, ask the
  // server whether this device's token is still live and its branch still
  // exists. Only a definite refusal signs anyone out — offline stays working.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let alive = true;
    let checking = false;
    const check = async () => {
      if (document.visibilityState === "hidden") return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      if (checking) return;
      checking = true;
      try {
        // Supabase normally refreshes in the background. Mobile operating
        // systems suspend timers, so validate explicitly after a foreground
        // resume; a definite token refusal expires the login, while a network
        // or server failure leaves the user's work and session untouched.
        const authCheck = await validateCentralAuthSession(true);
        if (authCheck.state === "verified") {
          centralSessionVerifiedRef.current = true;
        } else if (authCheck.state === "rejected" || !authCheck.session) {
          // A definite refusal (or an absent local session) invalidates the
          // previous proof. An unavailable server with the same stored
          // session does not: connectivity loss must not sign out a till.
          centralSessionVerifiedRef.current = false;
        }
        setCentralAuthSessionPresent(centralSessionVerifiedRef.current);
        const creds = await readCredentials();
        const hasIndependentPosProof = Boolean(
          creds.sessionToken || creds.cashierToken || creds.terminalToken,
        );
        // A cashier PIN login can coexist with a secondary Supabase Auth
        // session. If that browser token expires, keep the proven POS session
        // and let the server validate its revocable device/cashier proof below.
        if (authCheck.state === "rejected" && !hasIndependentPosProof) {
          notifySessionExpired();
          return;
        }
        if (!creds.cashierToken && !creds.terminalToken && !creds.accessToken) return;
        const startedAt = sessionEpoch();
        const { verifySession } = await import("@/lib/session-verify.functions");
        const res = await verifySession({ data: creds });
        if (!alive || res.ok || !isCurrentEpoch(startedAt)) return;
        if (res.reason === "revoked" || res.reason === "branch_missing") {
          notifySessionExpired();
        }
      } catch {
        /* a failed check is a connectivity problem, never a sign-out */
      } finally {
        checking = false;
      }
    };
    void check();
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    window.addEventListener(APP_RESUME_EVENT, onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
      window.removeEventListener(APP_RESUME_EVENT, onVisible);
    };
  }, [user?.staffId]);

  const isWarehouse =
    !!session?.user &&
    !terminalUser?.cashierId &&
    user?.role !== "admin" &&
    (appUser?.role === "staff" ||
      (session.user.user_metadata?.["role"] as string | undefined) === "warehouse");

  // Branch this PC is registered to. A terminal is bound to one store, so
  // whoever signs in here trades in that branch — a staff member assigned
  // elsewhere can no longer pull another branch's data from this till.
  const [terminalStoreId, setTerminalStoreId] = useState<string | null>(null);
  const [terminalStoreName, setTerminalStoreName] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const read = async () => {
      const config = readTerminalConfig() ?? (await hydrateTerminalConfig());
      if (!alive) return;
      // Persist the terminal's branch so every sign-in on this device inherits
      // it, even before the store directory or the user's record arrives.
      bindTerminalBranch(config?.locationId, config?.locationName);
      setTerminalStoreId(config?.locationId?.trim() || null);
      setTerminalStoreName(config?.locationName?.trim() || null);
      markStartupStage("terminal");
    };
    void read();
    return () => {
      alive = false;
    };
  }, [user?.staffId]);

  const ready = authReady && (!userId || (rolesReady && profileReady));

  const value = useMemo<AuthCtx>(
    () => ({
      ready,
      user,
      isAdmin: user?.role === "admin",
      isSupervisor:
        user?.metaRole === "supervisor" ||
        user?.roles.includes("manager") === true ||
        appUser?.role === "manager" ||
        user?.role === "admin",
      terminalStoreId,
      terminalStoreName,
      // A registered till is pinned to its own branch for everyone, including
      // admins. Unbound browsers keep the old rule.
      canSwitchStores:
        !terminalStoreId && !!user && !user.storeId && (user.role === "admin" || isWarehouse),
      isCashier:
        !isWarehouse &&
        !!user &&
        user.role !== "admin" &&
        user.metaRole !== "supervisor" &&
        appUser?.role !== "manager" &&
        !user.roles.includes("manager"),
      isWarehouse,
      authUserId: userId,
      terminalUser,
      appUser,
      can: (flag) => hasPermission(user, flag),
      staff,
      addStaff,
      updateStaff,
      removeStaff,
      login,
      cashierLogin,
      logout,
      lock,
      sessionState,
    }),
    [
      ready,
      user,
      userId,
      terminalStoreId,
      terminalStoreName,
      terminalUser,
      appUser,
      isWarehouse,
      staff,
      addStaff,
      updateStaff,
      removeStaff,
      login,
      cashierLogin,
      logout,
      lock,
      sessionState,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** Non-throwing variant for providers that must degrade instead of crash. */
export function useAuthOptional(): AuthCtx | null {
  return useContext(AuthContext);
}
