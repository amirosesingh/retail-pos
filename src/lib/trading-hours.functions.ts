import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { canonicalBranchId } from "./branch-id";
import type { RelayScope } from "@/core/api/relay-policy.server";
import type { StoreHourRow } from "./shop-comparison";

const input = z.object({
  sessionToken: z.string().max(400).optional(),
  cashierToken: z.string().max(2000).optional(),
  terminalToken: z.string().max(200).optional(),
  deviceBindingProof: z.string().max(2000).optional(),
  accessToken: z.string().max(4000).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  storeIds: z.array(z.string().trim().min(1).max(64)).min(1).max(100),
}).strict();

/** Same fresh account and fixed-terminal branch rules as the existing report relay. */
export function assertHourlyReportScope(scope: RelayScope, stores: readonly string[]) {
  if (scope.stale || scope.kind === "terminal" || !scope.staffUserId)
    throw new Error("A current staff sign-in is required.");
  const owner = scope.role === "admin" || scope.roleSlug === "admin";
  if (!owner && (scope.permissions.can_view_sales_reports !== true || scope.permissions.can_view_cost_margin !== true))
    throw new Error("You do not have permission to view hourly profit.");
  const crosses = scope.isSupervisor && !scope.branchRestricted;
  if (!crosses && (!scope.storeId || stores.some(id => canonicalBranchId(id) !== canonicalBranchId(scope.storeId))))
    throw new Error("This report is outside your assigned branch.");
}

export const loadHourlyTrading = createServerFn({ method: "POST" })
  .validator((value: unknown) => input.parse(value))
  .handler(async ({ data }): Promise<{ rows: StoreHourRow[] }> => {
    const stores = [...new Set(data.storeIds.map(canonicalBranchId))];
    const { requireCallerScope } = await import("./privileged-caller.server");
    const scope = await requireCallerScope(data, { permission: "can_view_sales_reports" });
    assertHourlyReportScope(scope, stores);
    const { serviceRest } = await import("@/core/api/pos-relay.server");
    const response = await serviceRest("rpc/pos_report_store_hours", {
      method: "POST", body: JSON.stringify({ p_from: data.from, p_to: data.to, p_store_ids: stores }),
    });
    if (!response.ok) throw new Error(response.status === 404
      ? "Hourly profit reporting requires its reviewed database upgrade. Other charts remain available."
      : "Hourly profit could not be verified. Other charts remain available.");
    const raw: unknown = await response.json();
    if (!Array.isArray(raw) || raw.length > 2400) throw new Error("The hourly report response is invalid.");
    const seen = new Set<string>();
    const rows = raw.map((value): StoreHourRow => {
      if (!value || typeof value !== "object") throw new Error("The hourly report response is invalid.");
      const row = value as Record<string, unknown>, store = canonicalBranchId(row.store_id), hour = Number(row.hour);
      const bills = Number(row.bills), revenue = Number(row.revenue), cost = Number(row.cost), profit = Number(row.profit);
      const key = JSON.stringify([store, hour]);
      if (!stores.includes(store) || !Number.isInteger(hour) || hour < 0 || hour > 23 || seen.has(key)
        || [row.hour, row.bills, row.revenue, row.cost, row.profit].some(value => value == null || typeof value === "boolean" || value === "")
        || !Number.isSafeInteger(bills) || bills < 0 || ![revenue, cost, profit].every(Number.isFinite))
        throw new Error("The hourly report response does not match its authorized scope.");
      seen.add(key);
      return { store_id: store, hour, bills, revenue, cost, profit };
    });
    // Never return private cost after an account/session/branch handover or revocation.
    const current = await requireCallerScope(data, { permission: "can_view_sales_reports" });
    assertHourlyReportScope(current, stores);
    if (scope.staffUserId !== current.staffUserId || scope.appUserId !== current.appUserId || scope.terminalId !== current.terminalId)
      throw new Error("The report sign-in changed. Load the report again.");
    return { rows };
  });
