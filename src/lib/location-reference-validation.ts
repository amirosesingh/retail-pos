type LocationReference = {
  id: string;
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
  const groupId = draft.groupId?.trim();
  if (groupId && !groups.some((group) => group.id === groupId)) {
    return "The selected group no longer exists. Choose another group or No group.";
  }

  const parentId = draft.parentId?.trim();
  const locationId = draft.id?.trim();
  if (parentId && parentId === locationId) {
    return "A location cannot be its own parent.";
  }
  if (parentId && !locations.some((location) => location.id === parentId)) {
    return "The selected parent location no longer exists. Choose another parent or None.";
  }

  return null;
}
