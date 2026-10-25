import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "@tanstack/react-router";
import { isRecoveryPath } from "@/lib/recovery-route";
import { TillLoader } from "@/components/shared/TillLoader";
import { desktopStorageRoute } from "@/lib/desktop-storage-route";
import { observeLocalStartup } from "@/lib/local-startup";
import { ONLINE_STARTUP_OVERRIDE, setStartupOnlineMode } from "@/core/local-db/db-mode";
import { toast } from "sonner";

/** Resolve storage before any page/provider starts querying the desktop bridge. */
export function NativeBoot({ children }: { children: ReactNode }) {
  const path = useLocation({ select: location => location.pathname });
  const recovery = path === "/database-startup" || isRecoveryPath(path);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const api = window.pos?.database;
    if (!api) { setError("The desktop database bridge is unavailable. Restart the app."); return; }
    return observeLocalStartup(api, state => {
      const route = desktopStorageRoute(state);
      if (route === "local" || route === "online") toast.dismiss("pos-local-database-disconnected");
      if (route === "online") setStartupOnlineMode(true);
      if (route === "local") setStartupOnlineMode(false);
      // Use the saved cloud connection during a SQL outage. Return to SQL only
      // after its schema/bootstrap is trading-ready; leave its pending outbox intact.
      if (route !== "pending" || window.sessionStorage.getItem(ONLINE_STARTUP_OVERRIDE) === "1") setReady(true);
      if (!state) setError("Could not read the local database status. Open database recovery.");
    });
  }, []);
  if (ready || recovery) return children;
  return <div className="space-y-3 p-4"><TillLoader message={error || "Checking the local SQL Server connection…"} /><a className="text-sm underline" href="/database-startup">Open database recovery</a></div>;
}
