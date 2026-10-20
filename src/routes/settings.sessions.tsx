import { formatDateTime as posDisplayDateTime } from "@/lib/time-zone";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SettingsFrame } from "@/platforms/web/components/pos/settings/SettingsFrame";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LogOut } from "lucide-react";
import { adminAccessToken } from "@/lib/admin-session";
import { listDeviceSessions, revokeDeviceSessions } from "@/lib/user-sessions-client";
import { subscribeBackgroundRefresh, createRefreshQueue } from "@/lib/background-refresh";
import { isVisibleActiveSession } from "@/lib/session-activity";
import { isConnectionError } from "@/core/local-db/db-mode";

type Row = {
  id: string;
  kind: string;
  label: string | null;
  staff_user_id: string | null;
  branch_id: string | null;
  branch_name?: string | null;
  terminal_id: string | null;
  terminal_name?: string | null;
  platform: string | null;
  idle_timeout_minutes: number;
  last_activity_at: string;
  is_revoked: boolean;
  created_at: string;
};

function ActiveSessions() {
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const resetIds = useRef(new Set<string>());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const accessToken = await adminAccessToken();
      if (!accessToken) {
        setError("Sign in with an administrator account to manage terminals.");
        setLoading(false);
        return;
      }
      const res = await listDeviceSessions({ data: { accessToken } });
      setOffline(false);
      setError(res.ok ? "" : res.error);
      setRows(((res.sessions ?? []) as Row[]).filter(row => !resetIds.current.has(row.id)));
    } catch (e) {
      // Who is signed in right now can only be answered centrally, so say so
      // plainly instead of showing a red failure.
      setOffline(isConnectionError(e));
      setError(isConnectionError(e) ? "" : "Could not load active sessions. Please retry.");
    } finally {
      setNow(Date.now());
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const queue = createRefreshQueue(load);
    void queue.refresh();
    const off = subscribeBackgroundRefresh(() => { setNow(Date.now()); void queue.refresh(); }, 30_000);
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => { off(); queue.stop(); window.clearInterval(timer); };
  }, [load]);

  const revoke = async (id: string) => {
    setBusy(id);
    try {
      const accessToken = await adminAccessToken();
      const res = await revokeDeviceSessions({
        data: { accessToken, sessionId: id, reason: "remote reset" },
      });
      if (!res.ok) { toast.error(res.error); return; }
      resetIds.current.add(id);
      setRows(current => current.filter(row => row.id !== id));
      toast.success("Terminal signed out. It will return to the sign-in screen on its next call.");
      void load();
    } catch {
      toast.error("Could not reset the session. Check the connection and retry.");
    } finally { setBusy(null); }
  };

  const activeRows = rows.filter(row => isVisibleActiveSession(row, now));

  const pageCount = Math.max(1, Math.ceil(activeRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = activeRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  if (loading) return <p className="text-sm text-muted-foreground">Loading sessions…</p>;
  if (offline)
    return (
      <p className="text-sm text-muted-foreground">
        Connection is down. Signed-in terminals are only known centrally, so this list and remote
        reset return as soon as the line is back.
      </p>
    );
  if (error) return <div className="space-y-2"><p className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={() => void load()}>Retry</Button></div>;
  if (!activeRows.length)
    return <p className="text-sm text-muted-foreground">Nobody is signed in right now.</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{activeRows.length} active {activeRows.length === 1 ? "session" : "sessions"}</span>
        <span>Updates automatically</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">Active sessions, page {currentPage} of {pageCount}</caption>
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">User / device</th>
              <th scope="col" className="px-3 py-2 font-medium">Activity</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visibleRows.map(row => (
              <tr key={row.id} className="align-top">
                <td className="px-3 py-3">
                  <div className="break-words text-sm font-medium">{row.label || row.staff_user_id || "Unnamed device"}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {[row.kind === "terminal" ? "Terminal" : row.kind === "cashier" ? "Cashier" : "Staff",
                      row.platform,
                      row.branch_name || (row.branch_id ? "Unknown branch" : "No fixed branch"),
                      row.terminal_name || (row.terminal_id ? "Unnamed terminal" : "Browser session")]
                      .filter(Boolean).map((label, index) => (
                        <Badge key={index} variant="secondary" className="max-w-full whitespace-normal break-words px-1.5 py-0 text-[10px] font-normal">{label}</Badge>
                      ))}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <div className="text-muted-foreground">Last active</div>
                  <div className="mt-1 tabular-nums">{posDisplayDateTime(new Date(row.last_activity_at))}</div>
                  <Badge variant="outline" className="mt-1 whitespace-normal px-1.5 py-0 text-[10px] font-normal">Idle limit {row.idle_timeout_minutes} min</Badge>
                </td>
                <td className="px-2 py-2 text-right">
                  <Button variant="ghost" size="sm"
                    className="gap-1 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={row.is_revoked || busy === row.id}
                    onClick={() => void revoke(row.id)}
                    aria-label={`Remote reset for ${row.label || row.terminal_name || "this session"}`}>
                    <LogOut className="size-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">{busy === row.id ? "Resetting…" : "Reset"}</span>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <nav aria-label="Session pages" className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">Page {currentPage} of {pageCount} · {activeRows.length} sessions</span>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</Button>
          <Button variant="outline" size="sm" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</Button>
        </div>
      </nav>
    </div>
  );
}

export const Route = createFileRoute("/settings/sessions")({
  head: () => ({
    meta: [
      { title: "Active Sessions — POS Settings" },
      {
        name: "description",
        content:
          "See every terminal signed in to the POS and sign any of them out instantly from one place.",
      },
      { property: "og:title", content: "Active Sessions — POS Settings" },
      {
        property: "og:description",
        content: "Live list of signed-in tills with an instant remote sign-out.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <SettingsFrame
      showSaveBar={false}
      permission="can_manage_terminals"
      wide
      title="Active sessions"
      description="Active in the last 24 hours. Remote reset signs the device out on its next request."
    >
      <ActiveSessions />
    </SettingsFrame>
  ),
});
