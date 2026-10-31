const ECOMMERCE_FIELDS: ReadonlySet<string> = new Set(["ecom_price", "ecom_visible", "ecom_enabled", "is_published"]);
const TERMINAL_SECRET_FIELDS: ReadonlySet<string> = new Set(["claim_secret_hash", "claim_proof", "claimed_proof_hash"]);

/** Activation proofs are credentials, not business data for another till. */
export function redactSyncDownload(value: unknown, table = "", management = false): unknown {
  if (Array.isArray(value)) return value.map(row => redactSyncDownload(row, table, management));
  if (!value || typeof value !== "object") return value;
  let row = value as Record<string, unknown>;
  if (!management && (table === "settings_scoped" || row.table_name === "settings_scoped") && typeof row.key === "string" && row.key.startsWith("product_price:") && row.value && typeof row.value === "object") {
    row = { ...row, value: Object.fromEntries(Object.entries(row.value as Record<string, unknown>).filter(([key]) => key !== "ecom_price")) };
  }
  const context = typeof row.table_name === "string" ? row.table_name : table;
  return Object.fromEntries(Object.entries(row)
    .filter(([key]) => (context !== "terminal_tokens" || !TERMINAL_SECRET_FIELDS.has(key)) && (management || context !== "products" || !ECOMMERCE_FIELDS.has(key)) && (management || key !== "ecommerceEnabled"))
    .map(([key, child]) => [key, redactSyncDownload(child, context, management)]));
}
