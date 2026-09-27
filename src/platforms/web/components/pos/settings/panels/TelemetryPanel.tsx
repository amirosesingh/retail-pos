/**
 * Live health of every till, plus the data-only remote requests an
 * administrator may send. Rendered both as its own page and inside the
 * settings slide-over.
 */
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/pos-auth";
import { describeError } from "@/lib/notify";
import {
  CONNECTION_LABEL,
  ENGINE_LABEL,
  HEALTH_LABEL,
  deviceLabel,
  health,
  isStale,
  listTelemetry,
  listTelemetryHistory,
  missingTelemetryColumns,
  type TelemetryHistoryRow,
  type TelemetryRow,
} from "@/lib/telemetry";
import { clearTelemetryHistory } from "@/lib/telemetry.functions";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";

import {
  COMMAND_LABEL,
  issueCommand,
  listCommands,
  type CommandName,
  type TerminalCommand,
} from "@/lib/terminal-commands";

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

/** Colour follows the heartbeat, not the last status a till managed to write. */
function statusTone(row: TelemetryRow) {
  const state = health(row);
  if (state === "unknown") return "bg-muted text-muted-foreground";
  if (state === "offline") return "bg-destructive/15 text-destructive";
  if (state === "stale") return "bg-amber-500/15 text-amber-600";
  return "bg-emerald-500/15 text-emerald-600";
}

