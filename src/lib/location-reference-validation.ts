import { canonicalBranchId } from "./branch-id";
type LocationReference = {
  id: string;
  parentId?: string | null;
  active?: boolean;
  archivedAt?: string | null;
};

type GroupReference = {
  id: string;
};

export type LocationReferenceDraft = {
  id?: string | null;
  groupId?: string | null;
  parentId?: string | null;
};

/**
 * Reject references retained by an old browser/Electron cache after their
 * central record was removed. This keeps a stale picker value from reaching a
 * foreign-key constraint and gives the operator an actionable recovery path.
 */
export function validateLocationReferences(
  draft: LocationReferenceDraft,
  locations: readonly LocationReference[],
  groups: readonly GroupReference[],
): string | null {
  locations = locations.map((location) => ({
    ...location,
    id: canonicalBranchId(location.id),
    parentId: location.parentId ? canonicalBranchId(location.parentId) : location.parentId,
  }));
  const groupId = draft.groupId?.trim();
  if (groupId && !groups.some((group) => group.id === groupId)) {
    return "The selected group no longer exists. Choose another group or No group.";
  }

  const parentId = canonicalBranchId(draft.parentId);
  const locationId = canonicalBranchId(draft.id);
  if (parentId && parentId === locationId) {
    return "A location cannot be its own parent.";
  }
  if (parentId && !locations.some((location) => location.id === parentId)) {
    return "The selected parent location no longer exists. Choose another parent or None.";
  }

  if (parentId) {
    const parent = locations.find((location) => location.id === parentId);
    if (parent?.active === false || parent?.archivedAt)
      return "The selected parent location is archived. Choose an active parent.";
    const visited = new Set<string>();
    let cursor = parent;
    while (cursor) {
      if (cursor.id === locationId || visited.has(cursor.id))
        return "The selected parent would create a location hierarchy cycle.";
      visited.add(cursor.id);
      cursor = cursor.parentId
        ? locations.find((location) => location.id === cursor!.parentId)
        : undefined;
    }
  }

  return null;
}
