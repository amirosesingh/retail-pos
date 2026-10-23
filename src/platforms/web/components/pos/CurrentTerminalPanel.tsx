/**
 * "The device you are on right now."
 *
 * Everything here is read from what this machine already knows — its sealed
 * activation, the shared connection heartbeat and the sync engine — so an
 * administrator standing at a till can answer "is this one healthy?" without
 * hunting through three screens.
 */
import { useEffect, useState } from "react";
import { MonitorSmartphone } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { APP_DISPLAY_VERSION as APP_VERSION } from "@/version";
import { isDesktop } from "@/lib/branding";
import { isNative } from "@/platform-config/platform";
import { readTerminalConfig, subscribeTerminalConfig } from "@/core/activation/terminal-tokens";
import { subscribeSyncState, syncState } from "@/lib/sync-status";
import { isCloudConnected } from "@/core/activation/registration-status";
import { sinceWords } from "@/lib/terminal-status";
import { UnpairTerminalCard } from "@/platforms/web/components/pos/UnpairTerminal";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-1.5 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-xs font-medium">{value}</span>
    </div>
  );
}

export function CurrentTerminalPanel() {
  const [config, setConfig] = useState(() => readTerminalConfig());
  const [sync, setSync] = useState(() => syncState());
  const [online, setOnline] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => subscribeTerminalConfig(() => setConfig(readTerminalConfig())), []);
  useEffect(() => subscribeSyncState(() => setSync(syncState())), []);
  useEffect(() => {
    const read = () => {
      setOnline(isCloudConnected());
      setTick((v) => v + 1);
    };
    read();
    const timer = window.setInterval(read, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const platform = isNative() ? "Phone / tablet" : isDesktop() ? "Windows till" : "Web browser";
  const host = (() => {
    try {
      return config?.supabaseUrl ? new URL(config.supabaseUrl).host : "";
    } catch {
      return "";
    }
  })();

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <MonitorSmartphone className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">This device</h2>
        <Badge
          variant="outline"
          className={
            online
              ? "border-success/40 bg-success/10 text-success"
              : "border-border bg-muted text-muted-foreground"
          }
        >
          {online ? "Connected" : "No connection"}
        </Badge>
      </div>

      <div className="grid gap-x-8 sm:grid-cols-2">
        <div>
          <Row label="Device name" value={config?.deviceName || "Not activated"} />
          <Row label="Branch" value={config?.locationName || "—"} />
          <Row label="Type" value={platform} />
          <Row label="App version" value={APP_VERSION} />
        </div>
        <div>
          <Row
            label="Activation"
            value={config?.tokenId ? `Registered · ${config.tokenId.slice(0, 8)}…` : "Not activated"}
          />
          <Row
            label="Last sync"
            value={sync.lastSyncAt ? sinceWords(sync.lastSyncAt) : "Not yet"}
          />
          <Row
            label="Waiting to send"
            value={sync.pending ? `${sync.pending} record${sync.pending === 1 ? "" : "s"}` : "None"}
          />
          <Row label="Database" value={host || "Not configured"} />
        </div>
      </div>

      <div className="mt-4">
        <UnpairTerminalCard />
      </div>
    </section>
  );
}
