/**
 * Roles & access — one screen for both halves of the same question.
 *
 * "Allowed" is what a role may do; "Visible" is whether it appears on screen.
 * They used to live on two separate pages with a hidden third layer deciding
 * the outcome. Now there is nothing else: what is switched on here is exactly
 * what the person gets, on their next screen load.
 */
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2, Lock, Search, Users } from "lucide-react";

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
import type { StaffRole } from "@/lib/permissions";
import { getRolesWithPermissions, type RoleDef } from "@/lib/role-admin";
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

const isBuiltIn = (slug: string): slug is StaffRole =>
  slug === "cashier" || slug === "warehouse" || slug === "supervisor" || slug === "admin";

function AccessSettingsPage() {
  const { can } = useAuth();
  const { hidden, setHidden } = useVisibility();

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
          <Button variant="outline" size="sm" asChild>
            <Link to="/staff">
              <Users className="size-4" /> Manage roles and permissions
            </Link>
          </Button>
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
