import { useSyncExternalStore } from "react";
import { effectiveDatabaseMode, subscribeDatabaseMode } from "@/core/local-db/db-mode";
import { useAuth } from "@/lib/pos-auth";
import { usePos } from "@/lib/pos-store";
import { sessionEpoch } from "@/lib/session-epoch";
import { offlineSnapshotScope } from "@/lib/offline-gate-visibility";
import { useOfflineGateSnapshot } from "@/lib/offline-gate-snapshot-context";

/** Reports the existing authoritative snapshot; does not load or grant data. */
export function OfflineGateSnapshot() {
  const auth = useAuth();
  const pos = usePos();
  const mode = useSyncExternalStore(subscribeDatabaseMode,effectiveDatabaseMode,() => "online");
  useOfflineGateSnapshot(offlineSnapshotScope({
    authReady: auth.ready,
    // PosProvider.ready requires the loaded primary snapshot's identity to
    // match this person, database mode and selected branch; sign-in is not enough.
    dataReady: pos.ready,
    active: Boolean(auth.user) && auth.appUser?.is_active !== false,
    personId: auth.user?.staffId || auth.authUserId || auth.terminalUser?.userCode,
    branchId: pos.currentStore?.id,
    accountBranchId: auth.user?.storeId,
    epoch: sessionEpoch(),
    mode,
    role: auth.user ? `${auth.user.role}:${auth.user.metaRole ?? ""}` : null,
    roles: auth.user?.roles ?? [],
    permissions: auth.user?.permissions ?? {},
  }));
  return null;
}
