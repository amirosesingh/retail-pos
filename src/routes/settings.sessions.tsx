import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SettingsFrame } from "@/platforms/web/components/pos/settings/SettingsFrame";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
    <div className="space-y-2">
      {activeRows.map((row) => (
        <div
          key={row.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">
                {row.label || row.staff_user_id || "Unnamed device"}
              </span>
              <Badge variant={row.is_revoked ? "outline" : "secondary"}>
                {row.is_revoked ? "Signed out" : row.kind}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {[
                row.platform,
                row.branch_name || (row.branch_id ? "Unknown branch" : null),
                row.terminal_name || (row.terminal_id ? "Unnamed terminal" : null),
                `Idle limit ${row.idle_timeout_minutes} min`,
                `Last seen ${new Date(row.last_activity_at).toLocaleString()}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            disabled={row.is_revoked || busy === row.id}
            onClick={() => void revoke(row.id)}
          >
            {busy === row.id ? "Resetting…" : "Remote reset"}
          </Button>
        </div>
      ))}
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
      description="Current sessions with activity in the last 24 hours. Signed-out, reset and idle-expired sessions are excluded. A remote reset ends that session at once — the terminal returns to the sign-in screen on its next call."
    >
      <ActiveSessions />
    </SettingsFrame>
  ),
});
