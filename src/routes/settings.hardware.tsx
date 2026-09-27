import { createFileRoute } from "@tanstack/react-router";
import { SettingsFrame } from "@/platforms/web/components/pos/settings/SettingsFrame";
import { HardwarePanel } from "@/platforms/web/components/pos/settings/panels/HardwarePanel";

export const Route = createFileRoute("/settings/hardware")({
  head: () => ({
    meta: [
      { title: "Terminal Hardware — Retail" },
      {
        name: "description",
        content:
          "Printer and cash-drawer settings resolved through Global, Cluster and Terminal scope.",
      },
      { property: "og:title", content: "Terminal Hardware — Retail" },
      {
        property: "og:description",
        content: "Centrally scoped printer and drawer configuration.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HardwareSettings,
});

function HardwareSettings() {
  return (
    <SettingsFrame
      title="Terminal hardware"
      description="Manage the synchronized printer and drawer profile selected in Settings inheritance."
    >
      <HardwarePanel />
    </SettingsFrame>
  );
}
