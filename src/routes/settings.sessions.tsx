import { formatDateTime as posDisplayDateTime } from "@/lib/time-zone";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SettingsFrame } from "@/platforms/web/components/pos/settings/SettingsFrame";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock3, Monitor, Smartphone, Store, LogOut } from "lucide-react";
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
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{activeRows.length} active {activeRows.length === 1 ? "session" : "sessions"}</span>
        <span>Updates automatically</span>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {activeRows.map((row) => {
          const DeviceIcon = /android|ios/i.test(row.platform ?? "") ? Smartphone : Monitor;
          return (
            <article key={row.id} className="min-w-0 rounded-xl border border-border bg-card p-3 sm:p-4">
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <DeviceIcon className="size-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="break-words text-sm font-medium leading-5">
                    {row.label || row.staff_user_id || "Unnamed device"}
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">
                      {row.kind === "terminal" ? "Terminal" : row.kind === "cashier" ? "Cashier" : "Staff"}
                    </Badge>
                    {row.platform && <span className="text-xs text-muted-foreground">{row.platform}</span>}
                  </div>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 text-xs">
                <div className="min-w-0">
                  <dt className="flex items-center gap-1 text-muted-foreground"><Store className="size-3" aria-hidden="true" />Branch</dt>
                  <dd className="mt-1 break-words">{row.branch_name || (row.branch_id ? "Unknown branch" : "No fixed branch")}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground">Device</dt>
                  <dd className="mt-1 break-words">{row.terminal_name || (row.terminal_id ? "Unnamed terminal" : "Browser session")}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="flex items-center gap-1 text-muted-foreground"><Clock3 className="size-3" aria-hidden="true" />Last active</dt>
                  <dd className="mt-1 break-words tabular-nums">{posDisplayDateTime(new Date(row.last_activity_at))}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Idle limit</dt>
                  <dd className="mt-1">{row.idle_timeout_minutes} min</dd>
                </div>
              </dl>
              <div className="mt-3 flex justify-end border-t border-border pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={row.is_revoked || busy === row.id}
                  onClick={() => void revoke(row.id)}
                  aria-label={`Remote reset for ${row.label || row.terminal_name || "this session"}`}
                >
                  <LogOut className="size-3.5" aria-hidden="true" />
                  {busy === row.id ? "Resetting…" : "Remote reset"}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
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
