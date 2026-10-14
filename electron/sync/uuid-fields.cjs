const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const recordId = value => typeof value === "string" && UUID.test(value) ? value.toLowerCase() : value;
const identifier = key => key === "id" || key.endsWith("_id") || key.endsWith("Id");
const identifierList = key => key.endsWith("_ids") || key.endsWith("Ids");
const jsonFields = new Set(["lines", "items", "payments", "value", "patch", "stock_by_store", "stockByStore"]);
function canonicalStockMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [rawId, rawQuantity] of Object.entries(value)) {
    const id = recordId(rawId.trim());
    const quantity = Number(rawQuantity);
    if (id && Number.isFinite(quantity)) result[id] = (result[id] ?? 0) + quantity;
  }
  return result;
}
function normalizeUuidFields(value) {
  if (Array.isArray(value)) return value.map(normalizeUuidFields);
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (typeof item === "string" && identifier(key)) return [key, recordId(item)];
    if (Array.isArray(item) && identifierList(key)) return [key, item.map(entry => typeof entry === "string" ? recordId(entry) : normalizeUuidFields(entry))];
    if (typeof item === "string" && jsonFields.has(key)) {
      try {
        const parsed = JSON.parse(item);
        const normalized = normalizeUuidFields({ [key]: parsed });
        return [key, JSON.stringify(parsed) === JSON.stringify(normalized[key]) ? item : JSON.stringify(normalized[key])];
      } catch { return [key, item]; }
    }
    if ((key === "stock_by_store" || key === "stockByStore") && item && typeof item === "object" && !Array.isArray(item))
      return [key, canonicalStockMap(item)];
    return [key, normalizeUuidFields(item)];
  }));
}
module.exports = { recordId, normalizeUuidFields };
