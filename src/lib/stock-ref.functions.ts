import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { sameBranchId } from "./branch-id";
const permissions = {
  sponsorship:"can_create_sponsorship",
  stock: "can_adjust_stock",
  receiving: "can_receive_purchase_order",
  request: "can_create_transfer",
  transfer: "can_create_transfer",
} as const;
export const reserveCloudStockReference = createServerFn({ method: "POST" })
  .validator((value: unknown) =>
    z
      .object({
        sessionToken: z.string().max(400).optional(),
        cashierToken: z.string().max(2000).optional(),
        terminalToken: z.string().max(200).optional(),
        accessToken: z.string().max(4000).optional(),
        prefix: z.string().regex(/^[A-Z0-9-]{1,200}$/),
        minimum: z
          .number()
          .int()
          .min(1)
          .max(Number.MAX_SAFE_INTEGER - 1),
        storeId: z.string().min(1).max(128),
        series: z.enum(["stock", "receiving", "request", "transfer", "sponsorship"]),
      })
      .parse(value),
  )
  .handler(
    async ({ data }): Promise<{ ok: true; sequence: number } | { ok: false; error: string }> => {
      try {
        const { requireCallerScope } = await import("./privileged-caller.server");
        const scope = await requireCallerScope(data, { permission: permissions[data.series] });
        if (!scope.isSupervisor && (!scope.storeId || !sameBranchId(scope.storeId, data.storeId)))
          throw new Error("Document numbers can only be reserved for your branch.");
        const { serviceRpc } = await import("./staff-admin.server");
        const sequence = Number(
          await serviceRpc("reserve_stock_document_number", {
            p_prefix: data.prefix,
            p_minimum: data.minimum,
            p_store_id: scope.isSupervisor ? data.storeId : scope.storeId,
          }),
        );
        if (!Number.isSafeInteger(sequence) || sequence < data.minimum)
          throw new Error("The database returned no valid stock document number.");
        return { ok: true, sequence };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    },
  );
