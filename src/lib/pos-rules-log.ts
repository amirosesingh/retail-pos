/**
 * Structured diagnostics for the register rules.
 *
 * Identifiers only: a branch id, a terminal id, a platform name, a failure
 * category and a revision stamp. Never a token, PIN, signing key or database
 * key.
 */
export type RulesLogEvent =
  | "POS_RULES_SYNC_STARTED"
  | "POS_RULES_SYNC_SUCCESS"
  | "POS_RULES_REVISION_CHANGED"
  | "POS_RULES_USING_LAST_KNOWN_GOOD"
  | "POS_RULES_NOT_VERIFIED"
  | "POS_RULES_IDENTITY_UNAVAILABLE"
  | "POS_RULES_LOAD_FAILED"
  | "POS_RULES_SAVE_QUEUED"
  | "POS_RULES_SAVE_CONFIRMED"
  | "POS_RULES_PENDING_IN_FORCE"
  | "POS_RULES_PENDING_ABANDONED";

export function logRules(event: RulesLogEvent, fields: Record<string, string | number>): void {
  // Routine refreshes happen every minute and need no browser-console noise.
  // Keep only actionable failures visible to operators and support staff.
  if (event !== "POS_RULES_LOAD_FAILED") return;
  // The shell mounts before sign-in and terminal activation. No identity at
  // that point is an expected state, not a failed configuration.
  if (fields.category === "none") return;
  const line = Object.entries(fields)
    .filter(([, v]) => v !== "" && v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  const text = line ? `${event} ${line}` : event;
  if (import.meta.env.DEV) console.warn(text);
}
