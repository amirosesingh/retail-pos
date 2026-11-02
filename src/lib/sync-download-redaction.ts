const ECOMMERCE_FIELDS: ReadonlySet<string> = new Set(["ecom_price", "ecom_visible", "ecom_enabled", "is_published"]);
const TERMINAL_SECRET_FIELDS: ReadonlySet<string> = new Set(["claim_secret_hash", "claim_proof", "claimed_proof_hash"]);

function setOwn(row: Record<string, unknown>, key: string, value: unknown) {
  // Match Object.fromEntries even for __proto__ or an inherited setter/readonly
  // property. Ordinary new keys take the inexpensive assignment path.
  if (key in row) Object.defineProperty(row, key, { value, enumerable: true, configurable: true, writable: true });
  else row[key] = value;
}

function priceSettingsValue(value: Record<string, unknown>) {
  const copy: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key !== "ecom_price") setOwn(copy, key, child);
  }
  return copy;
}

/** Activation proofs are credentials, not business data for another till. */
export function redactSyncDownload(value: unknown, table = "", management = false): unknown {
  if (Array.isArray(value)) return value.map(row => redactSyncDownload(row, table, management));
  if (!value || typeof value !== "object") return value;
  let row = value as Record<string, unknown>;
  if (!management && (table === "settings_scoped" || row.table_name === "settings_scoped") && typeof row.key === "string" && row.key.startsWith("product_price:") && row.value && typeof row.value === "object") {
    row = { ...row, value: priceSettingsValue(row.value as Record<string, unknown>) };
  }
  const context = typeof row.table_name === "string" ? row.table_name : table;
  const copy: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(row)) {
    if ((context === "terminal_tokens" && TERMINAL_SECRET_FIELDS.has(key)) || (!management && ((context === "products" && ECOMMERCE_FIELDS.has(key)) || key === "ecommerceEnabled"))) continue;
    setOwn(copy, key, redactSyncDownload(child, context, management));
  }
  return copy;
}