export function TelemetryPanel() {
  const { user, isAdmin } = useAuth();
  const [rows, setRows] = useState<TelemetryRow[]>([]);
  const [history, setHistory] = useState<TelemetryHistoryRow[]>([]);
  const [commands, setCommands] = useState<TerminalCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [missingColumns, setMissingColumns] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const [t, c, h] = await Promise.all([
        listTelemetry(),
        listCommands(),
        listTelemetryHistory(),
      ]);
      setRows(t);
      setHistory(h);
      setMissingColumns(missingTelemetryColumns());

      setCommands(c);
    } catch (e) {
      toast.error("Could not load terminal health", {
        description: describeError(e, "Loading terminal health"),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const clearHistory = async () => {
    if (
      !isAdmin ||
      !window.confirm(
        "Clear telemetry history? Terminal registrations, sales, shifts, and financial audit records will be kept.",
      )
    )
      return;
    setBusy("clear-history");
    try {
      const auth = await getPosCallerAuth();
      if (!auth.accessToken)
        throw new Error("Sign in with an administrator account to clear telemetry history.");
      const result = await clearTelemetryHistory({ data: { accessToken: auth.accessToken } });
      if (!result.ok) throw new Error(result.error);
      toast.success("Telemetry history cleared", {
        description: "Terminal registrations and financial audit records were not changed.",
      });
      await load();
    } catch (e) {
      toast.error("Could not clear telemetry history", {
        description: describeError(e, "Clearing telemetry history"),
      });
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const send = async (row: TelemetryRow, command: CommandName) => {
    setBusy(`${row.terminal_id}:${command}`);
    try {
      await issueCommand({
        terminalId: row.terminal_id,
        storeId: row.store_id,
        command,
        issuedBy: user?.name ?? null,
        issuedRole: user?.role ?? null,
      });
      toast.success("Request sent", {
        description: "The terminal runs it after its own unsynced sales have gone up.",
      });
      await load();
    } catch (e) {
      toast.error("Could not send the request", {
        description: describeError(e, "Sending the terminal request"),
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {missingColumns.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-400">
          Some device details are unavailable — this database is missing recent telemetry columns (
          {missingColumns.join(", ")}). Terminals still report their core status. Apply the latest
          database update to restore the full view.
        </div>
      )}
      <section className="rounded-lg border border-border bg-card p-5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <h2 className="truncate text-lg font-semibold">Current Terminals</h2>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="mr-2 size-4" /> Refresh
          </Button>
        </div>

        <div className="mt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Signed in</TableHead>
                <TableHead>Connection</TableHead>
                <TableHead>Storage</TableHead>
                <TableHead className="text-right">Waiting</TableHead>
                <TableHead>Last sync</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead className="text-right">Requests</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                    Loading terminal health…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                    No terminal has reported in yet.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.terminal_id}>
                    <TableCell className="font-medium">
                      {deviceLabel(r)}
                      <div className="text-[11px] text-muted-foreground">
                        {r.device_type === "mobile" ? "Phone / tablet" : "Windows till"}
                        {r.app_version ? ` · v${r.app_version}` : ""}
                      </div>
                    </TableCell>
                    <TableCell>
                      {r.location_name || r.store_id || "—"}
                      {r.location_name && r.store_id ? (
                        <div className="text-[11px] text-muted-foreground">{r.store_id}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {r.staff_name ??
                        (r.session_status === "never_seen" ? "Never signed in" : "Nobody")}
                      {r.staff_role ? (
                        <div className="text-[11px] capitalize text-muted-foreground">
                          {r.staff_role}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge className={statusTone(r)} variant="secondary">
                        {HEALTH_LABEL[health(r)]}
                      </Badge>
                      <div className="text-[11px] text-muted-foreground">
                        {isStale(r)
                          ? `last said ${CONNECTION_LABEL[r.connection_status] ?? r.connection_status}`
                          : `${CONNECTION_LABEL[r.connection_status] ?? r.connection_status} · ${r.db_mode}`}
                      </div>
                    </TableCell>
                    <TableCell>{ENGINE_LABEL[r.storage_engine] ?? r.storage_engine}</TableCell>
                    <TableCell className="text-right">
                      <span className={r.pending_count > 0 ? "font-semibold text-amber-600" : ""}>
                        {r.pending_count}
                      </span>
                      {r.conflict_count > 0 ? (
                        <div className="text-[11px] text-destructive">
                          {r.conflict_count} held back
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs">{when(r.last_synced_at)}</TableCell>
                    <TableCell className="text-xs">{when(r.last_seen_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy !== null}
                          onClick={() => void send(r, "refresh_catalog")}
                        >
                          Refresh data
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Telemetry History</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Completed and failed synchronization events. This history is separate from terminal
              registration and financial audit retention.
            </p>
          </div>
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null || history.length === 0}
              onClick={() => void clearHistory()}
            >
              <Trash2 className="mr-2 size-4" /> Clear history
            </Button>
          )}
        </div>
        <div className="mt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Terminal</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead>Data</TableHead>
                <TableHead className="text-right">Records</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                    No telemetry history recorded.
                  </TableCell>
                </TableRow>
              ) : (
                history.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="text-xs">{when(event.created_at)}</TableCell>
                    <TableCell className="text-xs">
                      {event.terminal_id ? event.terminal_id.slice(0, 8) : "—"}
                    </TableCell>
                    <TableCell className="capitalize">{event.direction}</TableCell>
                    <TableCell>{event.table_name}</TableCell>
                    <TableCell className="text-right">{event.records}</TableCell>
                    <TableCell>
                      <Badge variant={event.status === "failed" ? "destructive" : "secondary"}>
                        {event.status}
                      </Badge>
                      {event.error_message ? (
                        <div
                          className="max-w-xs truncate text-[11px] text-destructive"
                          title={event.error_message}
                        >
                          {event.error_message}
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">Recent requests</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          A request marked “waiting” means that till still has sales to send up; it retries on its
          own and runs as soon as the queue is empty.
        </p>
        <div className="mt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sent</TableHead>
                <TableHead>Terminal</TableHead>
                <TableHead>Request</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Outcome</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {commands.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                    No requests sent yet.
                  </TableCell>
                </TableRow>
              ) : (
                commands.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-xs">{when(c.created_at)}</TableCell>
                    <TableCell className="text-xs">{c.terminal_id.slice(0, 8)}</TableCell>
                    <TableCell>{COMMAND_LABEL[c.command] ?? c.command}</TableCell>
                    <TableCell className="text-xs">{c.issued_by ?? "—"}</TableCell>
                    <TableCell className="capitalize">
                      {c.status === "blocked" ? "waiting" : c.status}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {c.result ?? "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </>
  );
}
