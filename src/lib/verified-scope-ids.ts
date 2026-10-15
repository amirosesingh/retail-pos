import { sameBranchId } from "./branch-id";
import { sameRecordId } from "./sale-identity";

/** Resolve casing aliases to trusted legacy text keys; never redirect a different branch. */
export function alignVerifiedScopeIds<T>(value: T, scope: { storeId?: string | null; terminalId?: string | null }, table = ""): T {
  if (Array.isArray(value)) return value.map(item => alignVerifiedScopeIds(item, scope, table)) as T;
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return value;
  const row = value as Record<string, unknown>;
  const context = typeof row.table === "string" ? row.table : table;
  const tier = String(row.scope ?? row.scope_type ?? "").toLowerCase();
  return Object.fromEntries(Object.entries(row).map(([key, item]) => {
    const branchField = /(?:store|branch|location)_?id$/i.test(key) ||
      (context === "stores" && ["id", "parent_id", "parentId"].includes(key)) ||
      (["scope_id", "scopeId"].includes(key) && tier === "branch");
    const terminalField = /terminal_?id$/i.test(key) ||
      (["scope_id", "scopeId"].includes(key) && tier === "terminal");
    if (typeof item === "string") {
      if (branchField && scope.storeId && sameBranchId(item, scope.storeId)) return [key, scope.storeId];
      if (terminalField && scope.terminalId && sameRecordId(item, scope.terminalId)) return [key, scope.terminalId];
      if (["entity_id", "entityId"].includes(key)) {
        try {
          const decoded: unknown = JSON.parse(item);
          if (decoded && typeof decoded === "object") return [key, JSON.stringify(alignVerifiedScopeIds(decoded, scope, context))];
        } catch { /* Ordinary opaque entity keys retain their spelling. */ }
      }
    }
    return [key, alignVerifiedScopeIds(item, scope, context)];
  })) as T;
}
