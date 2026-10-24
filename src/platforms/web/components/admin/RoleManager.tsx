import { PermissionHierarchy } from "./PermissionHierarchy";
import { useVisibility } from "@/lib/ui-visibility";
import { UserDisplayPermissions } from "./UserDisplayPermissions";
import { PERMISSION_EDITOR_IDS } from "@/lib/permission-editor";
import { roleStartingPermissions } from "@/lib/role-defaults";
/**
 * Saved role presets, grouped by the same pages as per-person permissions.
 *
 * Built-in roles keep their names and can never be removed; custom roles are
 * free to add, edit and delete while nobody holds them.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

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
import {
  STAFF_ROLES,
  type StaffPermissions,
  type StaffRole,
} from "@/lib/permissions";
import {
  createCustomRole,
  deleteCustomRole,
  getRolesWithPermissions,
  updateRolePermissions,
  type RoleDef,
} from "@/lib/role-admin";
import { notifyError } from "@/lib/notify";
import { broadcastSettingsChange, subscribeDataChange, syncNow } from "@/lib/sync-engine";

async function propagateRoleChange(reason: string) {
  const [, result] = await Promise.all([broadcastSettingsChange("staff_roles"), syncNow(reason)]);
  if (!result.ok) {
    toast.warning("Role saved centrally; the local database will retry synchronization", {
      description: result.error,
    });
  }
  return result;
}

export function RoleManager() {
  const { hidden } = useVisibility();
  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [base, setBase] = useState<StaffRole>("cashier");
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [permissionSearch, setPermissionSearch] = useState("");
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRoles(await getRolesWithPermissions());
    } catch (e) {
      notifyError(e, "Roles could not be loaded");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () =>
      subscribeDataChange((change) => {
        if (change.table === "staff_roles") void load();
      }),
    [load],
  );

  const changePermissions = async (role: RoleDef, next: StaffPermissions) => {
    if (savingRef.current || role.baseLevel === "admin") return;
    savingRef.current = true;
    setRoles((rs) => rs.map((r) => (r.slug === role.slug ? { ...r, permissions: next } : r)));
    setSaving(role.slug);
    try {
      await updateRolePermissions(role, next);
      await propagateRoleChange("staff role permissions changed");
    } catch (e) {
      notifyError(e, "That permission could not be saved");
      void load();
    } finally {
      savingRef.current = false;
      setSaving(null);
    }
  };

  const create = async () => {
    setCreating(true);
    try {
      const role = await createCustomRole(name, roleStartingPermissions(roles, base), base);
      await propagateRoleChange("staff role created");
      toast.success(`${role.name} created`);
      setOpen(false);
      setName("");
      void load();
    } catch (e) {
      notifyError(e, "The role could not be created");
    } finally {
      setCreating(false);
    }
  };

  const remove = async (role: RoleDef) => {
    try {
      await deleteCustomRole(role);
      await propagateRoleChange("staff role deleted");
      toast.success(`${role.name} removed`);
      void load();
    } catch (e) {
      notifyError(e, "The role could not be removed");
    }
  };

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Role defaults</h2>
          <p className="text-xs text-muted-foreground">
            Presets copied when a role is assigned. Editing a preset does not overwrite existing people's saved choices. Change an existing person's access in People & permissions, or use Reset to role defaults in their editor. Changes save as you edit.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || saving !== null}>
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Refresh
          </Button>
          <Button size="sm" disabled={saving !== null} onClick={() => setOpen(true)}>
            <Plus className="size-4" /> New role
          </Button>
        </div>
      </header>

      <Separator />

      <div className="space-y-3">
        {roles.map(role => {
          const expanded = editingRole === role.slug;
          return <section key={role.slug} className="overflow-hidden rounded-xl border border-border">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <button type="button" className="min-w-0 space-y-1 text-left" aria-expanded={expanded} onClick={() => { setEditingRole(expanded ? null : role.slug); setOpenGroups(new Set()); setPermissionSearch(""); }}>
                <span className="block font-medium">{role.name}</span>
                <span className="block text-xs text-muted-foreground">{expanded ? "Hide default permissions" : "Edit default permissions"} · Base level: {role.baseLevel}</span>
              </button>
              <div className="flex items-center gap-2">
                {role.isCore ? <Badge variant="outline">Built-in</Badge> : <Button variant="ghost" size="sm" className="text-destructive" disabled={saving !== null} onClick={() => void remove(role)}><Trash2 className="size-4" /> Delete</Button>}
                {saving === role.slug && <Loader2 aria-label="Saving role permissions" className="size-4 animate-spin" />}
              </div>
            </div>
            {expanded && <div className="space-y-4 border-t border-border p-3 sm:p-4">
              <div className="flex items-center gap-2"><Input aria-label={`Search ${role.name} permissions`} placeholder="Search pages or permissions…" value={permissionSearch} onChange={event => setPermissionSearch(event.target.value)} />
                <Button variant="ghost" size="icon" aria-label={openGroups.size === PERMISSION_EDITOR_IDS.length ? "Collapse all permission groups" : "Expand all permission groups"} onClick={() => setOpenGroups(current => current.size === PERMISSION_EDITOR_IDS.length ? new Set() : new Set(PERMISSION_EDITOR_IDS))}>{openGroups.size === PERMISSION_EDITOR_IDS.length ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}</Button>
              </div>
              <PermissionHierarchy hidden={hidden} displayRole={role.slug} permissions={role.permissions} onChange={permissions => void changePermissions(role, permissions)} admin={role.baseLevel === "admin"} busy={saving !== null} search={permissionSearch} expanded={openGroups} onExpandedChange={setOpenGroups} />
              <UserDisplayPermissions permissions={role.permissions} onChange={permissions => void changePermissions(role, permissions)} hidden={hidden} role={role.slug} userId="" admin={role.baseLevel === "admin"} busy={saving !== null} search={permissionSearch} />
            </div>}
          </section>;
        })}
        {!loading && roles.length === 0 && <p className="text-sm text-muted-foreground">No roles are available.</p>}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New role</DialogTitle>
            <DialogDescription>
              Start with the saved permissions for a built-in level. Review its pages and permissions after creating the role. Admin-level roles retain full access.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="role-name">Role name</Label>
              <Input
                id="role-name"
                value={name}
                placeholder="Floor supervisor"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Starting level</Label>
              <Select value={base} onValueChange={(v) => setBase(v as StaffRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAFF_ROLES.map((r) => (
                    <SelectItem key={r} value={r} className="capitalize">
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => void create()} disabled={creating || name.trim().length < 2}>
              {creating && <Loader2 className="size-4 animate-spin" />} Create role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
