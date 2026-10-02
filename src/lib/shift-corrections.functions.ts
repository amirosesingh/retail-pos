import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const input = z.object({
  accessToken: z.string().min(10).optional(),
  terminalToken: z.string().min(10).optional(),
  cashierToken: z.string().min(10).optional(),
  shiftId: z.string().uuid(),
  storeId: z.string().min(1).max(64),
  cash: z.number().finite().nonnegative(),
  card: z.number().finite().nonnegative().nullable(),
  digital: z.number().finite().nonnegative().nullable(),
  reason: z.string().trim().min(3).max(400),
  terminalId: z.string().max(128).nullable().optional(),
  clientKey: z.string().uuid(),
});

export const correctClosedShift = createServerFn({ method: "POST" })
  .validator((value: unknown) => input.parse(value))
  .handler(async ({ data }) => {
    try {
      const [{ verifyRelayCaller, serviceRest }, { resolveRelayScope }] = await Promise.all([
        import("@/core/api/pos-relay.server"),
        import("@/core/api/relay-policy.server"),
      ]);
      const verified = await verifyRelayCaller(data);
      const scope = await resolveRelayScope(verified);
      const isAdmin = scope.roleSlug === "admin" || scope.role === "admin";
      if (!isAdmin) {
        return { ok: false as const, error: "Only an administrator can correct a closed shift" };
      }
      const shiftResponse = await serviceRest(
        `shifts?id=eq.${encodeURIComponent(data.shiftId)}&select=store_id&limit=1`,
      );
      if (!shiftResponse.ok) {
        return { ok: false as const, error: "The shift branch could not be verified" };
      }
      const shift = ((await shiftResponse.json()) as { store_id?: string | null }[])[0];
      if (!shift) return { ok: false as const, error: "That shift no longer exists" };
      const shiftStoreId = shift.store_id ?? null;
      if (shiftStoreId !== data.storeId) {
        return { ok: false as const, error: "The selected shift branch does not match" };
      }
      if (scope.storeId && scope.storeId !== shiftStoreId) {
        return { ok: false as const, error: "The shift must belong to the administrator's branch" };
      }
      const response = await serviceRest("rpc/pos_admin_correct_closed_shift", {
        method: "POST",
        body: JSON.stringify({
          p_shift: data.shiftId,
          p_cash: data.cash,
          p_card: data.card,
          p_digital: data.digital,
          p_reason: data.reason,
          p_actor_id: scope.staffUserId || scope.label,
          p_actor_name: scope.actorName || scope.label,
          p_terminal: data.terminalId ?? scope.terminalId ?? null,
          p_client_key: data.clientKey,
        }),
      });
      if (!response.ok) {
        const message = (await response.text()).slice(0, 300);
        return { ok: false as const, error: message || "The shift correction was rejected" };
      }
      const result = (await response.json()) as {
        replayed?: boolean;
        shift_id?: string;
        variance_total?: number;
        variance_status?: string;
      };
      return { ok: true as const, result };
    } catch (error) {
      return { ok: false as const, error: (error as Error).message.slice(0, 300) };
    }
  });
