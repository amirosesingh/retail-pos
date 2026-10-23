import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReactNode } from "react";

type DatabaseState = { connected?: boolean; state?: string; profile?: { database?: string } | null };
type Health = { ok?: boolean; latencyMs?: number; change_tracking_version?: number | string };
type Schema = { ok?: boolean; ready?: boolean; missingTables?: string[]; missingColumns?: unknown[] };

const stateLabel = (value?: string) =>
  (value ?? "unknown").replace(/^enabled_/, "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export function DatabaseHealthCard({ state, health, schema, children }: { state: DatabaseState; health?: Health; schema?: Schema; children?: ReactNode }) {
  const missing = (schema?.missingTables?.length ?? 0) + (schema?.missingColumns?.length ?? 0);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Database health</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-5">
        <div><div className="text-xs text-muted-foreground">Status</div><div>{stateLabel(state.state)}</div></div>
        <div><div className="text-xs text-muted-foreground">Database</div><div className="break-all">{state.profile?.database ?? "Not selected"}</div></div>
        <div><div className="text-xs text-muted-foreground">Connection</div><div>{state.connected ? "Ready" : "Not ready"}</div></div>
        <div><div className="text-xs text-muted-foreground">Response time</div><div>{health?.ok && health.latencyMs != null ? `${health.latencyMs} ms` : "Unavailable"}</div></div>
        <div><div className="text-xs text-muted-foreground">Schema</div><div>{schema?.ok && (schema.ready ?? missing === 0) ? "Ready" : missing ? `${missing} issue${missing === 1 ? "" : "s"}` : "Unavailable"}</div></div>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
