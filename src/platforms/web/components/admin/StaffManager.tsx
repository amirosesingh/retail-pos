import { resendStaffConfirmation } from "@/lib/staff-admin-client";
import { HelpTip } from "@/components/ui/help-tip";
import { formatDateTime as posDisplayDateTime } from "@/lib/time-zone";
import { withReadDeadline } from "@/lib/read-retry";
import { notifyError } from "@/lib/notify";
import { NativeApprovalMethods } from "@/platform-config/approval-methods";
import { nativeApprovalCredentials } from "@/platform-config/approval-token";
import { approvalMethods } from "@/lib/approval-credentials";
import { PERMISSION_EDITOR_IDS } from "@/lib/permission-editor";
import { PermissionHierarchy } from "./PermissionHierarchy";
import { StaffIdleTimeout } from "./StaffIdleTimeout";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
import {
  fromDbRole,
  normalizePermissions,
  rolePermissions,
  type StaffPermissions,
  type StaffRole,
} from "@/lib/permissions";
import { useAuth } from "@/lib/pos-auth";
import { usePos } from "@/lib/pos-store";
import { getRolesWithPermissions, type RoleDef } from "@/lib/role-admin";
import { broadcastSettingsChange, subscribeDataChange, syncNow } from "@/lib/sync-engine";
import { isExternalEmail, isInternalAddress } from "@/lib/internal-domains";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import { setStaffAuthorizationPin } from "@/lib/authorization-client";
import { listManagedStaffAccounts, setManagedStaffPermissions } from "@/lib/staff-admin-client";
import {
  createStaffMember,
  looksLikeEmail,
  permanentlyDeleteStaffMember,
  updateStaffMember,
} from "@/lib/staff-admin";

type Row = {
  auth_user_id: string | null;
  user_id: string;
  login_username: string | null;
  full_name: string;
  role: StaffRole;
  role_slug: string;
  email_confirmed?: boolean | null;
  email: string;
  store_id: string | null;
  is_active: boolean;
  permissions: StaffPermissions;
  pin_length: number;
  pin_set_at: string | null;
  approval_pin_eligible: boolean;
  approval_pin_enabled: boolean;
  approval_totp_enabled: boolean;
  last_login_at: string | null;
};

type Form = {
  displayName: string;
  username: string;
  email: string;
  credential: string;
  confirmCredential: string;

  roleSlug: string;
  branchId: string;
  active: boolean;
};

const EMPTY: Form = {
  displayName: "",
  username: "",
  email: "",
  credential: "",
      confirmCredential: "",

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
  const result = await syncNow(reason);
  if (!result.ok) {
    toast.warning("Saved centrally; the local database will retry synchronization", {
      description: result.error,
    });
  }
  return result;
}

