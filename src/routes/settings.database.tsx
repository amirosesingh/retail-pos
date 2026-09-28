import { createFileRoute } from "@tanstack/react-router";
import { SettingsFrame } from "@/platforms/web/components/pos/settings/SettingsFrame";
import { DatabaseConnectionSettings } from "@/platforms/web/components/pos/DatabaseConnectionSettings";
import { BranchSettings } from "@/platforms/web/components/pos/BranchSettings";

export const Route = createFileRoute("/settings/database")({
  head: () => ({
    meta: [
      { title: "Database Connection — Retail" },
      {
        name: "description",
        content: "Central status and Windows local Microsoft SQL Server setup.",
      },
      { property: "og:title", content: "Database Connection — Retail" },
      {
        property: "og:description",
        content: "Cloud database connection and live connection test.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <SettingsFrame
      showSaveBar={false}
      allowWhileScopeLoading
      wide
      title="Database connection"
      description="Manage central connectivity and, on authorized Windows tills, the local Microsoft SQL Server database."
    >
      <BranchSettings />
      <DatabaseConnectionSettings />
    </SettingsFrame>
  ),
});
