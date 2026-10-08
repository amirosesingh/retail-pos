import { sameBranchId } from "@/lib/branch-id";
import type { localDb } from "@/core/local-db/local-db";
import type { Store } from "@/core/types/pos-types";

export type LocationDirectoryResult =
  { ok: true; stores: Store[]; source: "relay" | "direct" | "local" } | { ok: false; error: Error };

type DirectoryBridge = Pick<NonNullable<ReturnType<typeof localDb>>, "database" | "query">;

/** Only query a usable SQL replica; a scoped read can still fail during pairing. */
export async function readLocalLocationDirectory(
  bridge: DirectoryBridge | null,
  localFirst: boolean,
  mapStore: (row: Record<string, unknown>) => Store,
): Promise<LocationDirectoryResult | null> {
  if (!bridge?.query || !localFirst) return null;
  if (bridge.database?.getState) {
    const state = await bridge.database.getState();
    if (!state.enabled || !state.connected || state.tradingReady === false) return null;
  }
  const result = await bridge.query("stores", { limit: 2000 });
  if (!result.ok)
    return { ok: false, error: new Error(result.error ?? "Could not read local locations.") };
  return { ok: true, stores: (result.rows ?? []).map(mapStore), source: "local" };
}

/** A local replica that is unavailable or not seeded must not block discovery. */
export async function resolveLocationDirectory(
  localRead: () => Promise<LocationDirectoryResult | null>,
  cloudRead: () => Promise<LocationDirectoryResult>,
  branchId?: string | null,
): Promise<LocationDirectoryResult> {
  let local: LocationDirectoryResult | null;
  try {
    local = await localRead();
  } catch (error) {
    local = { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
  if (local) local = verifyTerminalLocation(local, branchId);
  if (local?.ok && local.stores.length) return local;
  try {
    const cloud = verifyTerminalLocation(await cloudRead(), branchId);
    if (cloud.ok) return cloud;
    // A ready, branch-scoped local read is still authoritative while offline.
    if (local?.ok) return local;
    return cloud;
  } catch (error) {
    if (local?.ok) return local;
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/** A registered device never substitutes the first unrelated directory entry. */
export function verifyTerminalLocation(
  result: LocationDirectoryResult,
  branchId?: string | null,
): LocationDirectoryResult {
  if (
    !result.ok ||
    !branchId ||
    result.stores.some(
      (store) => sameBranchId(store.id, branchId) && store.active !== false && !store.archivedAt,
    )
  )
    return result;
  return {
    ok: false,
    error: new Error(
      "This terminal's registered branch is not available. Check its activation and branch status in Database connection settings.",
    ),
  };
}

/** Staff terminals stay paired; administrator screens may view other branches. */
export function canSelectLocation(
  id: string,
  boundId: string | null | undefined,
  isAdmin: boolean,
): boolean {
  return isAdmin || !boundId || sameBranchId(id, boundId);
}
