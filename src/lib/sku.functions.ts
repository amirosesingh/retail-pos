import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const callerProof = {
  sessionToken: z.string().max(400).optional(),
  cashierToken: z.string().max(2000).optional(),
  terminalToken: z.string().max(200).optional(),
  accessToken: z.string().max(4000).optional(),
};

type LeaseRow = {
  lease_id: string;
  start_value: number | string;
  end_value: number | string;
  prefix: string;
  padding: number;
  reserved_at?: string;
};

export type ReserveSkuLeaseResult =
  | { ok: true; lease: LeaseRow }
  | { ok: false; error: string };

/**
 * Reserve SKU numbers through the same signed POS relay used by terminal
 * writes. A PIN operator is a valid POS identity even when the optional
 * browser Supabase Auth session is absent, so the renderer must not call the
 * protected database routine as anon.
 */
export const reserveSkuLease = createServerFn({ method: "POST" })
  .validator((value: unknown) =>
    z
      .object({
        ...callerProof,
        count: z.number().int().min(1).max(5000),
        storeId: z.string().max(128).optional(),
        terminalId: z.string().max(200).optional(),
        prefix: z.string().max(32),
        padding: z.number().int().min(1).max(12),
      })
      .parse(value),
  )
  .handler(async ({ data }): Promise<ReserveSkuLeaseResult> => {
    try {
      const { requireCallerScope } = await import("./privileged-caller.server");
      const scope = await requireCallerScope(data, { permission: "can_add_new_product" });
      const requestedStore = data.storeId?.trim() || null;
      if (scope.storeId && requestedStore && requestedStore !== scope.storeId) {
        throw new Error("SKU numbers can only be reserved for this terminal's branch.");
      }

      const { serviceRpc } = await import("./staff-admin.server");
      const result = await serviceRpc("reserve_product_skus", {
        p_count: data.count,
        p_store_id: scope.storeId ?? requestedStore,
        p_terminal_id: scope.terminalId ?? data.terminalId?.trim() ?? null,
        p_prefix: data.prefix,
        p_padding: data.padding,
      });
      const row = (Array.isArray(result) ? result[0] : result) as LeaseRow | null;
      if (!row?.lease_id) throw new Error("The central SKU service returned no number range.");
      return { ok: true, lease: row };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  });
