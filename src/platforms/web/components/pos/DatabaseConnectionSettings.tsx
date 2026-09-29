/**
 * Database connection — and nothing else.
 *
 * Everything about *where* this till reads and writes: the central (cloud)
 * project, the Microsoft SQL Server on this machine, which of the two is in
 * use, and the connection tests. Sync behaviour, queues and logs live on the
 * sync page; the two never share a screen again.
 */
import { CloudConnectionPanel } from "@/platforms/web/components/pos/settings/panels/CloudConnectionPanel";
import { ConnectionCheck } from "@/platforms/web/components/pos/ConnectionCheck";
import { useSystemStatus } from "@/lib/system-status";
import { isWindowsShell } from "@/platform-config/features";
import { useAuth } from "@/lib/pos-auth";
import { LocalDatabaseWizard } from "@/platforms/windows/components/LocalDatabaseWizard";
import { LocalDatabaseOperations } from "@/platforms/windows/components/LocalDatabaseOperations";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="numeric text-sm">{value}</p>
    </div>
  );
}

export function DatabaseConnectionSettings() {
  const status = useSystemStatus();
  const { isAdmin, can } = useAuth();
  const mayManageLocal = isAdmin || can("can_manage_sync_backup");

  return (
    <div className="w-full space-y-3">
      <div className="grid gap-2 rounded-md border border-border px-3 py-2 text-sm sm:grid-cols-2">
        <Stat
          label="Central database"
          value={status.connectivity === "online" ? "Reachable" : status.label}
        />
        <Stat
          label="Writing to"
          value={isWindowsShell() ? "Local SQL Server" : "Central database"}
        />
      </div>

      <CloudConnectionPanel presentation="dialog" />

      <ConnectionCheck />

      {isWindowsShell() && mayManageLocal && (
        <>
          <LocalDatabaseWizard />
          <LocalDatabaseOperations />
        </>
      )}
    </div>
  );
}
