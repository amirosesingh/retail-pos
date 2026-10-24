/** Requester authority comes from the branch rules, never the request body. */
export async function loadRequesterDirectLimit(actionKey: string, storeId: string): Promise<number> {
  if (actionKey !== "discount_over_limit" && actionKey !== "manual_discount") return 0;
  const { loadRulesResult } = await import("./pos-rules.server");
  const result = await loadRulesResult(storeId);
  if (result.source !== "database") throw new Error("Current discount rules could not be verified");
  const limit = result.rules.max_cashier_discount_percent;
  if (!Number.isFinite(limit) || limit < 0) throw new Error("Invalid configured discount limit");
  return limit;
}
