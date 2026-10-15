const { normalizeUuidFields } = require("./uuid-fields.cjs");
/** Journal delete keys are JSON text, so ordinary field normalization cannot see their UUIDs. */
function normalizeSyncPayload(value) {
  const normalized = normalizeUuidFields(value);
  function visit(item) {
    if (Array.isArray(item)) return item.map(visit);
    if (!item || typeof item !== "object" || Object.getPrototypeOf(item) !== Object.prototype) return item;
    return Object.fromEntries(Object.entries(item).map(([key,child]) => {
      if (["entity_id", "entityId"].includes(key) && typeof child === "string") {
        try {
          const decoded = JSON.parse(child);
          if (decoded && typeof decoded === "object") return [key, JSON.stringify(normalizeUuidFields(decoded))];
        } catch { /* Plain keys remain ordinary identifiers. */ }
      }
      return [key, visit(child)];
    }));
  }
  return visit(normalized);
}
module.exports = { normalizeSyncPayload };