export function StaffManager() {
  const { stores } = usePos();
  const { authUserId, isAdmin } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [sendingConfirmation, setSendingConfirmation] = useState<string | null>(null);
  const confirmationPending = useRef(false);
  const [form, setForm] = useState<Form>({ ...EMPTY });
  const [editing, setEditing] = useState<Row | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [permissionSearch, setPermissionSearch] = useState("");
  const [permissionsFor, setPermissionsFor] = useState<Row | null>(null);
  const [permissionGroupsOpen, setPermissionGroupsOpen] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [deleteFor, setDeleteFor] = useState<Row | null>(null);
  const [confirmation, setConfirmation] = useState("");
  // The authorisation PIN is separate from signing in: it only approves a
  // gated action, so administrators and supervisors need one too.
  const [pinFor, setPinFor] = useState<Row | null>(null);
  const [pinPurpose, setPinPurpose] = useState<"approval" | "offline_login">("approval");
  const [pinValue, setPinValue] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [showPinValue, setShowPinValue] = useState(false);


  async function saveAuthPin() {
    if (!isAdmin || !pinFor?.is_active || !/^\d{4,6}$/.test(pinValue) || pinValue !== confirmPin) return;
    setBusy("auth-pin");
    try {
      const auth = await getPosCallerAuth();
      const res = await setStaffAuthorizationPin({
        data: { ...auth, userId: pinFor.user_id, pin: pinValue, purpose: pinPurpose },
      });
      if (!res.ok) toast.error(res.error ?? "Could not save the PIN");
      else {
        await Promise.all([
          load(),
          propagateStaffChange("staff approval PIN changed", ["app_users"]),
        ]);
        toast.success(`${pinPurpose === "offline_login" ? "Offline sign-in PIN" : "Authorisation PIN"} set for ${pinFor.full_name}`);
        setPinFor(null);
        setPinValue(""); setConfirmPin("");
        setShowPinValue(false);
      }
    } catch (e) {
      notifyError(e, "Could not save the PIN");
    } finally {
      setBusy("");
    }
  }
  const loadPromise = useRef<Promise<void> | null>(null);
  const [loadError, setLoadError] = useState("");
  const [offline, setOffline] = useState(false);

  const load = useCallback(function loadStaffAccounts(force = false): Promise<void> {
    if (loadPromise.current) {
      // A pre-save background read must not overwrite the newly saved status.
      return force ? loadPromise.current.then(() => loadStaffAccounts(true)) : loadPromise.current;
    }
    loadPromise.current = (async () => {
    setLoading(true);
    try {
      const [staffResult, roleList] = await withReadDeadline(() => Promise.all([
        getPosCallerAuth().then((auth) => listManagedStaffAccounts({ data: auth })),
        getRolesWithPermissions(),
      ]));
      if (!staffResult.ok) throw new Error(staffResult.error);
      setOffline(false);
      setLoadError("");
      setRoles(roleList);
      setRows(
        staffResult.rows.map((r) => {
          const role = fromDbRole(String(r["role"] ?? "staff"));
          return {
            auth_user_id: (r["auth_user_id"] as string | null) ?? null,
            user_id: String(r["user_id"] ?? ""),
            login_username: r.login_username ?? null,
            full_name: String(r["full_name"] ?? ""),
            role,
            role_slug: String(r["role_slug"] ?? role),
            email: String(r["email"] ?? ""),
            email_confirmed: typeof r["email_confirmed"] === "boolean" ? r["email_confirmed"] : null,
            store_id: (r["store_id"] as string | null) ?? null,
            is_active: r["is_active"] !== false,
            permissions: normalizePermissions(
              r["permissions"] as Record<string, unknown> | null,
              role,
            ),
            pin_length: Number(r["pin_length"] ?? 0),
            pin_set_at: (r["pin_set_at"] as string | null) ?? null,
            approval_pin_eligible: r.approval_pin_eligible === true,
            approval_pin_enabled: nativeApprovalCredentials ? approvalMethods(r.permissions).pin : true,
            approval_totp_enabled: nativeApprovalCredentials ? approvalMethods(r.permissions).totp : false,
            last_login_at: (r["last_login_at"] as string | null) ?? null,
          };
        }),
      );
    } catch (error) {
      // Staff accounts are central by design: say the line is down rather
      // than throwing a red failure at the administrator.
      if (isConnectionError(error)) {
        setOffline(true);
        setLoadError("Could not reach the staff service. Please retry.");
        return;
      }
      setLoadError(friendlyError(error));
    } finally {
      setLoading(false);
    }
    })().finally(() => { loadPromise.current = null; });
    return loadPromise.current;
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = subscribeDataChange((change) => {
      if (!["app_users", "cashiers", "staff_roles", "user_roles"].includes(change.table)) return;
      clearTimeout(timer);
      timer = setTimeout(() => { void load(); }, 300);
    });
    return () => { off(); clearTimeout(timer); };
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) =>
      `${row.full_name} ${row.login_username ?? row.user_id} ${row.email} ${row.role_slug}`
        .toLowerCase()
        .includes(needle),
    );
  }, [query, rows]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY });
    setFormOpen(true);
  };

  const openEdit = (row: Row) => {
    setEditing(row);
    setForm({
      displayName: row.full_name,
      username: row.login_username || row.user_id,
      email: isExternalEmail(row.email) ? row.email : "",
      credential: "",
      confirmCredential: "",

      roleSlug: row.role_slug,
      branchId: row.store_id ?? "all",
      active: row.is_active,
    });
    setFormOpen(true);
  };

  const selectedRole = roles.find((role) => role.slug === form.roleSlug);
  const emailMode = editing ? !!form.email.trim() : looksLikeEmail(form.username);
  const nameValid = form.displayName.trim().length > 0;
  const identifierValid = editing
    ? (form.username === (editing.login_username || editing.user_id) || /^[a-z0-9._-]{2,40}$/.test(form.username.trim().toLowerCase()))
    : emailMode
    ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.username.trim())
    : /^[a-z0-9._-]{2,40}$/.test(form.username.trim().toLowerCase());
  const emailValid = !editing || (!form.email.trim() ? !isExternalEmail(editing.email) : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()));
  const needsEmailPassword = !!editing && !isExternalEmail(editing.email) && emailMode;
  const credentialValid =
    editing && !form.credential && !needsEmailPassword
      ? true
      : emailMode
        ? form.credential.length >= 8
        : form.credential.length >= 4 && form.credential.length <= 32;
  // The branch must be an explicit decision: a real branch, or "all".
  const branchValid = form.branchId === "all" || stores.some((store) => store.id === form.branchId);
  const branchId = form.branchId === "all" ? null : form.branchId;
  const branchLabel = branchId ? branchDisplayName(stores, branchId) : "All branches";

  const credentialMatches = form.credential === form.confirmCredential;
  const canSave = credentialMatches && nameValid && identifierValid && emailValid && credentialValid && branchValid && !!selectedRole;

  const save = async () => {
    if (!canSave || !selectedRole) return;
    setBusy("save");
    try {
      if (editing) {
        await updateStaffMember({
          username: editing.user_id,
          loginUsername: form.username.trim().toLowerCase(),
          email: form.email.trim().toLowerCase(),
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
        const result = await createStaffMember({
          displayName: form.displayName.trim(),
          username: form.username.trim().toLowerCase(),
          ...(emailMode ? { password: form.credential } : { pin: form.credential }),

          branchId,
          roleSlug: selectedRole.slug,
          baseRole: selectedRole.baseLevel,
          permissions: selectedRole.permissions,
          active: form.active,
        });
        toast.success(`${form.displayName.trim()} created — ${branchLabel}`);
        if (result.emailWarning) toast.warning(result.emailWarning);
      }
      setFormOpen(false);
      setForm({ ...EMPTY });
      await Promise.all([
        load(true),
        propagateStaffChange("staff account saved", ["app_users", "cashiers", "user_roles"]),
      ]);
    } catch (error) {
      // Lead with the real reason; the generic wording hid every cause.
      toast.error(friendlyError(error), {
        description: editing ? "Review the error before retrying the account change." : "The account was not created.",
      });
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
      {loadError && !offline && <p role="alert" className="rounded-lg border border-destructive/30 px-3 py-2 text-xs text-destructive">{loadError}</p>}
      <Separator />
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search name, username, email or role"
          aria-label="Search staff accounts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="block w-full text-sm sm:table">
          <thead className="hidden sm:table-header-group">
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-2">Staff</th>
              <th>Sign-in</th>
              <th>Last login</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="grid gap-3 sm:table-row-group">
            {filtered.map((row) => {
              const terminal = isInternalAddress(row.email);
              return (
                <tr key={row.user_id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 rounded-lg border border-border/60 p-3 sm:table-row sm:rounded-none sm:border-x-0 sm:border-t-0 sm:p-0">
                  <td className="col-start-1 min-w-0 sm:table-cell sm:py-3 sm:pr-3">
                    <div className="flex flex-wrap items-center gap-1.5"><p className="break-words font-medium">{row.full_name}</p>{!row.is_active && <Badge variant="outline" className="px-1.5 py-0 text-[10px] leading-4 text-muted-foreground">Disabled</Badge>}</div>
                    <p className="text-xs text-muted-foreground">{row.login_username || row.user_id}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge variant="secondary" className="px-1.5 py-0 text-[10px] leading-4">{roles.find((role) => role.slug === row.role_slug)?.name ?? row.role_slug}</Badge>
                      <Badge variant="outline" className="px-1.5 py-0 text-[10px] leading-4">{row.store_id ? stores.find((store) => store.id === row.store_id)?.name ?? "Assigned branch" : "All branches"}</Badge>
                    </div>
                  </td>
                  <td className="col-start-1 min-w-0 sm:table-cell sm:pr-3">
                    <Badge variant="outline" className="px-1.5 py-0 text-[10px] leading-4">
                      {terminal ? "Terminal PIN sign-in" : "Email & password"}
                    </Badge>
                    {!terminal && row.email_confirmed === false && (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Awaiting email verification
                        <Button variant="link" size="sm" className="h-auto px-1 py-0 text-[11px]" disabled={offline || sendingConfirmation !== null}
                          onClick={async () => {
                            if (confirmationPending.current) return;
                            confirmationPending.current = true;
                            setSendingConfirmation(row.user_id);
                            try {
                              const result = await resendStaffConfirmation({ data: { ...(await getPosCallerAuth()), username: row.user_id } });
                              if (!result.ok) throw new Error(result.error);
                              toast.success("Verification email requested");
                            } catch (error) { toast.error(friendlyError(error)); }
                            finally { confirmationPending.current = false; setSendingConfirmation(null); }
                          }}>Resend</Button>
                      </div>
                    )}
                  </td>

                  <td className="col-start-1 min-w-0 text-[11px] text-muted-foreground sm:table-cell sm:pr-3"><span className="block text-[10px] sm:hidden">Last login</span>
                    {row.last_login_at ? posDisplayDateTime(new Date(row.last_login_at)) : "Not recorded"}
                  </td>
                  <td className="col-start-2 row-start-1 row-end-4 self-start sm:table-cell">
                    <div className="flex flex-col items-center gap-1 sm:flex-row sm:justify-end">
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Edit account"
                        aria-label={`Edit ${row.full_name}`}
                        disabled={offline}
                        onClick={() => openEdit(row)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={nativeApprovalCredentials ? "Approval credentials" : "Approval PIN"}
                          title={!isAdmin ? "Only administrators can set approval PINs" : !row.is_active ? "Activate this account first" : nativeApprovalCredentials ? "Configure approval credentials" : "Set authorisation PIN"}
                          disabled={offline || !isAdmin || !row.is_active}
                          onClick={() => {
                            setPinPurpose("approval");
                            setPinFor(row);
                            setPinValue(""); setConfirmPin("");
                            setShowPinValue(false);
                          }}
                        >
                          <ShieldCheck className="size-4" />
                        </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Edit permissions"
                        aria-label={`Permissions for ${row.full_name}`}
                        disabled={offline}
                        onClick={() => {
                          setPermissionGroupsOpen(new Set());
                          setPermissionSearch("");
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
                          aria-label={`Delete ${row.full_name}`}
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
                <td colSpan={4} className="py-8 text-center text-muted-foreground">
                  No matching staff accounts.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>


      <Dialog
        open={!!pinFor}
        onOpenChange={(open) => {
          if (!open) {
            setPinFor(null);
            setPinValue(""); setConfirmPin("");
            setShowPinValue(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{pinPurpose === "offline_login" ? "Windows offline sign-in PIN" : "Approval PIN"}</DialogTitle>
            <DialogDescription>
              {pinPurpose === "offline_login" ? "A separate 6-digit Windows sign-in PIN. Connect and sync the PC before using it offline. Their email password and approval PIN stay unchanged." : "A separate 4–6 digit approval PIN. It does not change sign-in. Approval still requires the appropriate rule, permission and branch access."}
            </DialogDescription>
          </DialogHeader>
          {pinFor && isExternalEmail(pinFor.email) && <label className="space-y-1 text-xs">PIN purpose<select className="h-9 w-full rounded-md border bg-background px-2" aria-label="PIN purpose" value={pinPurpose} onChange={event => { setPinPurpose(event.target.value as "approval" | "offline_login"); setPinValue(""); setConfirmPin(""); }}><option value="approval">Approval PIN</option><option value="offline_login">Windows offline sign-in PIN</option></select></label>}
          {pinPurpose === "approval" && nativeApprovalCredentials && <NativeApprovalMethods person={pinFor} disabled={offline} onUpdated={(userId, patch) => {
            setPinFor(current => current?.user_id === userId ? { ...current, ...patch } : current);
            setRows(current => current.map(row => row.user_id === userId ? { ...row, ...patch } : row));
          }} />}
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
            <Button
              type="button"
              variant="outline"
              onClick={() => setPinValue(generateAuthorizationPin(6))}
            >
              Generate
            </Button>
          </div>
          <div className="space-y-1">
            <Label htmlFor="confirm-approval-pin">Confirm authorisation PIN</Label>
            <Input id="confirm-approval-pin" type="password" inputMode="numeric" maxLength={6}
              autoComplete="new-password" value={confirmPin}
              onChange={event => setConfirmPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
              aria-invalid={!!confirmPin && pinValue !== confirmPin} />
            {confirmPin && pinValue !== confirmPin && <p className="text-xs text-destructive">The PINs must match.</p>}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPinFor(null);
                setPinValue(""); setConfirmPin("");
                setShowPinValue(false);
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={!isAdmin || !pinFor?.is_active || !(pinPurpose === "offline_login" ? /^\d{6}$/ : /^\d{4,6}$/).test(pinValue) || pinValue !== confirmPin || busy === "auth-pin"}
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
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit account" : "Create account"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update profile, access and credentials. Leave the credential blank to keep it unchanged."
                : "Use a username for terminal PIN sign-in or a real email for password sign-in."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
            <Label className="text-xs" htmlFor="staff-active">Account enabled</Label>
            <Switch id="staff-active" checked={form.active}
              disabled={busy === "save" || (!!editing && editing.auth_user_id === authUserId)}
              onCheckedChange={(active) => setForm({ ...form, active })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2">
              <Label className="text-xs" htmlFor="staff-name">Display name *</Label>
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
              <Label className="text-xs" htmlFor="staff-identifier">{editing ? "Username *" : "Username or email *"}</Label>
              <Input
                id="staff-identifier"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value.replace(/\s+/g, "") })}
                aria-invalid={!identifierValid}
              />
              {!identifierValid && (
                <p className="text-xs text-destructive">Enter a valid username or email.</p>
              )}
            </div>
            {editing && <div className="space-y-1">
              <Label className="text-xs" htmlFor="staff-email">Email</Label>
              <Input id="staff-email" type="email" maxLength={254} autoComplete="off"
                value={form.email} aria-invalid={!emailValid}
                onChange={(e) => setForm({ ...form, email: e.target.value })} />
              {!emailValid && <p className="text-xs text-destructive">Enter a valid email address.</p>}
            </div>}
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="staff-credential">
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
              <Label className="text-xs" htmlFor="staff-confirm-credential">Confirm {emailMode ? "password" : "PIN / passcode"}</Label>
              <Input id="staff-confirm-credential" type="password" autoComplete="new-password"
                maxLength={emailMode ? 200 : 32} value={form.confirmCredential}
                aria-invalid={!!form.confirmCredential && !credentialMatches}
                onChange={e => setForm({ ...form, confirmCredential: e.target.value })} />
              {form.confirmCredential && !credentialMatches && <p className="text-xs text-destructive">The entries must match.</p>}
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1"><Label htmlFor="staff-role" className="text-xs">Role *</Label><HelpTip label="About role permissions" text={editing && editing.role_slug === form.roleSlug ? "Current permissions are preserved." : "Uses this role’s saved permissions."} /></div>
              <Select
                value={form.roleSlug}
                onValueChange={(roleSlug) => setForm({ ...form, roleSlug })}
              >
                <SelectTrigger id="staff-role">
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
            <div className="space-y-1">
              <div className="flex items-center gap-1"><Label htmlFor="staff-branch" className="text-xs">Branch *</Label><HelpTip label="About branch assignment" text="All branches uses the terminal’s branch for each sale." /></div>
              <Select
                value={form.branchId}
                onValueChange={(branchId) => setForm({ ...form, branchId })}
              >
                <SelectTrigger id="staff-branch" aria-invalid={!branchValid}>
                  <SelectValue placeholder="Select a branch" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All branches</SelectItem>
                  {stores.map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.code} · {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!branchValid && <p className="text-xs text-destructive">Choose a branch, or “All branches”.</p>}
            </div>
          </div>
          {editing && <StaffIdleTimeout person={{key: editing.user_id, name: editing.full_name, kind: "account"}} />}
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
        <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Permissions · {permissionsFor?.full_name}</DialogTitle>
            <DialogDescription>
              Changes stay pending until Save. Copying changes permissions only; branch assignments remain unchanged. Administrators retain full access.
            </DialogDescription>
          </DialogHeader>
          {permissionsFor && (
            <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted/30 p-3">
              <label className="min-w-56 flex-1 space-y-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Copy permissions from another account
                </span>
                <Select
                  disabled={permissionsFor.role === "admin" || busy === "permissions"}
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
                  permissionGroupsOpen.size === PERMISSION_EDITOR_IDS.length
                    ? "Collapse all permission groups"
                    : "Expand all permission groups"
                }
                title={
                  permissionGroupsOpen.size === PERMISSION_EDITOR_IDS.length
                    ? "Collapse all"
                    : "Expand all"
                }
                onClick={() =>
                  setPermissionGroupsOpen((current) =>
                    current.size === PERMISSION_EDITOR_IDS.length
                      ? new Set()
                      : new Set(PERMISSION_EDITOR_IDS),
                  )
                }
              >
                {permissionGroupsOpen.size === PERMISSION_EDITOR_IDS.length ? (
                  <Minimize2 className="size-4" />
                ) : (
                  <Maximize2 className="size-4" />
                )}
              </Button>
            </div>
          )}
          {permissionsFor && <div className="flex flex-wrap items-center gap-3">
            <Badge variant="secondary">{permissionsFor.role_slug}</Badge>
            <span className="text-sm text-muted-foreground">Branch: {permissionsFor.store_id ? branchDisplayName(stores, permissionsFor.store_id) : "All branches"}</span>
            <Input className="min-w-48 flex-1" aria-label="Search permissions" placeholder="Search pages or permissions…" value={permissionSearch} onChange={event => setPermissionSearch(event.target.value)} />
            <Button variant="outline" disabled={permissionsFor.role === "admin" || busy === "permissions"} onClick={() => setPermissionsFor({ ...permissionsFor, permissions: { ...(roles.find(role => role.slug === permissionsFor.role_slug)?.permissions ?? rolePermissions(permissionsFor.role)) } })}>Reset to role defaults</Button>
          </div>}
          {permissionsFor && <PermissionHierarchy
            permissions={permissionsFor.permissions}
            onChange={permissions => setPermissionsFor({ ...permissionsFor, permissions })}
            admin={permissionsFor.role === "admin"}
            busy={busy === "permissions"}
            search={permissionSearch}
            expanded={permissionGroupsOpen}
            onExpandedChange={setPermissionGroupsOpen}
          />}
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
