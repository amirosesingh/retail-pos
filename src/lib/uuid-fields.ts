import { recordId } from "./sale-identity";
import { canonicalStockMap } from "./branch-id";

const identifier = (key: string) => key === "id" || key.endsWith("_id") || key.endsWith("Id");
const identifierList = (key: string) => key.endsWith("_ids") || key.endsWith("Ids");
const jsonFields = new Set(["lines", "items", "payments", "value", "patch", "stock_by_store", "stockByStore"]);

/** Normalize identities at data boundaries, while preserving codes and opaque credentials. */
export function normalizeUuidFields<T>(value: T): T {
  if (Array.isArray(value)) {
    const normalized = value.map(normalizeUuidFields);
    return (normalized.every((item, index) => item === value[index]) ? value : normalized) as T;
  }
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return value;
  const entries = Object.entries(value).map(([key, item]) => {
    if (typeof item === "string" && identifier(key)) return [key, recordId(item)];
    if (Array.isArray(item) && identifierList(key)) {
      const normalized = item.map(entry => typeof entry === "string" ? recordId(entry) : normalizeUuidFields(entry));
      return [key, normalized.every((entry, index) => entry === item[index]) ? item : normalized];
    }
    if (typeof item === "string" && jsonFields.has(key)) {
      try {
        const parsed: unknown = JSON.parse(item);
        const normalized = normalizeUuidFields({ [key]: parsed }) as Record<string, unknown>;
        return [key, JSON.stringify(parsed) === JSON.stringify(normalized[key]) ? item : JSON.stringify(normalized[key])];
      } catch { return [key, item]; }
    }
    if ((key === "stock_by_store" || key === "stockByStore") && item && typeof item === "object" && !Array.isArray(item)) {
      const normalized = canonicalStockMap(item);
      const original = item as Record<string, unknown>;
      return [key, Object.keys(original).length === Object.keys(normalized).length &&
        Object.entries(normalized).every(([id, quantity]) => original[id] === quantity) ? item : normalized];
    }
    return [key, normalizeUuidFields(item)];
  });
  const original = value as Record<string, unknown>;
  return entries.every(([key, item]) => original[key as string] === item) ? value : Object.fromEntries(entries) as T;
}
