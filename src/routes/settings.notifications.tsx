import { createFileRoute } from "@tanstack/react-router";
import { NotificationRulesPage } from "@/platforms/web/components/pos/settings/NotificationRulesPage";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
export const Route = createFileRoute("/settings/notifications")({
  head: () => ({
    meta: [
      { title: "Notification rules — Retail" },
      {
        name: "description",
        content: "Manage notification events, recipients, conditions and delivery in one table.",
      },
    ],
  }),
  component: () => (
    <AppShell>
      <NotificationRulesPage />
    </AppShell>
  ),
});
