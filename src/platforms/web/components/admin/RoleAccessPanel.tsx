import { GlobalRestrictionPanel } from "./GlobalRestrictionPanel";
import { TableColumnRulesPanel } from "./TableColumnRulesPanel";
/**
 * Roles & access — one screen for both halves of the same question.
 *
 * "Allowed" is what a role may do; "Visible" is whether it appears on screen.
 * They used to live on two separate pages with a hidden third layer deciding
 * the outcome. Now there is nothing else: what is switched on here is exactly
 * what the person gets, on their next screen load.
 */
import { useEffect, useMemo, useState } from "react";

import { Loader2, Lock, Search } from "lucide-react";


import { Badge } from "@/components/ui/badge";

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
import type { StaffRole } from "@/lib/permissions";
import { getRolesWithPermissions, type RoleDef } from "@/lib/role-admin";
import {
  VISIBILITY_ELEMENTS,
  VISIBILITY_GROUPS,
  isVisibleFor,
  useVisibility,
  type VisibilityRole,
} from "@/lib/ui-visibility";


const isBuiltIn = (slug: string): slug is StaffRole =>
  slug === "cashier" || slug === "warehouse" || slug === "supervisor" || slug === "admin";

export function RoleAccessPanel() {
  const { can, isAdmin } = useAuth();
  const { hidden, setHidden, visibleRoute } = useVisibility();
  const allowed = can("can_manage_staff") && (isAdmin || can("can_access_pos_settings")) && visibleRoute("/settings/access");

  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [slug, setSlug] = useState<string>("cashier");
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
    if (allowed) void load();
  }, [allowed]);

  const role = useMemo(() => roles.find((r) => r.slug === slug), [roles, slug]);
  const query = term.trim().toLowerCase();

  /** Custom roles inherit their base visibility until explicitly changed.
   * Changes to a custom role never modify its base role. */
  const visibilityRole: VisibilityRole | null = useMemo(() => {
    const base = role?.baseLevel ?? (isBuiltIn(slug) ? slug : "cashier");
    return base === "admin" ? null : slug;
  }, [role, slug]);

  if (!allowed) {
    return (
      <section className="space-y-4"><header><h2 className="text-lg font-semibold">Roles &amp; access</h2><p className="text-sm text-muted-foreground">Screen visibility for each role.</p></header>
        <p className="text-sm text-muted-foreground">
          Your role does not allow staff permission management.
        </p>
      </section>
    );
  }

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
    <section className="space-y-4"><header><h2 className="text-lg font-semibold">Roles &amp; access</h2><p className="text-sm text-muted-foreground">Pick a role to change screen visibility. Configure action permissions in Roles & permissions, and individual exceptions in Accounts. Administrators always keep full access, so nothing here can lock you out.</p></header>
      <GlobalRestrictionPanel />
      {isAdmin && <TableColumnRulesPanel roles={roles} />}
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
          {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
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
                <h2 className="text-sm font-semibold">What this role sees</h2>
                <p className="text-xs text-muted-foreground">
                  Hiding something only removes it from the screen; the action permission still
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
    </section>
  );
}
