import { recordId } from "./sale-identity";

/** Normalize identifier fields only. Names, codes and opaque tokens keep their case. */
export function normalizeUuidFields<T>(value: T): T {
  if (Array.isArray(value)) return value.map(normalizeUuidFields) as T;
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    typeof item === "string" && (key === "id" || key.endsWith("_id") || key.endsWith("Id"))
      ? recordId(item) : normalizeUuidFields(item),
  ])) as T;
}
