/** Keep accepted status encodings aligned with electron/product-lifecycle.cjs. */
export function normalizeProductLifecycle(values: Record<string, unknown>) {
  for (const field of ["is_archived", "is_active"]) {
    const value = values[field];
    if (value === undefined) continue;
    if (value === true || value === 1 || value === "1" || value === "true") values[field] = true;
    else if (value === false || value === 0 || value === "0" || value === "false") values[field] = false;
    else throw new Error("Product status must be a boolean.");
  }
  return values;
}
