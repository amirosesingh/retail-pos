import { sameBranchId } from "./branch-id";

export function approvalBranchLabel(branchId: string | null | undefined, stores: readonly { id: string; name: string; code?: string }[]): string {
  if (!branchId) return "All branches";
  const store = stores.find(entry => sameBranchId(entry.id, branchId));
  return store ? `${store.name}${store.code ? ` (${store.code})` : ""}` : `Branch ${branchId}`;
}

/** These wire fields have a dedicated readable discount review. */
export const approvalDisplayFields = (payload: Record<string, unknown>) =>
  Object.entries(payload).filter(([key]) => !["requested_discounts", "approved_discounts"].includes(key));
