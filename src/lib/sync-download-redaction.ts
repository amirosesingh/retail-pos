/** Activation proofs are credentials, not business data for another till. */
export function redactSyncDownload(value: unknown, table = ""): unknown {
  if (Array.isArray(value)) return value.map(row => redactSyncDownload(row, table));
  if (!value || typeof value !== "object") return value;
  const row = value as Record<string, unknown>;
  const context = typeof row.table_name === "string" ? row.table_name : table;
  const secret = new Set(["claim_secret_hash", "claim_proof", "claimed_proof_hash"]);
  return Object.fromEntries(Object.entries(row)
    .filter(([key]) => context !== "terminal_tokens" || !secret.has(key))
    .map(([key, child]) => [key, redactSyncDownload(child, context)]));
}
