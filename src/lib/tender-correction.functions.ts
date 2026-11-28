import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { sameBranchId } from "./branch-id";
import { runtimeEnvValue } from "./external-supabase-config";

const groupedTenderReply = z.discriminatedUnion("status", [
  z.object({ status: z.literal("SCOPE_UNAVAILABLE") }),
  z.object({ status: z.enum(["REVIEW_REQUIRED", "INTEGRITY_CONFLICT"]) }),
  z.object({
    status: z.enum(["APPLIED", "ALREADY_APPLIED"]),
    result: z.object({ sale_id: z.string().uuid(), scope_id: z.string(), method: z.string(), sale_version: z.number().int().positive() }),
  }),
]);

export const correctSaleTender = createServerFn({ method: "POST" })
  .validator((value: unknown) => z.object({ sessionToken: z.string().optional(), cashierToken: z.string().optional(), accessToken: z.string().optional(), terminalToken: z.string().optional(), saleId: z.string().uuid(), storeId: z.string().min(1).max(128), method: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), saleVersion: z.number().int().min(0).max(2147483647).optional() }).parse(value))
  .handler(async ({ data }) => {
    try {
      const { requireCallerScope } = await import("./privileged-caller.server");
      const scope = await requireCallerScope(data);
      if (scope.kind === "terminal" || (scope.role !== "admin" && scope.roleSlug !== "admin"))
        return { ok: false as const, error: "Only a verified administrator can correct a completed payment." };
      if (scope.storeId && !sameBranchId(scope.storeId, data.storeId))
        return { ok: false as const, error: "The bill must belong to the administrator's branch." };
      const { serviceRest } = await import("@/core/api/pos-relay.server");
      const financial = !!scope.appUserId && await (await import('./financial-live-readiness.server')).financialLiveAdapterReady();
      if (runtimeEnvValue("POS_GROUPED_CASH_SETTINGS_PILOT_ENABLED") === "true" &&
          runtimeEnvValue("POS_GROUPED_EXTENDED_PILOT_ENABLED") === "true") {
        if (!financial) return { ok: false as const, error: "The central payment correction could not be verified." };
        const saleId = data.saleId.toLowerCase();
        const grouped = await serviceRest("rpc/pos_sync_request_tender_v1", {
          method: "POST", redirect: "error", body: JSON.stringify({
            p_author: scope.appUserId, p_sale: saleId, p_branch: data.storeId, p_method: data.method,
            p_terminal: scope.terminalId ?? null, p_sale_version: data.saleVersion ?? null,
          }),
        });
        if (!grouped.ok) return { ok: false as const, error: "The central payment correction could not be confirmed. Retry the same bill." };
        const result = groupedTenderReply.parse(await grouped.json());
        if (result.status !== "SCOPE_UNAVAILABLE") {
          if (!("result" in result) || result.result.sale_id !== saleId ||
              !sameBranchId(result.result.scope_id, data.storeId) || result.result.method !== data.method ||
              result.result.sale_version !== Number(data.saleVersion) + 1)
            return { ok: false as const, error: "Refresh the bill before correcting its payment." };
          return { ok: true as const, groupedSaleVersion: result.result.sale_version };
        }
      }
      const response = await serviceRest(financial ? "rpc/pos_live_financial_admin_correct_tender" : "rpc/pos_admin_correct_tender", { method: "POST", body: JSON.stringify({ p_sale: data.saleId, p_store: data.storeId, p_method: data.method, ...(financial ? { p_author: scope.appUserId, p_terminal: scope.terminalId ?? null } : {}) }) });
      if (!response.ok) return { ok: false as const, error: (await response.text()).slice(0, 400) };
      return { ok: true as const };
    } catch (error) { return { ok: false as const, error: (error as Error).message.slice(0, 400) }; }
  });
