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
import { Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TillLoader } from "@/components/shared/TillLoader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth, useAuthOptional } from "@/lib/pos-auth";
import { verifyLocalPin } from "@/core/local-db/local-staff";
import { verifyManagerPin } from "@/lib/pos-rules.functions";
import {
  PERMISSION_LABELS,
  resolvePermission,
  type PermissionFlag,
  type StaffPermissions,
} from "@/lib/permissions";

type Ctx = {
  permissions: StaffPermissions;
  /** app_users row for the signed-in account (via rpc current_app_user). */
  appUser: ReturnType<typeof useAuth>["appUser"];
  role: string | null;
  hasPermission: (flag: PermissionFlag | string) => boolean;
  /**
   * Resolves true when the user already holds the permission, or after a
   * supervisor authorises the action with their User ID + PIN.
   */
  requirePermission: (flag: PermissionFlag | string) => Promise<boolean>;
};

/**
 * One context object per browser session, not per module evaluation. A hot
 * reload (or a second copy of this module in the graph) would otherwise mint a
 * fresh context, so the provider and the consumer would look at different
 * objects and the till would blank with "useUserPermissions must be used
 * inside PermissionsProvider" even though the provider is mounted. Same
 * pattern as the auth and register-store contexts.
 */
const permissionsRegistry = globalThis as typeof globalThis & {
  __posPermissionsContext?: Context<Ctx | null>;
};
const PermissionsContext = (permissionsRegistry.__posPermissionsContext ??=
  createContext<Ctx | null>(null));

/**
 * Degrades gracefully when the auth context is missing (duplicate module
 * instances, a route mounted outside the root provider) instead of throwing
 * and blanking the page.
 */
export function PermissionsProvider({ children }: { children: ReactNode }) {
  const auth = useAuthOptional();
  const [waited, setWaited] = useState(false);

  useEffect(() => {
    if (auth) return;
    const t = setTimeout(() => setWaited(true), 1200);
    return () => clearTimeout(t);
  }, [auth]);

  if (!auth) return waited ? <AuthContextMissing /> : <AuthContextLoading />;
  return <PermissionsInner>{children}</PermissionsInner>;
}

function AuthContextLoading() {
  // Same connection-aware screen the till shows everywhere else, so web,
  // Windows and Android all report the database state identically.
  return <TillLoader message="Starting the till…" />;
}

function AuthContextMissing() {
  const clearAndReload = () => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      /* storage unavailable */
    }
    window.location.reload();
  };
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6 text-center">
        <ShieldAlert className="mx-auto h-8 w-8 text-destructive" />
        <h1 className="text-lg font-semibold">Session context unavailable</h1>
        <p className="text-sm text-muted-foreground">
          The till could not read your sign-in session on this page. Reloading usually fixes it. If
          it keeps happening, clear the local cache and sign in again.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button onClick={() => window.location.reload()}>Reload</Button>
          <Button variant="outline" onClick={clearAndReload}>
            Clear local cache and reload
          </Button>
        </div>
      </div>
    </div>
  );
}

function PermissionsInner({ children }: { children: ReactNode }) {
  const { user, can, appUser } = useAuth();
  const [pending, setPending] = useState<PermissionFlag | null>(null);
  const [userId, setUserId] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const permissions = useMemo(
    () => (user?.permissions ?? {}) as StaffPermissions,
    [user?.permissions],
  );

  const hasPermission = useCallback(
    (flag: PermissionFlag | string) => can(flag as PermissionFlag),
    [can],
  );

  const close = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setPending(null);
    setUserId("");
    setPin("");
    setError("");
  };

  const requirePermission = useCallback(
    (flag: PermissionFlag | string) =>
      new Promise<boolean>((resolve) => {
        if (can(flag as PermissionFlag)) {
          resolve(true);
          return;
        }
        resolver.current = resolve;
        setError("");
        setPending(flag as PermissionFlag);
      }),
    [can],
  );

  const verify = async () => {
    if (!/^\d{4}$/.test(pin)) {
      setError("Enter the supervisor 4-digit PIN");
      return;
    }
    setBusy(true);
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const local = await verifyLocalPin(userId.trim(), pin);
      setBusy(false);
      if (!local.ok || !["admin", "manager"].includes(local.staff.roleSlug)) {
        setError("Invalid supervisor User ID or PIN");
        return;
      }
      close(true);
      return;
    }
    let result: Awaited<ReturnType<typeof verifyManagerPin>> | null = null;
    try {
      result = await verifyManagerPin({
        data: {
          managerId: userId.trim(),
          pin,
          action: "permission_override",
          detail: pending ? `Permission override: ${pending}` : "Permission override",
        },
      });
    } catch {
      // The hosted server is unreachable; the sealed local roster is the
      // outage fallback and still restricts the override to supervisors.
    }
    if (!result || (!result.ok && /reach|network|offline|fetch/i.test(result.error ?? ""))) {
      const local = await verifyLocalPin(userId.trim(), pin);
      setBusy(false);
      if (!local.ok || !["admin", "manager"].includes(local.staff.roleSlug)) {
        setError("Invalid supervisor User ID or PIN");
        return;
      }
      close(true);
      return;
    }
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Invalid supervisor User ID or PIN");
      return;
    }
    close(true);
  };

  const value = useMemo<Ctx>(
    () => ({
      permissions,
      appUser,
      role: appUser?.role ?? null,
      hasPermission,
      requirePermission,
    }),
    [permissions, appUser, hasPermission, requirePermission],
  );

  return (
    <PermissionsContext.Provider value={value}>
      {children}
      <Dialog open={!!pending} onOpenChange={(open) => !open && close(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-4 text-destructive" /> Supervisor override
            </DialogTitle>
            <DialogDescription>
              Your account cannot{" "}
              {pending
                ? PERMISSION_LABELS[resolvePermission(pending)].toLowerCase()
                : "perform this action"}
              . A supervisor can authorise it now.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="ov-id">Supervisor User ID</Label>
              <Input id="ov-id" value={userId} onChange={(e) => setUserId(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ov-pin">PIN</Label>
              <Input
                id="ov-pin"
                type="password"
                inputMode="numeric"
                maxLength={4}
                autoComplete="off"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                onKeyDown={(e) => e.key === "Enter" && void verify()}
              />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button onClick={() => void verify()} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />} Authorise
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PermissionsContext.Provider>
  );
}

export function useUserPermissions() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error("useUserPermissions must be used inside PermissionsProvider");
  return ctx;
}
