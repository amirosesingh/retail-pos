/** A saved null means All stores. A selected viewing branch is not staff assignment. */
export function profileStoreAssignment(
  profile: { store_id?: string | null } | null | undefined,
  fallback?: string | null,
): string | null {
  const assigned = profile ? profile.store_id : fallback;
  return typeof assigned === "string" ? assigned.trim() || null : null;
}
