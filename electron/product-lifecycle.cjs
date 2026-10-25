/** Canonical values are shared by permission checks and persistence. */
function productBoolean(value) {
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  throw Object.assign(new Error("Product status must be a boolean."), { code: "PERMISSION_DENIED" });
}
function normalizeProductLifecycle(values) {
  for (const field of ["is_archived", "is_active"]) {
    if (values[field] !== undefined) values[field] = productBoolean(values[field]);
  }
  return values;
}
function productLifecyclePermission(field, value) {
  if (field === "is_archived") return value ? "can_archive_product" : "can_restore_product";
  if (field === "is_active") return value ? "can_restore_product" : "can_archive_product";
  if (field === "archived_at" || field === "deleted_at") return value == null ? "can_restore_product" : "can_archive_product";
  return null;
}
module.exports = { normalizeProductLifecycle, productLifecyclePermission };
