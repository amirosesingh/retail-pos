/**
 * Read-only identity for the current access point plus the centrally scoped
 * printer and cash-drawer profile selected in the settings header.
 */
import { useEffect, useState } from "react";
import { MonitorCog } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { activeBranchName } from "@/lib/active-branch";
import { ENGINE_LABEL, storageEngine } from "@/lib/telemetry";
import { readTerminalConfig } from "@/core/activation/terminal-tokens";

export function HardwarePanel() {
  const [info, setInfo] = useState({ id: "", branch: "", engine: "" });

  useEffect(() => {
    setInfo({
      id: readTerminalConfig()?.deviceName || readTerminalConfig()?.locationName || "This terminal",
      branch: activeBranchName() ?? "Not bound",
      engine: ENGINE_LABEL[storageEngine()] ?? storageEngine(),
    });
  }, []);

  return (
    <>
      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <MonitorCog className="size-4 text-primary" /> This terminal
        </h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Terminal</dt>
            <dd className="break-words text-sm font-medium">{info.id}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Branch</dt>
            <dd className="text-sm font-medium">{info.branch}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Local storage</dt>
            <dd className="text-sm font-medium">{info.engine}</dd>
          </div>
        </dl>
        <p className="mt-4 rounded-md bg-muted p-3 text-xs text-muted-foreground">
          Printer profiles follow the selected scope. Use Terminal for a printer attached to one
          registered till, or Cluster to share it with that cluster's terminals.
        </p>
      </section>

      <Button variant="outline" asChild><Link to="/settings/printer">Configure receipt printer and cash drawer</Link></Button>
    </>
  );
}
