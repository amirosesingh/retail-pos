import { StaffIdleTimeout } from "./StaffIdleTimeout";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserX,
} from "lucide-react";
import { toast } from "sonner";
import { branchDisplayName } from "@/lib/human-readable";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { ADMIN_OFFLINE_MESSAGE } from "@/lib/admin-session";
import { isConnectionError } from "@/core/local-db/db-mode";
import { notifyError } from "@/lib/notify";
import {
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  fromDbRole,
  normalizePermissions,
  rolePermissions,
  type PermissionKey,
  type StaffPermissions,
  type StaffRole,
} from "@/lib/permissions";
import { useAuth } from "@/lib/pos-auth";
import { usePos } from "@/lib/pos-store";
import { getRolesWithPermissions, type RoleDef } from "@/lib/role-admin";
import { broadcastSettingsChange, syncNow } from "@/lib/sync-engine";
import { isExternalEmail, isInternalAddress } from "@/lib/internal-domains";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import { setStaffAuthorizationPin } from "@/lib/authorization-client";
import { listManagedStaffAccounts, setManagedStaffPermissions } from "@/lib/staff-admin.functions";
import {
  createStaffMember,
  looksLikeEmail,
  permanentlyDeleteStaffMember,
  toggleStaffStatus,
  updateStaffMember,
} from "@/lib/staff-admin";

type Row = {
  auth_user_id: string | null;
  user_id: string;
  full_name: string;
  role: StaffRole;
  role_slug: string;
  email: string;
  store_id: string | null;
  is_active: boolean;
  permissions: StaffPermissions;
  pin_length: number;
  pin_set_at: string | null;
  last_login_at: string | null;
};

type Form = {
  displayName: string;
  username: string;
  credential: string;
  authorizationPin: string;
  roleSlug: string;
  branchId: string;
  active: boolean;
};

const EMPTY: Form = {
  displayName: "",
  username: "",
  credential: "",
  authorizationPin: "",
  roleSlug: "cashier",
  // Empty until the administrator makes an explicit branch choice.
  branchId: "",
  active: true,
};

const friendlyError = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error ?? "Unexpected error");
  if (raw.includes("DEACTIVATE_ACCOUNT_FIRST"))
    return "Deactivate this account before deleting it.";
  if (raw.includes("CANNOT_DELETE_CURRENT_ACCOUNT"))
    return "You cannot delete the account currently signed in.";
  if (raw.includes("CANNOT_DELETE_LAST_ADMIN"))
    return "The last active administrator cannot be deleted.";
  if (raw.includes("duplicate") || raw.includes("already"))
    return "That username or email is already in use.";
  if (raw.includes("STAFF_NAME_REQUIRED")) return "Display name is required.";
  if (raw.includes("STAFF_ROLE_REQUIRED")) return "Choose a valid role.";
  return raw;
};

/** Generate a PIN with the browser CSPRNG. Rejection avoids modulo bias. */
function generateAuthorizationPin(length = 6): string {
  const digits: number[] = [];
  while (digits.length < length) {
    const bytes = new Uint8Array(length * 2);
    crypto.getRandomValues(bytes);
    for (const value of bytes) {
      if (value < 250) digits.push(value % 10);
      if (digits.length === length) break;
    }
  }
  return digits.join("");
}

/** Wake every till after a centrally-owned staff record changes. */
async function propagateStaffChange(reason: string, tables: string[]) {
  await Promise.all(tables.map((table) => broadcastSettingsChange(table)));
  // Electron has no browser broadcast path; its durable scoped pull is the
  // source of truth and must run before the administration action is done.
  await syncNow(reason);
}

