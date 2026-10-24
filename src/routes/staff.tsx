import { useVisibility } from "@/lib/ui-visibility";
import { Button } from "@/components/ui/button";
import { RulesSettings } from "./settings.rules";
import { createFileRoute, useSearch, Link } from "@tanstack/react-router";
import { ShieldAlert, Users, ShieldCheck, ChevronLeft } from "lucide-react";
import { usePos } from "@/lib/pos-store";
import { AuthorizationRulesPanel } from "@/platforms/web/components/pos/settings/AuthorizationRulesPanel";

import { RoleManager } from "@/platforms/web/components/admin/RoleManager";
import { StaffManager } from "@/platforms/web/components/admin/StaffManager";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/pos-auth";

export const Route = createFileRoute("/staff")({
  validateSearch: (search: Record<string, unknown>): { tab?: "accounts" | "roles" | "policies" | "approvals" } => ({
    tab: search.tab === "access" ? "policies" : search.tab === "policies" || search.tab === "roles" || search.tab === "approvals" ? search.tab : undefined,
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

export function StaffPermissionsPanel({ defaultTab = "accounts" }: { defaultTab?: "accounts" | "policies" }) {
  const { can, isAdmin } = useAuth();
  const { currentStore } = usePos();
  const { visibleRoute } = useVisibility();
  const accessAllowed = (isAdmin || can("can_access_pos_settings")) && visibleRoute("/settings/access");
  const policiesAllowed = (isAdmin || can("can_access_pos_settings")) && visibleRoute("/settings/rules");
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
      <main className="pos-page-container">
        <header className="flex items-start gap-3">
          <Button variant="ghost" size="icon" asChild className="shrink-0" aria-label="Back to Settings" title="Back to Settings"><Link to="/settings" search={{ cat: "people" }}><ChevronLeft className="size-4" aria-hidden="true" /></Link></Button>
          <div>
          <h1 className="text-2xl font-semibold">Staff &amp; Permissions</h1>
          <p className="text-sm text-muted-foreground page-description">
            Use Edit permissions to manage pages, actions, settings visibility and table columns. Management device sign-in is in Edit account. Role defaults are starting presets; Approver rules choose who may approve sensitive actions.
          </p>
          </div>
        </header>
        <Tabs key={search.tab ?? defaultTab} defaultValue={search.tab ?? defaultTab}>
          <TabsList className="h-auto min-h-9 max-w-full justify-start overflow-x-auto overflow-y-hidden scrollbar-none">
            <TabsTrigger value="accounts"><Users className="mr-1.5 size-4" aria-hidden />People &amp; permissions</TabsTrigger>
            <TabsTrigger value="roles"><ShieldCheck className="mr-1.5 size-4" aria-hidden />Role defaults</TabsTrigger>
            {accessAllowed && <TabsTrigger value="approvals"><ShieldCheck className="mr-1.5 size-4" aria-hidden />Approver rules</TabsTrigger>}
            {policiesAllowed && <TabsTrigger value="policies"><ShieldCheck className="mr-1.5 size-4" aria-hidden />Operational policies</TabsTrigger>}
          </TabsList>
          <TabsContent value="accounts" className="pt-4">
            <StaffManager />
          </TabsContent>
          <TabsContent value="roles" className="pt-4">
            <RoleManager />
          </TabsContent>
          {policiesAllowed && <TabsContent value="policies" className="pt-4"><RulesSettings embedded /></TabsContent>}
          {accessAllowed && <TabsContent value="approvals" className="pt-4">
            {currentStore ? <AuthorizationRulesPanel storeId={currentStore.id} storeName={currentStore.name} mayEdit={isAdmin || can("can_access_pos_settings")} canEditGlobal={isAdmin} /> : <p>Select a branch to manage approval rules.</p>}
          </TabsContent>}
        </Tabs>
      </main>
  );
}

function StaffManagement() {
  return <AppShell><StaffPermissionsPanel /></AppShell>;
}
