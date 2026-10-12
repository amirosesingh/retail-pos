import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const loadPostedSaleForCorrection = createServerFn({ method: "POST" })
  .validator((value: unknown) =>
    z
      .object({
        sessionToken: z.string().min(10).optional(),
  accessToken: z.string().optional(),
        terminalToken: z.string().optional(),
        cashierToken: z.string().optional(),
        saleId: z.string().uuid(),
        storeId: z.string().min(1).max(128),
      })
      .parse(value),
  )
  .handler(async ({ data }) => {
    try {
      const [{ verifyRelayCaller, serviceRest }, { resolveRelayScope }] = await Promise.all([
        import("@/core/api/pos-relay.server"),
        import("@/core/api/relay-policy.server"),
      ]);
      const scope = await resolveRelayScope(await verifyRelayCaller(data));
      if (scope.role !== "admin" && scope.roleSlug !== "admin")
        return { ok: false as const, error: "Only an administrator can correct a finalized bill." };
      if (scope.storeId && scope.storeId !== data.storeId)
        return { ok: false as const, error: "The bill must belong to the administrator's branch." };
      const response = await serviceRest(
        `sales?id=eq.${encodeURIComponent(data.saleId)}&store_id=eq.${encodeURIComponent(data.storeId)}&select=*,sale_items(*)&limit=1`,
      );
      if (!response.ok)
        return {
          ok: false as const,
          error: "The original bill could not be loaded. Connect and retry.",
        };
      return { ok: true as const, receiptJson: await response.text() };
    } catch (error) {
      return { ok: false as const, error: (error as Error).message.slice(0, 400) };
    }
  });

export const saleCorrectionInput = z.object({
  sessionToken: z.string().min(10).optional(),
  accessToken: z.string().optional(),
  terminalToken: z.string().optional(),
  cashierToken: z.string().optional(),
  saleId: z.string().uuid(),
  storeId: z.string().min(1).max(128),
  expectedVersion: z.number().int().nonnegative(),
  clientKey: z.string().uuid(),
  reason: z.string().trim().min(3).max(400),
  totals: z.object({
    subtotal_amount: z.number().finite().nonnegative(),
    discount_amount: z.number().finite().nonnegative(),
    tax_amount: z.number().finite().nonnegative(),
    total_amount: z.number().finite().nonnegative(),
    coupon_discount: z.number().finite().nonnegative(),
  }),
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        product_id: z.string().uuid().nullable(),
        product_name: z.string().min(1).max(500),
        variant_code: z.string().nullable(),
        unit_price: z.number().finite().nonnegative(),
        unit_cost: z.number().finite().nonnegative(),
        quantity: z.number().int().positive(),
        discount_percent: z.number().finite().min(0).max(100),
        discount_amount: z.number().finite().nonnegative(),
        tax_rate: z.number().finite().nonnegative(),
        is_return: z.literal(false),
        is_foc: z.boolean(),
        promo_id: z.string().nullable(),
        coupon_code: z.string().nullable(),
        coupon_discount: z.number().finite().nonnegative(),
      }),
    )
    .min(1)
    .max(500),
});

export const correctPostedSale = createServerFn({ method: "POST" })
  .validator((value: unknown) => saleCorrectionInput.parse(value))
  .handler(async ({ data }) => {
    try {
      const [{ verifyRelayCaller, serviceRest }, { resolveRelayScope }] = await Promise.all([
        import("@/core/api/pos-relay.server"),
        import("@/core/api/relay-policy.server"),
      ]);
      const scope = await resolveRelayScope(await verifyRelayCaller(data));
      if (scope.role !== "admin" && scope.roleSlug !== "admin")
        return { ok: false as const, error: "Only an administrator can correct a finalized bill." };
      if (scope.storeId && scope.storeId !== data.storeId)
        return { ok: false as const, error: "The bill must belong to the administrator's branch." };
      const response = await serviceRest("rpc/pos_admin_correct_sale", {
        method: "POST",
        body: JSON.stringify({
          p_sale: data.saleId,
          p_store: data.storeId,
          p_expected_version: data.expectedVersion,
          p_items: data.items,
          p_totals: data.totals,
          p_reason: data.reason,
          p_actor_id: scope.staffUserId || scope.label,
          p_actor_name: scope.actorName || scope.label,
          p_terminal: scope.terminalId ?? null,
          p_client_key: data.clientKey,
        }),
      });
      if (!response.ok) return { ok: false as const, error: (await response.text()).slice(0, 400) };
      return { ok: true as const, receiptJson: await response.text() };
    } catch (error) {
      return { ok: false as const, error: (error as Error).message.slice(0, 400) };
    }
  });
