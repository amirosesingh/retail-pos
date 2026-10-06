import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const proofFields = {
  sessionToken: z.string().max(400).optional(),
  cashierToken: z.string().max(2000).optional(),
  terminalToken: z.string().max(200).optional(),
  accessToken: z.string().max(4000).optional(),
};

export type LocationDeleteResult =
  | { ok: true; deletedId: string; deletedName: string }
  | { ok: false; error: string; blockers?: Record<string, number> };

/** Permanently delete only a centrally verified, completely unused location. */
export const deleteEmptyLocation = createServerFn({ method: "POST" })
  .validator((value: unknown) =>
    z
      .object({
        ...proofFields,
        storeId: z.string().min(1).max(128),
        confirmationName: z.string().min(1).max(200),
      })
      .parse(value),
  )
  .handler(async ({ data }): Promise<LocationDeleteResult> => {
    try {
      const { requireCallerScope } = await import("./privileged-caller.server");
      await requireCallerScope(data, { permission: "can_manage_locations" });
      const { serviceRpc } = await import("./staff-admin.server");
      const result = (await serviceRpc("delete_empty_store", {
        p_store_id: data.storeId,
        p_confirmation_name: data.confirmationName,
      })) as LocationDeleteResult;
      return result;
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  });

