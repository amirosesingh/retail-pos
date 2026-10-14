import { recordId } from "./sale-identity";
import { canonicalStockMap } from "./branch-id";

const identifier = (key: string) => key === "id" || key.endsWith("_id") || key.endsWith("Id");
const identifierList = (key: string) => key.endsWith("_ids") || key.endsWith("Ids");
const jsonFields = new Set(["lines", "items", "payments", "value", "patch", "stock_by_store", "stockByStore"]);

/** Normalize identities at data boundaries, while preserving codes and opaque credentials. */
export function normalizeUuidFields<T>(value: T): T {
  if (Array.isArray(value)) return value.map(normalizeUuidFields) as T;
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (typeof item === "string" && identifier(key)) return [key, recordId(item)];
    if (Array.isArray(item) && identifierList(key))
      return [key, item.map(entry => typeof entry === "string" ? recordId(entry) : normalizeUuidFields(entry))];
    if (typeof item === "string" && jsonFields.has(key)) {
      try {
        const parsed: unknown = JSON.parse(item);
        const normalized = normalizeUuidFields({ [key]: parsed }) as Record<string, unknown>;
        return [key, JSON.stringify(parsed) === JSON.stringify(normalized[key]) ? item : JSON.stringify(normalized[key])];
      } catch { return [key, item]; }
    }
    if ((key === "stock_by_store" || key === "stockByStore") && item && typeof item === "object" && !Array.isArray(item))
      return [key, canonicalStockMap(item)];
    return [key, normalizeUuidFields(item)];
  })) as T;
}
