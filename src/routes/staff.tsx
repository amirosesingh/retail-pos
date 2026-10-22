import { useVisibility } from "@/lib/ui-visibility";
import { Button } from "@/components/ui/button";
import { RoleAccessPanel } from "@/platforms/web/components/admin/RoleAccessPanel";
import { createFileRoute, useSearch, Link } from "@tanstack/react-router";
import { ShieldAlert, Users, ShieldCheck, Eye, ArrowLeft } from "lucide-react";

import { RoleManager } from "@/platforms/web/components/admin/RoleManager";
import { StaffManager } from "@/platforms/web/components/admin/StaffManager";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/pos-auth";

export const Route = createFileRoute("/staff")({
  validateSearch: (search: Record<string, unknown>): { tab?: "accounts" | "roles" | "access" } => ({
    tab: search.tab === "access" || search.tab === "roles" ? search.tab : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Staff Accounts — Retail" },
      {
        name: "description",
        content: "Create, update, deactivate and securely manage staff accounts, roles and permissions.",
      },
      { property: "og:title", content: "Staff Accounts — Retail" },
      { property: "og:description", content: "Staff accounts, roles and permission management." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StaffManagement,
});

export function StaffPermissionsPanel() {
  const { can, isAdmin } = useAuth();
  const { visibleRoute } = useVisibility();
  const accessAllowed = (isAdmin || can("can_access_pos_settings")) && visibleRoute("/settings/access");
  const search = useSearch({ strict: false });

  if (!can("can_manage_staff")) {
    return (
        <div className="flex min-h-screen items-center justify-center p-6">
          <div className="max-w-sm rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-center">
            <ShieldAlert className="mx-auto size-6 text-destructive" />
            <h1 className="mt-2 font-semibold">Staff management access required</h1>
            <p className="mt-1 text-sm text-muted-foreground page-description">
              An administrator must grant this account the staff-management permission.
            </p>
          </div>
        </div>
    );
  }

  return (
      <main className="space-y-5 p-4 sm:p-6">
        <header>
          <Button variant="ghost" size="sm" asChild className="mb-2"><Link to="/settings" search={{ cat: "people" }}><ArrowLeft className="size-4" />Back to Settings</Link></Button>
          <h1 className="text-2xl font-semibold">Staff &amp; Permissions</h1>
          <p className="text-sm text-muted-foreground page-description">
            Accounts, access status, roles and feature permissions in one place.
          </p>
        </header>
        <Tabs key={search.tab ?? "accounts"} defaultValue={search.tab ?? "accounts"}>
          <TabsList className="h-auto min-h-9 max-w-full justify-start overflow-x-auto overflow-y-hidden scrollbar-none">
            <TabsTrigger value="accounts"><Users className="mr-1.5 size-4" aria-hidden />Accounts</TabsTrigger>
            <TabsTrigger value="roles"><ShieldCheck className="mr-1.5 size-4" aria-hidden />Roles &amp; permissions</TabsTrigger>
            {accessAllowed && <TabsTrigger value="access"><Eye className="mr-1.5 size-4" aria-hidden />Role &amp; access</TabsTrigger>}
          </TabsList>
          <TabsContent value="accounts" className="pt-4">
            <StaffManager />
          </TabsContent>
          <TabsContent value="roles" className="pt-4">
            <RoleManager />
          </TabsContent>
          <TabsContent value="access" className="pt-4"><RoleAccessPanel /></TabsContent>
        </Tabs>
      </main>
  );
}

function StaffManagement() {
  return <AppShell><StaffPermissionsPanel /></AppShell>;
}
