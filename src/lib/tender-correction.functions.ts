import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { sameBranchId } from "./branch-id";
export const correctSaleTender = createServerFn({ method: "POST" })
  .validator((value: unknown) => z.object({ sessionToken: z.string().optional(), cashierToken: z.string().optional(), accessToken: z.string().optional(), terminalToken: z.string().optional(), saleId: z.string().uuid(), storeId: z.string().min(1).max(128), method: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/) }).parse(value))
  .handler(async ({ data }) => {
    try {
      const { requireCallerScope } = await import("./privileged-caller.server");
      const scope = await requireCallerScope(data);
      if (scope.kind === "terminal" || (scope.role !== "admin" && scope.roleSlug !== "admin"))
        return { ok: false as const, error: "Only a verified administrator can correct a completed payment." };
      if (scope.storeId && !sameBranchId(scope.storeId, data.storeId))
        return { ok: false as const, error: "The bill must belong to the administrator's branch." };
      const { serviceRest } = await import("@/core/api/pos-relay.server");
      const response = await serviceRest("rpc/pos_admin_correct_tender", { method: "POST", body: JSON.stringify({ p_sale: data.saleId, p_store: data.storeId, p_method: data.method }) });
      if (!response.ok) return { ok: false as const, error: (await response.text()).slice(0, 400) };
      return { ok: true as const };
    } catch (error) { return { ok: false as const, error: (error as Error).message.slice(0, 400) }; }
  });
