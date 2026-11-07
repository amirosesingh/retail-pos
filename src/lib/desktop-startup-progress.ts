import type { LocalStartupState } from "./local-startup";
export type StartupActivity = {
  active: boolean;
  paused?: boolean;
  phase: string;
  table?: string;
  processedRows?: number;
  failure?: "blocked" | "temporary";
  reason?: string;
  updatedAt?: string;
};
export type StartupPresentation = {
  active: boolean;
  message: string;
  detail?: string;
  notice?: string;
};
type Database = {
  getState(): Promise<LocalStartupState>;
  subscribe?: (cb: (state: LocalStartupState) => void) => () => void;
  onStartupActivity?: (cb: (value: StartupActivity | null) => void) => () => void;
};
/** Activity updates are isolated from database state: they must never reload providers. */
export function observeDesktopStartup(
  database: Database,
  updateDatabase: (state: LocalStartupState | null) => void,
  updateActivity: (activity: StartupActivity | null) => void,
  sync?: {
    subscribe?: (cb: (state: { paused?: boolean }) => void) => () => void;
  },
  updatePaused: (paused: boolean) => void = () => {},
): () => void {
  let active = true,
    databaseRevision = 0,
    activityRevision = 0,
    syncRevision = 0;
  const offSync = sync?.subscribe?.((state) => {
    syncRevision++;
    if (active) updatePaused(state.paused === true);
  });
  const initialSyncRevision = syncRevision;
  const offActivity = database.onStartupActivity?.((value) => {
    activityRevision++;
    if (active) updateActivity(value);
  });
  const offDatabase = database.subscribe?.((state) => {
    databaseRevision++;
    if (active) {
      if (Object.prototype.hasOwnProperty.call(state, "startupActivity")) {
        activityRevision++;
        updateActivity(state.startupActivity ?? null);
      }
      updateDatabase(state);
    }
  });
  const initialDatabaseRevision = databaseRevision,
    initialActivityRevision = activityRevision;
  void database.getState().then(
    (state) => {
      if (!active) return;
      if (syncRevision === initialSyncRevision) updatePaused(state.startupPaused === true);
      if (activityRevision === initialActivityRevision)
        updateActivity(state.startupActivity ?? null);
      if (databaseRevision === initialDatabaseRevision) updateDatabase(state);
    },
    () => {
      if (active && databaseRevision === initialDatabaseRevision) updateDatabase(null);
    },
  );
  return () => {
    active = false;
    offDatabase?.();
    offActivity?.();
    offSync?.();
  };
}
const TABLES: Record<string, string> = {
  products: "Products",
  product_barcodes: "Product barcodes",
  product_categories: "Categories",
  pos_settings: "Store settings",
  audit_logs: "Audit history",
  change_history: "Change history",
  shifts: "Shifts",
  shift_cash_counts: "Shift counts",
  shift_reconciliations: "Shift reconciliation",
  sales: "Sales",
  sale_items: "Sale lines",
  stock_transfers: "Stock transfers",
  stock_transfer_items: "Transfer items",
  bookings: "Bookings",
  users: "Staff",
  stores: "Branches",
  store_groups: "Clusters",
};
const PHASES: Record<string, string> = {
  metadata_packagecheck: "Checking the recovery update…",
  metadata_probe: "Checking local recovery support…",
  metadata_backing_up: "Backing up the local database…",
  metadata_verifying_backup: "Verifying the database backup…",
  metadata_installing: "Preparing local recovery support…",
  metadata_readback: "Verifying local recovery support…",
  preparing: "Preparing local store data…",
  authorizing: "Checking authorized store access…",
  uploading: "Uploading saved changes…",
  downloading: "Downloading store data…",
  applying: "Saving downloaded data locally…",
  checking: "Checking local store data…",
  retaining: "Finishing local data maintenance…",
};
export function startupPresentation(
  activity: StartupActivity | null,
  fallback: string,
  syncPaused = false,
): StartupPresentation {
  const paused = syncPaused || activity?.paused;
  const blocker =
    activity?.failure === "blocked"
      ? activity.reason === "shift-data"
        ? "Shift records need reconciliation before recovery can finish. Saved transactions remain intact."
        : "Startup needs attention. Open database recovery to check the connection and authorization."
      : undefined;
  const notice =
    [
      blocker,
      paused
        ? "Synchronization is paused. Resume it from Sync & Data when ready."
        : !blocker && activity?.failure === "temporary"
          ? "The connection did not answer. Automatic synchronization will retry using its normal schedule."
          : undefined,
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  const table = activity?.table ? (TABLES[activity.table] ?? "Store data") : undefined;
  const rows = activity?.processedRows;
  return {
    active: activity?.active === true,
    message: activity?.active
      ? (PHASES[activity.phase] ?? "Preparing local store data…")
      : paused
        ? "Synchronization paused"
        : notice
          ? "Waiting for database recovery"
          : fallback,
    detail: activity?.active
      ? [
          table,
          (activity?.phase === "applying" || activity?.phase === "downloading") &&
          rows !== undefined &&
          rows > 0
            ? `${rows.toLocaleString()} rows saved locally`
            : null,
        ]
          .filter(Boolean)
          .join(" · ") || undefined
      : undefined,
    notice,
  };
}
