/**
 * Create an offline-safe member code.
 *
 * A row count is not a sequence: two tills can have the same count, and an
 * archived row still owns its unique code. Time plus a UUID fragment avoids
 * both collisions without requiring the cloud to be reachable.
 */
export function newMemberCode(): string {
  return `MB-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}