export function StaffManager() {
  const { stores } = usePos();
  const { authUserId } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [form, setForm] = useState<Form>({ ...EMPTY });
  const [editing, setEditing] = useState<Row | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [permissionsFor, setPermissionsFor] = useState<Row | null>(null);
  const [permissionGroupsOpen, setPermissionGroupsOpen] = useState<Set<string>>(
    () => new Set(PERMISSION_GROUPS.map((group) => group.id)),
  );
  const [deleteFor, setDeleteFor] = useState<Row | null>(null);
  const [confirmation, setConfirmation] = useState("");
  // The authorisation PIN is separate from signing in: it only approves a
  // gated action, so administrators and supervisors need one too.
  const [pinFor, setPinFor] = useState<Row | null>(null);
  const [pinValue, setPinValue] = useState("");
  const [showPinValue, setShowPinValue] = useState(false);
  const [showAuthorizationPin, setShowAuthorizationPin] = useState(false);
  const [idleFor, setIdleFor] = useState<Row | null>(null);

  async function saveAuthPin() {
    if (!pinFor || !/^\d{4,6}$/.test(pinValue)) return;
    setBusy("auth-pin");
    try {
      const auth = await getPosCallerAuth();
      const res = await setStaffAuthorizationPin({
        data: { ...auth, userId: pinFor.user_id, pin: pinValue },
      });
      if (!res.ok) toast.error(res.error ?? "Could not save the PIN");
      else {
        await Promise.all([load(), propagateStaffChange("staff approval PIN changed", ["app_users"])]);
        toast.success(`Authorisation PIN set for ${pinFor.full_name}`);
        setPinFor(null);
        setPinValue("");
        setShowPinValue(false);
      }
    } catch (e) {
      notifyError(e, "Could not save the PIN");
    } finally {
      setBusy("");
    }
  }
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [staffResult, roleList] = await Promise.all([
        getPosCallerAuth().then((auth) => listManagedStaffAccounts({ data: auth })),
        getRolesWithPermissions(),
      ]);
      if (!staffResult.ok) throw new Error(staffResult.error);
      setOffline(false);
      setRoles(roleList);
      setRows(
        staffResult.rows.map((r) => {
          const role = fromDbRole(String(r["role"] ?? "staff"));
          return {
            auth_user_id: (r["auth_user_id"] as string | null) ?? null,
            user_id: String(r["user_id"] ?? ""),
            full_name: String(r["full_name"] ?? ""),
            role,
            role_slug: String(r["role_slug"] ?? role),
            email: String(r["email"] ?? ""),
            store_id: (r["store_id"] as string | null) ?? null,
            is_active: r["is_active"] !== false,
            permissions: normalizePermissions(
              r["permissions"] as Record<string, unknown> | null,
              role,
            ),
            pin_length: Number(r["pin_length"] ?? 0),
            pin_set_at: (r["pin_set_at"] as string | null) ?? null,
            last_login_at: (r["last_login_at"] as string | null) ?? null,
          };
        }),
      );
    } catch (error) {
      // Staff accounts are central by design: say the line is down rather
      // than throwing a red failure at the administrator.
      if (isConnectionError(error)) {
        setOffline(true);
        setRows([]);
        return;
      }
      notifyError(error, "Could not load staff accounts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) =>
      `${row.full_name} ${row.user_id} ${row.email} ${row.role_slug}`
        .toLowerCase()
        .includes(needle),
    );
  }, [query, rows]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY });
    setShowAuthorizationPin(false);
    setFormOpen(true);
  };

  const openEdit = (row: Row) => {
    setEditing(row);
    setForm({
      displayName: row.full_name,
      username: row.user_id,
      credential: "",
      authorizationPin: "",
      roleSlug: row.role_slug,
      branchId: row.store_id ?? "all",
      active: row.is_active,
    });
    setFormOpen(true);
  };

  const selectedRole = roles.find((role) => role.slug === form.roleSlug);
  const emailMode = editing ? isExternalEmail(editing.email) : looksLikeEmail(form.username);
  const nameValid = form.displayName.trim().length > 0;
  const identifierValid = emailMode
    ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.username.trim())
    : /^[a-z0-9._-]{2,40}$/.test(form.username.trim().toLowerCase());
  const credentialValid =
    editing && !form.credential
      ? true
      : emailMode
        ? form.credential.length >= 8
        : form.credential.length >= 4 && form.credential.length <= 32;
  // The branch must be an explicit decision: a real branch, or "all".
  const branchValid = form.branchId === "all" || stores.some((store) => store.id === form.branchId);
  const branchId = form.branchId === "all" ? null : form.branchId;
  const branchLabel = branchId ? branchDisplayName(stores, branchId) : "All branches";
  const authorizationPinValid = editing ? true : /^\d{4,6}$/.test(form.authorizationPin);
  const canSave =
    nameValid &&
    identifierValid &&
    credentialValid &&
    authorizationPinValid &&
    branchValid &&
    !!selectedRole;

  const save = async () => {
    if (!canSave || !selectedRole) return;
    setBusy("save");
    try {
      if (editing) {
        await updateStaffMember({
          username: editing.user_id,
          displayName: form.displayName.trim(),
          branchId,
          roleSlug: selectedRole.slug,
          baseRole: selectedRole.baseLevel,
          active: form.active,
          ...(form.credential ? { credential: form.credential } : {}),
        });
        if (editing.role_slug !== selectedRole.slug) {
          const permissions = selectedRole.permissions ?? rolePermissions(selectedRole.baseLevel);
          const permissionResult = await setManagedStaffPermissions({
            data: {
              ...(await getPosCallerAuth()),
              userId: editing.user_id,
              permissions,
            },
          });
          if (!permissionResult.ok) throw new Error(permissionResult.error);
        }
        toast.success(`${form.displayName.trim()} saved — ${branchLabel}`);
      } else {
        await createStaffMember({
          displayName: form.displayName.trim(),
          username: form.username.trim().toLowerCase(),
          ...(emailMode ? { password: form.credential } : { pin: form.credential }),
          authorizationPin: form.authorizationPin,
          branchId,
          roleSlug: selectedRole.slug,
          baseRole: selectedRole.baseLevel,
          permissions: selectedRole.permissions,
          active: form.active,
        });
        toast.success(`${form.displayName.trim()} created — ${branchLabel}`);
      }
      setFormOpen(false);
      setForm({ ...EMPTY });
      await Promise.all([
        load(),
        propagateStaffChange("staff account saved", ["app_users", "cashiers", "user_roles"]),
      ]);
    } catch (error) {
      // Lead with the real reason; the generic wording hid every cause.
      toast.error(friendlyError(error), {
        description: editing ? "The account was not updated." : "The account was not created.",
      });
    } finally {
      setBusy("");
    }
  };

  const setActive = async (row: Row, active: boolean) => {
    setBusy(row.user_id);
    try {
      await toggleStaffStatus(row.user_id, active);
      toast.success(active ? "Account activated" : "Account deactivated");
      await Promise.all([
        load(),
        propagateStaffChange("staff account status changed", ["app_users", "cashiers"]),
      ]);
    } catch (error) {
      toast.error("Account status could not be changed", { description: friendlyError(error) });
    } finally {
      setBusy("");
    }
  };

  const savePermissions = async () => {
    if (!permissionsFor) return;
    setBusy("permissions");
    try {
      const result = await setManagedStaffPermissions({
        data: {
          ...(await getPosCallerAuth()),
          userId: permissionsFor.user_id,
          permissions: permissionsFor.permissions,
        },
      });
      if (!result.ok) {
        // Permissions live centrally only; queueing them offline would let two
        // tills disagree about who may do what, so the change is refused.
        if (isConnectionError(new Error(result.error))) {
          setOffline(true);
          toast.error(ADMIN_OFFLINE_MESSAGE);
          return;
        }
        notifyError(new Error(result.error), "Could not save permissions");
        return;
      }
      await propagateStaffChange("staff permissions changed", ["app_users"]);
      setRows((current) =>
        current.map((row) => (row.user_id === permissionsFor.user_id ? permissionsFor : row)),
      );
      setPermissionsFor(null);
      toast.success("Permissions updated");
    } catch (error) {
      if (isConnectionError(error)) {
        setOffline(true);
        toast.error(ADMIN_OFFLINE_MESSAGE);
      } else {
        notifyError(error, "Could not save permissions");
      }
    } finally {
      setBusy("");
    }
  };

  const remove = async () => {
    if (!deleteFor || confirmation !== deleteFor.user_id) return;
    setBusy("delete");
    try {
      await permanentlyDeleteStaffMember(deleteFor.user_id);
      toast.success("Inactive account permanently deleted");
      setDeleteFor(null);
      setConfirmation("");
      await Promise.all([
        load(),
        propagateStaffChange("staff account deleted", ["app_users", "cashiers", "user_roles"]),
      ]);
    } catch (error) {
      toast.error("Account could not be deleted", { description: friendlyError(error) });
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Accounts</h2>
          <p className="text-xs text-muted-foreground">
            Create, edit, deactivate and manage every staff sign-in.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}{" "}
            Refresh
          </Button>
          <Button size="sm" onClick={openCreate} disabled={offline}>
            <Plus className="size-4" /> New account
          </Button>
        </div>
      </header>
      {offline && (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Connection is down. Staff accounts are held centrally, so they can only be viewed and
          changed once the line is back — nothing is queued for later.
        </p>
      )}
      <Separator />
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search name, username, email or role"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-2">Staff</th>
              <th>Sign-in</th>
              <th>Role</th>
              <th>Branch</th>
              <th>Last login</th>
              <th>Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const terminal = isInternalAddress(row.email);
              return (
                <tr key={row.user_id} className="border-b border-border/60">
                  <td className="py-3 pr-3">
                    <p className="font-medium">{row.full_name}</p>
                    <p className="text-xs text-muted-foreground">{row.user_id}</p>
                  </td>
                  <td className="pr-3">
                    <Badge variant="outline">
                      {terminal ? "Terminal PIN sign-in" : "Email & password"}
                    </Badge>
                    <p className={row.pin_set_at ? "mt-1 text-xs text-muted-foreground" : "mt-1 text-xs text-destructive"}>
                      {row.pin_set_at
                        ? `Approval PIN · ${row.pin_length || 6} digits`
                        : "Approval PIN not set"}
                    </p>
                  </td>
                  <td className="pr-3">
                    {roles.find((role) => role.slug === row.role_slug)?.name ?? row.role_slug}
                  </td>
                  <td className="pr-3">
                    {stores.find((store) => store.id === row.store_id)?.name ?? "All branches"}
                  </td>
                  <td className="pr-3 text-xs text-muted-foreground">
                    {row.last_login_at ? new Date(row.last_login_at).toLocaleString() : "Never"}
                  </td>
                  <td className="pr-3">
                    <Switch
                      checked={row.is_active}
                      disabled={busy === row.user_id || row.auth_user_id === authUserId}
                      onCheckedChange={(active) => void setActive(row, active)}
                      aria-label={`${row.full_name} active`}
                    />
                  </td>
                  <td>
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={offline}
                        onClick={() => setIdleFor(row)}
                      >
                        Idle limit
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Edit account"
                        disabled={offline}
                        onClick={() => openEdit(row)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Set authorisation PIN"
                        disabled={offline}
                        onClick={() => {
                          setPinFor(row);
                          setPinValue("");
                          setShowPinValue(false);
                        }}
                      >
                        <ShieldCheck className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Edit permissions"
                        disabled={offline}
                        onClick={() => {
                          setPermissionGroupsOpen(new Set(PERMISSION_GROUPS.map((g) => g.id)));
                          setPermissionsFor({ ...row, permissions: { ...row.permissions } });
                        }}
                      >
                        <KeyRound className="size-4" />
                      </Button>
                      {!row.is_active && (
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Delete inactive account"
                          disabled={offline || row.auth_user_id === authUserId}
                          onClick={() => {
                            setDeleteFor(row);
                            setConfirmation("");
                          }}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-muted-foreground">
                  No matching staff accounts.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {idleFor && (
        <StaffIdleTimeout
          person={{ key: idleFor.user_id, name: idleFor.full_name, kind: "account" }}
          onClose={() => setIdleFor(null)}
        />
      )}
      <Dialog
        open={!!pinFor}
        onOpenChange={(open) => {
          if (!open) {
            setPinFor(null);
            setPinValue("");
            setShowPinValue(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Authorisation PIN</DialogTitle>
            <DialogDescription>
              A 4–6 digit PIN for {pinFor?.full_name}, used only to approve gated actions at a till.
              It does not change how they sign in, and it is never shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              autoFocus
              inputMode="numeric"
              type={showPinValue ? "text" : "password"}
              maxLength={6}
              value={pinValue}
              onChange={(e) => setPinValue(e.target.value.replace(/\D/g, "").slice(0, 6))}
              aria-label="New authorisation PIN"
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label={showPinValue ? "Hide authorisation PIN" : "Show authorisation PIN"}
              onClick={() => setShowPinValue((value) => !value)}
            >
              {showPinValue ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>
            <Button type="button" variant="outline" onClick={() => setPinValue(generateAuthorizationPin(6))}>
              Generate
            </Button>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPinFor(null);
                setPinValue("");
                setShowPinValue(false);
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={!/^\d{4,6}$/.test(pinValue) || busy === "auth-pin"}
              onClick={() => void saveAuthPin()}
            >
              {busy === "auth-pin" && <Loader2 className="size-4 animate-spin" />}Save PIN
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          if (!busy) setFormOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit account" : "Create account"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update profile, access and credentials. Leave the credential blank to keep it unchanged."
                : "Use a username for terminal PIN sign-in or a real email for password sign-in."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="staff-name">Display name *</Label>
              <Input
                id="staff-name"
                maxLength={120}
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                aria-invalid={!nameValid}
              />
              {!nameValid && <p className="text-xs text-destructive">Display name is required.</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="staff-identifier">Username or email *</Label>
              <Input
                id="staff-identifier"
                disabled={!!editing}
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value.replace(/\s+/g, "") })}
                aria-invalid={!identifierValid}
              />
              {!identifierValid && (
                <p className="text-xs text-destructive">Enter a valid username or email.</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="staff-credential">
                {emailMode ? "Password" : "PIN or passcode (4–32)"}
                {editing ? "" : " *"}
              </Label>
              <Input
                id="staff-credential"
                type="password"
                maxLength={emailMode ? 200 : 32}
                autoComplete="new-password"
                value={form.credential}
                onChange={(e) =>
                  setForm({
                    ...form,
                    credential: emailMode ? e.target.value : e.target.value.slice(0, 32),
                  })
                }
                aria-invalid={!credentialValid}
              />
              {!credentialValid && (
                <p className="text-xs text-destructive">
                  {emailMode ? "Use at least 8 characters." : "Use 4 to 32 characters."}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Role *</Label>
              <Select
                value={form.roleSlug}
                onValueChange={(roleSlug) => setForm({ ...form, roleSlug })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.slug} value={role.slug}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!editing ? (
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="staff-authorization-pin">Authorisation PIN *</Label>
                <div className="flex gap-2">
                  <Input
                    id="staff-authorization-pin"
                    type={showAuthorizationPin ? "text" : "password"}
                    inputMode="numeric"
                    maxLength={6}
                    autoComplete="new-password"
                    value={form.authorizationPin}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        authorizationPin: e.target.value.replace(/\D/g, "").slice(0, 6),
                      })
                    }
                    aria-invalid={!authorizationPinValid}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    aria-label={showAuthorizationPin ? "Hide generated PIN" : "Show generated PIN"}
                    onClick={() => setShowAuthorizationPin((value) => !value)}
                  >
                    {showAuthorizationPin ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setForm({ ...form, authorizationPin: generateAuthorizationPin(6) })
                    }
                  >
                    Generate 6-digit PIN
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Used only to approve governed actions. It is hashed and will not be shown again.
                </p>
                {!authorizationPinValid ? (
                  <p className="text-xs text-destructive">Use a 4 to 6 digit PIN.</p>
                ) : null}
              </div>
            ) : null}
            <div className="space-y-1">
              <Label>Branch *</Label>
              <Select
                value={form.branchId}
                onValueChange={(branchId) => setForm({ ...form, branchId })}
              >
                <SelectTrigger aria-invalid={!branchValid}>
                  <SelectValue placeholder="Select a branch" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All branches — terminal decides</SelectItem>
                  {stores.map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.code} · {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {branchValid ? (
                <p className="text-xs text-muted-foreground">
                  Pick “All branches” for staff who work at any till; every sale is still stamped
                  with the terminal’s branch.
                </p>
              ) : (
                <p className="text-xs text-destructive">Choose a branch, or “All branches”.</p>
              )}
            </div>
            <label className="flex items-center justify-between rounded-md border border-border p-3 text-sm sm:col-span-2">
              Active immediately
              <Switch
                checked={form.active}
                onCheckedChange={(active) => setForm({ ...form, active })}
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={busy === "save"}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={!canSave || busy === "save"}>
              {busy === "save" && <Loader2 className="size-4 animate-spin" />}
              {editing ? "Save changes" : "Create account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!permissionsFor}
        onOpenChange={(open) => {
          if (!open && busy !== "permissions") setPermissionsFor(null);
        }}
      >
        <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Permissions · {permissionsFor?.full_name}</DialogTitle>
            <DialogDescription>
              Changes apply to this account only. Administrators always retain full access.
            </DialogDescription>
          </DialogHeader>
          {permissionsFor && (
            <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted/30 p-3">
              <label className="min-w-56 flex-1 space-y-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Copy permissions from another account
                </span>
                <Select
                  onValueChange={(userId) => {
                    const source = rows.find((row) => row.user_id === userId);
                    if (!source) return;
                    setPermissionsFor({
                      ...permissionsFor,
                      permissions: { ...source.permissions },
                    });
                    toast.success(`Copied permissions from ${source.full_name}. Save to apply.`);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose staff account" />
                  </SelectTrigger>
                  <SelectContent>
                    {rows
                      .filter((row) => row.user_id !== permissionsFor.user_id)
                      .map((row) => (
                        <SelectItem key={row.user_id} value={row.user_id}>
                          {row.full_name} · {row.role_slug}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </label>
              <Copy className="mb-2 size-4 text-muted-foreground" aria-hidden="true" />
              <Button
                size="icon"
                variant="ghost"
                className="bg-transparent shadow-none"
                aria-label={
                  permissionGroupsOpen.size === PERMISSION_GROUPS.length
                    ? "Collapse all permission groups"
                    : "Expand all permission groups"
                }
                title={
                  permissionGroupsOpen.size === PERMISSION_GROUPS.length
                    ? "Collapse all"
                    : "Expand all"
                }
                onClick={() =>
                  setPermissionGroupsOpen((current) =>
                    current.size === PERMISSION_GROUPS.length
                      ? new Set()
                      : new Set(PERMISSION_GROUPS.map((group) => group.id)),
                  )
                }
              >
                {permissionGroupsOpen.size === PERMISSION_GROUPS.length ? (
                  <Minimize2 className="size-4" />
                ) : (
                  <Maximize2 className="size-4" />
                )}
              </Button>
            </div>
          )}
          <div className="space-y-3">
            {permissionsFor &&
              PERMISSION_GROUPS.map((group) => {
                const open = permissionGroupsOpen.has(group.id);
                return (
                  <section key={group.id} className="rounded-md border border-border">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold"
                      aria-expanded={open}
                      onClick={() =>
                        setPermissionGroupsOpen((current) => {
                          const next = new Set(current);
                          if (open) next.delete(group.id);
                          else next.add(group.id);
                          return next;
                        })
                      }
                    >
                      <span>{group.label}</span>
                      {open ? (
                        <ChevronDown className="size-4" />
                      ) : (
                        <ChevronRight className="size-4" />
                      )}
                    </button>
                    {open && (
                      <div className="grid gap-2 border-t border-border p-3 sm:grid-cols-2">
                        {group.keys.map((key) => (
                          <label key={key} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={
                                permissionsFor.role === "admin" ||
                                permissionsFor.permissions[key as PermissionKey]
                              }
                              disabled={permissionsFor.role === "admin"}
                              onCheckedChange={(checked) =>
                                setPermissionsFor({
                                  ...permissionsFor,
                                  permissions: {
                                    ...permissionsFor.permissions,
                                    [key]: checked === true,
                                  },
                                })
                              }
                            />
                            <span>{PERMISSION_LABELS[key as PermissionKey]}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPermissionsFor(null)}>
              Cancel
            </Button>
            <Button onClick={() => void savePermissions()} disabled={busy === "permissions"}>
              {busy === "permissions" && <Loader2 className="size-4 animate-spin" />}Save
              permissions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteFor}
        onOpenChange={(open) => {
          if (!open && busy !== "delete") setDeleteFor(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Permanently delete account?</DialogTitle>
            <DialogDescription>
              This inactive account and its login identity will be removed. Sales and audit history
              keep their recorded staff name.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="delete-confirm">
              Type <span className="font-mono font-semibold">{deleteFor?.user_id}</span> to confirm
            </Label>
            <Input
              id="delete-confirm"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteFor(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void remove()}
              disabled={!deleteFor || confirmation !== deleteFor.user_id || busy === "delete"}
            >
              {busy === "delete" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <UserX className="size-4" />
              )}
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
