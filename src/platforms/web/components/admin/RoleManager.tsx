/**
 * Roles and what each one is allowed to do, as a single matrix.
 *
 * Built-in roles keep their names and can never be removed; custom roles are
 * free to add, edit and delete while nobody holds them.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
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
import {
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  STAFF_ROLES,
  rolePermissions,
  type PermissionKey,
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
import { broadcastSettingsChange, syncNow } from "@/lib/sync-engine";

async function propagateRoleChange(reason: string) {
  await Promise.all([broadcastSettingsChange("staff_roles"), syncNow(reason)]);
}

export function RoleManager() {
  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [base, setBase] = useState<StaffRole>("cashier");
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(PERMISSION_GROUPS.map((group) => group.id)),
  );

  const load = async () => {
    setLoading(true);
    try {
      setRoles(await getRolesWithPermissions());
    } catch (e) {
      notifyError(e, "Roles could not be loaded");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const columns = useMemo(() => roles, [roles]);

  const toggle = async (role: RoleDef, key: PermissionKey, value: boolean) => {
    const next: StaffPermissions = { ...role.permissions, [key]: value };
    setRoles((rs) => rs.map((r) => (r.slug === role.slug ? { ...r, permissions: next } : r)));
    setSaving(role.slug);
    try {
      await updateRolePermissions(role, next);
      await propagateRoleChange("staff role permissions changed");
    } catch (e) {
      notifyError(e, "That permission could not be saved");
      void load();
    } finally {
      setSaving(null);
    }
  };

  const create = async () => {
    setCreating(true);
    try {
      const role = await createCustomRole(name, rolePermissions(base), base);
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
          <h2 className="text-sm font-semibold">Roles &amp; permissions</h2>
          <p className="text-xs text-muted-foreground">
            Every role is a column. Tick a box to grant that ability to everyone on the role.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Refresh
          </Button>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-4" /> New role
          </Button>
        </div>
      </header>

      <Separator />

      <div className="flex justify-end gap-2">
        <Button
          size="icon"
          variant="ghost"
          className="bg-transparent shadow-none"
          aria-label={
            openGroups.size === PERMISSION_GROUPS.length
              ? "Collapse all permission groups"
              : "Expand all permission groups"
          }
          title={openGroups.size === PERMISSION_GROUPS.length ? "Collapse all" : "Expand all"}
          onClick={() =>
            setOpenGroups((current) =>
              current.size === PERMISSION_GROUPS.length
                ? new Set()
                : new Set(PERMISSION_GROUPS.map((group) => group.id)),
            )
          }
        >
          {openGroups.size === PERMISSION_GROUPS.length ? (
            <Minimize2 className="size-4" />
          ) : (
            <Maximize2 className="size-4" />
          )}
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="w-[42%] py-2 text-left font-medium">Permission</th>
              {columns.map((r) => (
                <th key={r.slug} className="px-2 py-2 text-center align-bottom">
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-xs font-medium">{r.name}</span>
                    {r.isCore ? (
                      <Badge variant="outline" className="text-[10px]">
                        Built-in
                      </Badge>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1 text-[10px] text-destructive"
                        onClick={() => void remove(r)}
                      >
                        <Trash2 className="size-3" /> Delete
                      </Button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_GROUPS.map((group) => {
              const expanded = openGroups.has(group.id);
              return (
                <Fragment key={group.id}>
                  <tr key={`g-${group.id}`} className="bg-muted/40">
                    <td
                      colSpan={columns.length + 1}
                      className="p-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      <button
                        type="button"
                        className="flex w-full items-center justify-between px-2 py-1.5 text-left"
                        aria-expanded={expanded}
                        onClick={() =>
                          setOpenGroups((current) => {
                            const next = new Set(current);
                            if (expanded) next.delete(group.id);
                            else next.add(group.id);
                            return next;
                          })
                        }
                      >
                        <span>{group.label}</span>
                        {expanded ? (
                          <ChevronDown className="size-3" />
                        ) : (
                          <ChevronRight className="size-3" />
                        )}
                      </button>
                    </td>
                  </tr>
                  {expanded &&
                    group.keys.map((key) => (
                      <tr key={key} className="border-b border-border/60">
                        <td className="py-2 pr-2">{PERMISSION_LABELS[key as PermissionKey]}</td>
                        {columns.map((r) => (
                          <td key={`${r.slug}-${key}`} className="px-2 py-2 text-center">
                            <Checkbox
                              checked={!!r.permissions[key as PermissionKey]}
                              disabled={saving === r.slug}
                              onCheckedChange={(v) =>
                                void toggle(r, key as PermissionKey, v === true)
                              }
                              aria-label={`${r.name}: ${PERMISSION_LABELS[key as PermissionKey]}`}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New role</DialogTitle>
            <DialogDescription>
              Pick a starting level; every toggle stays editable in the matrix afterwards.
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
