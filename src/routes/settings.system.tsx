import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { SettingsFrame } from "@/platforms/web/components/pos/settings/SettingsFrame";
import { SettingsTabs } from "@/platforms/web/components/pos/settings/SettingsTabs";
import { SystemStatusPanel } from "@/platforms/web/components/pos/settings/panels/SystemStatusPanel";
import { CloudConnectionPanel } from "@/platforms/web/components/pos/settings/panels/CloudConnectionPanel";
import { LogicHealthPanel } from "@/platforms/web/components/pos/settings/panels/LogicHealthPanel";
import { SecurityAlertsPanel } from "@/platforms/web/components/pos/settings/panels/SecurityAlertsPanel";
import { InheritancePanel } from "@/platforms/web/components/pos/settings/panels/InheritancePanel";
import { SYSTEM_TAB_IDS, systemTab, type SystemTabId } from "@/lib/settings-groups";

export const Route = createFileRoute("/settings/system")({
  validateSearch: (search: Record<string, unknown>): { tab?: SystemTabId } => {
    const tab = search["tab"];
    return SYSTEM_TAB_IDS.includes(tab as SystemTabId) ? { tab: tab as SystemTabId } : {};
  },
  head: () => ({
    meta: [
      { title: "System & General Settings — Retail" },
      {
        name: "description",
        content:
          "One window for connection health, code logic health, security alerts and settings inheritance on this till.",
      },
      { property: "og:title", content: "System & General Settings — Retail" },
      {
        property: "og:description",
        content: "Diagnose and configure the online services this device depends on.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SystemSettingsPage,
});

function SystemSettingsPage() {
  const { tab = "system" } = Route.useSearch();
  const navigate = useNavigate({ from: "/settings/system" });
  const meta = systemTab(tab);

  return (
    <SettingsFrame showSaveBar={false} wide title={meta.label} description={meta.blurb}>
      <SettingsTabs
        current="/settings/system"
        activeTab={tab}
        onTab={(next) => void navigate({ search: { tab: next as SystemTabId }, replace: true })}
      />

      <div className="w-full min-w-0 max-w-full">
        {tab === "system" && (
          <div className="space-y-4">
            <CloudConnectionPanel presentation="dialog" />
            <SystemStatusPanel />
          </div>
        )}
        {tab === "logic-health" && <LogicHealthPanel />}
        {tab === "security-alerts" && <SecurityAlertsPanel />}
        {tab === "inheritance" && <InheritancePanel />}
      </div>
    </SettingsFrame>
  );
}
