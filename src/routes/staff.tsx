import { createFileRoute } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";

import { RoleManager } from "@/platforms/web/components/admin/RoleManager";
import { StaffManager } from "@/platforms/web/components/admin/StaffManager";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/pos-auth";

export const Route = createFileRoute("/staff")({
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

function StaffManagement() {
  const { can } = useAuth();

  if (!can("can_manage_staff")) {
    return (
      <AppShell>
        <div className="flex min-h-screen items-center justify-center p-6">
          <div className="max-w-sm rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-center">
            <ShieldAlert className="mx-auto size-6 text-destructive" />
            <h1 className="mt-2 font-semibold">Staff management access required</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              An administrator must grant this account the staff-management permission.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main className="space-y-5 p-4 sm:p-6">
        <header>
          <h1 className="text-2xl font-semibold">Staff management</h1>
          <p className="text-sm text-muted-foreground">
            Accounts, access status, roles and feature permissions in one place.
          </p>
        </header>
        <Tabs defaultValue="accounts">
          <TabsList>
            <TabsTrigger value="accounts">Accounts</TabsTrigger>
            <TabsTrigger value="roles">Roles &amp; permissions</TabsTrigger>
          </TabsList>
          <TabsContent value="accounts" className="pt-4">
            <StaffManager />
          </TabsContent>
          <TabsContent value="roles" className="pt-4">
            <RoleManager />
          </TabsContent>
        </Tabs>
      </main>
    </AppShell>
  );
}
