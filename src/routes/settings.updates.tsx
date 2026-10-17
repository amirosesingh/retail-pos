import { createFileRoute } from "@tanstack/react-router";
import { SettingsFrame } from "@/platforms/web/components/pos/settings/SettingsFrame";
import { AppUpdateSettings } from "@/platforms/web/components/pos/AppUpdateSettings";
import { SystemHealthCard } from "@/platforms/web/components/pos/SystemHealthCard";
import { TerminalStatusCard } from "@/platforms/web/components/pos/TerminalStatusCard";

export const Route = createFileRoute("/settings/updates")({
  head: () => ({
    meta: [
      { title: "Software Updates — Retail" },
      {
        name: "description",
        content:
          "Check the installed till version, download new releases in the background, restart to install, and roll back to the last version that started cleanly.",
      },
      { property: "og:title", content: "Software Updates — Retail" },
      {
        property: "og:description",
        content: "Background updates, version status and safe-mode rollback for the register.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <SettingsFrame
      title="Software updates"
      description="New versions download quietly in the background and install when you restart — a shift is never interrupted."
    >
      {/* Keep the primary action prominent; device diagnostics remain available. */}
      <div className="mx-auto w-full max-w-3xl space-y-5">
        <div className="min-w-0">
          <AppUpdateSettings />
        </div>
        <details className="rounded-2xl border bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium">Device and system status</summary>
          <aside className="mt-4 min-w-0 space-y-5">
            <TerminalStatusCard />
            <SystemHealthCard />
          </aside>
        </details>
      </div>
    </SettingsFrame>
  ),
});
