/**
 * Emergency access → Recovery settings.
 *
 * The one screen a till or phone can always open, even when the backend is
 * unreachable: it renders nothing that needs the connection it is there to
 * repair. It carries exactly the two things a terminal app needs to come
 * back online — the backend address and the central database URL + publishable
 * key — plus a connection test and a way to clear the stored credentials.
 *
 * No privileged credential is entered or kept here by design.
 */
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { LifeBuoy, ArrowLeft, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { RecoveryHub } from "@/platforms/web/components/pos/RecoveryHub";
import { EmergencyPinGate } from "@/platforms/web/components/pos/EmergencyPinGate";
import { heartbeat } from "@/core/activation/connection-health";
import { APP_DISPLAY_VERSION as APP_VERSION } from "@/version";
import { isTerminalApp } from "@/platform-config/platform";



export const Route = createFileRoute("/recovery")({
  head: () => ({
    meta: [
      { title: "Emergency Access & Recovery — Retail" },
      {
        name: "description",
        content:
          "Repair this terminal's backend address and central database connection when the POS cannot reach its server.",
      },
      { property: "og:title", content: "Emergency Access & Recovery — Retail" },
      {
        property: "og:description",
        content: "Offline-capable connection repair for a till or handheld that cannot sign in.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RecoveryPage,
});

function RecoveryPage() {
  if (!isTerminalApp()) return <Navigate to="/" />;
  return (
    <EmergencyPinGate>
      <RecoverySettings />
    </EmergencyPinGate>
  );
}

function RecoverySettings() {
  const navigate = useNavigate();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-4 bg-background p-6">

      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <LifeBuoy className="size-5 text-warning" />
          Emergency access
        </h1>
        <p className="text-sm text-muted-foreground">
          This screen works without a connection. Everything a terminal needs to come back online is
          here — activation, addresses, keys, database and hardware. Open a card to fix it, then
          return to the till.
        </p>
      </header>

      <RecoveryHub />

      <div className="flex flex-wrap gap-2 pt-2">
        <Button
          variant="outline"
          onClick={() => {
            void heartbeat();
          }}
        >
          <RefreshCw className="size-4" />
          Re-check connection
        </Button>
        <Button onClick={() => void navigate({ to: "/" })}>
          <ArrowLeft className="size-4" />
          Back to the till
        </Button>
      </div>

      <p className="pt-1 text-center text-[11px] text-muted-foreground">
        Retail v{APP_VERSION}
      </p>
    </main>
  );
}
