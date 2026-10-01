/**
 * Quiet background reporter.
 *
 * Every minute this till tells the monitoring centre how it is doing, and
 * checks whether an administrator has asked it to sync or refresh its data.
 * It never changes anything the operator can see.
 */
import { useEffect } from "react";
import { useAuth } from "@/lib/pos-auth";
import { publishTelemetry } from "@/lib/telemetry";
import { runPendingCommands } from "@/lib/terminal-commands";
import { hasSignedInIdentity } from "@/lib/session-presence";
import { isWindowsShell } from "@/platform-config/features";
import { localDb } from "@/core/local-db/local-db";
import { hasStaffSession } from "@/core/api/sync-relay";

export function TelemetryAgent() {
  const { user, terminalUser } = useAuth();
  const name = user?.name ?? terminalUser?.name ?? null;
  const role = user?.role ?? terminalUser?.role ?? null;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isWindowsShell()) {
      void localDb()?.telemetry?.presence({
        sessionStatus: name ? "signed_in" : "idle",
        staffName: name,
        staffRole: role,
      });
      return;
    }
    let stopped = false;

    const refreshCatalogue = async () => {
      // Reload once the queue is clear so every screen picks up the fresh copy.
      window.setTimeout(() => window.location.reload(), 1500);
    };

    const beat = async () => {
      if (stopped) return;
      if (document.visibilityState === "hidden") return;
      // A visitor on the sign-in screen is not a till in service: reporting
      // before anyone signs in would only be rejected by the database.
      if (!hasSignedInIdentity()) return;
      await publishTelemetry({ name, role });
      // terminal_commands is deliberately hidden from anon. PIN/session-token
      // users reconcile through the protected relay; only a staff JWT may
      // query this table directly from a browser.
      if (!hasStaffSession()) return;
      try {
        await runPendingCommands(refreshCatalogue);
      } catch {
        /* commands are best-effort */
      }
    };

    void beat();
    const timer = window.setInterval(() => void beat(), 60_000);
    const online = () => void beat();
    window.addEventListener("online", online);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("online", online);
    };
  }, [name, role]);

  return null;
}
