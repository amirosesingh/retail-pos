/**
 * Roles & access — one screen for both halves of the same question.
 *
 * "Allowed" is what a role may do; "Visible" is whether it appears on screen.
 * They used to live on two separate pages with a hidden third layer deciding
 * the outcome. Now there is nothing else: what is switched on here is exactly
 * what the person gets, on their next screen load.
 */
import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Lock, RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";

import { SettingsFrame } from "@/platforms/web/components/pos/settings/SettingsFrame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { notifyError } from "@/lib/notify";
import { useAuth } from "@/lib/pos-auth";
import {
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  rolePermissions,
  type PermissionKey,
  type StaffPermissions,
  type StaffRole,
} from "@/lib/permissions";
import { getRolesWithPermissions, updateRolePermissions, type RoleDef } from "@/lib/role-admin";
import {
  VISIBILITY_ELEMENTS,
  VISIBILITY_GROUPS,
  isVisibleFor,
  useVisibility,
  type VisibilityRole,
} from "@/lib/ui-visibility";

export const Route = createFileRoute("/settings/access")({
  head: () => ({
    meta: [
      { title: "Roles & Access — Retail" },
      {
        name: "description",
        content:
          "One place to set what every role may do and what it can see: permissions and screen visibility side by side, searchable, with owner-only areas protected.",
      },
      { property: "og:title", content: "Roles & Access — Retail" },
      {
        property: "og:description",
        content: "Permissions and screen visibility for every role, on one page.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AccessSettingsPage,
});

/** What each permission actually controls, in plain words. */
const PERMISSION_EFFECT: Partial<Record<PermissionKey, string>> = {
  can_view_inventory: "Shows Inventory and Stock on hand in the sidebar.",
  can_create_transfer: "Shows Transfers and the “send stock” action.",
  can_receive_transfer: "Shows incoming transfers waiting to be accepted.",
  can_adjust_stock: "Shows Stock operations (recount, damage, write-off).",
  can_receive_purchase_order: "Shows Purchasing and Suppliers.",
  can_view_sales_reports: "Shows Reports, Analytics and bill history.",
  can_view_dashboard: "Shows the live Dashboard.",
  can_view_audit_trail: "Shows Register activity and the audit log.",
  can_access_pos_settings: "Opens the Settings workspace.",
  can_manage_staff: "Opens Staff management.",
  can_manage_promotions: "Opens Promotions and Coupons.",
  can_manage_bookings: "Shows Bookings / pay-later.",
  can_add_member: "Shows Members and the quick add-member box.",
  can_hold_cart: "Shows Held orders.",
  can_close_shift: "Shows Shifts and the close-shift button.",
  can_manage_locations: "Opens Branches / locations.",
};

const isBuiltIn = (slug: string): slug is StaffRole =>
  slug === "cashier" || slug === "warehouse" || slug === "supervisor" || slug === "admin";

function AccessSettingsPage() {
  const { can } = useAuth();
  const { hidden, setHidden } = useVisibility();

  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [slug, setSlug] = useState<string>("cashier");
  const [saving, setSaving] = useState(false);
  const [term, setTerm] = useState("");

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

  const role = useMemo(() => roles.find((r) => r.slug === slug), [roles, slug]);
  const query = term.trim().toLowerCase();

  /** Screen visibility is stored per built-in level; a custom role follows the
   *  level it was based on. Administrators always see everything. */
  const visibilityRole: VisibilityRole | null = useMemo(() => {
    const base = role?.baseLevel ?? (isBuiltIn(slug) ? slug : "cashier");
    return base === "admin" ? null : (base as VisibilityRole);
  }, [role, slug]);

  const setPermission = async (key: PermissionKey, value: boolean) => {
    if (!role) return;
    const next: StaffPermissions = { ...role.permissions, [key]: value };
    setRoles((rs) => rs.map((r) => (r.slug === role.slug ? { ...r, permissions: next } : r)));
    setSaving(true);
    try {
      await updateRolePermissions(role, next);
    } catch (e) {
      notifyError(e, "That permission could not be saved");
      void load();
    } finally {
      setSaving(false);
    }
  };

  const resetToDefault = async () => {
    if (!role) return;
    const preset = rolePermissions(role.baseLevel);
    setRoles((rs) => rs.map((r) => (r.slug === role.slug ? { ...r, permissions: preset } : r)));
    setSaving(true);
    try {
      await updateRolePermissions(role, preset);
      toast.success(`${role.name} reset to its default permissions`);
    } catch (e) {
      notifyError(e, "The role could not be reset");
      void load();
    } finally {
      setSaving(false);
    }
  };

  if (!can("can_manage_staff")) {
    return (
      <SettingsFrame
        showSaveBar={false}
        title="Roles & access"
        description="What each role may do, and what it can see."
      >
        <p className="text-sm text-muted-foreground">
          Your role does not allow staff permission management.
        </p>
      </SettingsFrame>
    );
  }

  const permissionRows = PERMISSION_GROUPS.map((group) => ({
    ...group,
    rows: [...group.keys].filter((key) => {
      if (!query) return true;
      const effect = PERMISSION_EFFECT[key] ?? "";
      return `${PERMISSION_LABELS[key]} ${effect} ${key}`.toLowerCase().includes(query);
    }),
  })).filter((g) => g.rows.length);

  const screenGroups = VISIBILITY_GROUPS.map((group) => ({
    group,
    rows: VISIBILITY_ELEMENTS.filter(
      (e) =>
        e.group === group &&
        (!query || `${e.label} ${e.blurb} ${e.route ?? ""}`.toLowerCase().includes(query)),
    ),
  })).filter((g) => g.rows.length);

  const adminSelected = (role?.baseLevel ?? slug) === "admin";

  return (
    <SettingsFrame
      showSaveBar={false}
      title="Roles & access"
      description="Pick a role, then set what it may do and what it can see. Administrators always keep full access, so nothing here can lock you out."
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-56 flex-1 space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Role</span>
            <Select value={slug} onValueChange={setSlug}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a role" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.slug} value={r.slug}>
                    {r.name}
                    {r.isCore ? "" : " · custom"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search a feature, screen or page"
              className="pl-8"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void resetToDefault()}
            disabled={!role || saving}
          >
            <RotateCcw className="size-4" />
            Reset to role default
          </Button>
          {(loading || saving) && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>

        {adminSelected ? (
          <p className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
            Administrators always have every permission and see every screen. Choose another role to
            change access.
          </p>
        ) : (
          <>
            <section className="space-y-3">
              <header>
                <h2 className="text-sm font-semibold">What this role may do</h2>
                <p className="text-xs text-muted-foreground">
                  Switching one on shows the matching screen straight away — nothing else overrules
                  it. A person's own record can still be tuned in Staff management.
                </p>
              </header>
              {permissionRows.map((group) => (
                <div key={group.id} className="overflow-hidden rounded-lg border border-border">
                  <div className="bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
                    {group.label}
                  </div>
                  <ul>
                    {group.rows.map((key) => (
                      <li
                        key={key}
                        className="flex items-start justify-between gap-3 border-t border-border px-3 py-2"
                      >
                        <div className="min-w-0">
                          <span className="block text-sm">{PERMISSION_LABELS[key]}</span>
                          {PERMISSION_EFFECT[key] && (
                            <span className="block text-xs text-muted-foreground">
                              {PERMISSION_EFFECT[key]}
                            </span>
                          )}
                        </div>
                        <Switch
                          checked={!!role?.permissions[key]}
                          aria-label={`${PERMISSION_LABELS[key]} allowed`}
                          disabled={!role}
                          onCheckedChange={(on) => void setPermission(key, on)}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>

            <section className="space-y-3">
              <header>
                <h2 className="text-sm font-semibold">What this role sees</h2>
                <p className="text-xs text-muted-foreground">
                  Hiding something only removes it from the screen; the permission above still
                  decides what may be done. A few core areas stay with the owner; sensitive areas
                  can be handed over, but stay hidden until you switch them on.
                </p>
              </header>
              {screenGroups.map(({ group, rows }) => (
                <div key={group} className="overflow-hidden rounded-lg border border-border">
                  <div className="bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
                    {group}
                  </div>
                  <ul>
                    {rows.map((el) => {
                      const locked = el.lock === "core";
                      const sensitive = el.lock === "sensitive";
                      const shown =
                        !locked && !!visibilityRole && isVisibleFor(hidden, el.key, visibilityRole);
                      return (
                        <li
                          key={el.key}
                          className="flex items-start justify-between gap-3 border-t border-border px-3 py-2"
                        >
                          <div className="min-w-0">
                            <span className="block text-sm">{el.label}</span>
                            <span className="block text-xs text-muted-foreground">{el.blurb}</span>
                            {sensitive && (
                              <span className="mt-0.5 block text-xs text-amber-600 dark:text-amber-500">
                                Sensitive area — off unless you grant it.
                              </span>
                            )}
                          </div>
                          {locked ? (
                            <Badge variant="outline" className="shrink-0 gap-1">
                              <Lock className="size-3" />
                              Owner only
                            </Badge>
                          ) : (
                            <Switch
                              checked={shown}
                              aria-label={`${el.label} visible`}
                              disabled={!visibilityRole}
                              onCheckedChange={(on) =>
                                visibilityRole && setHidden(el.key, visibilityRole, !on)
                              }
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </section>
          </>
        )}
      </div>
    </SettingsFrame>
  );
}
