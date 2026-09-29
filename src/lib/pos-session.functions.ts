import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Mints a signed terminal session for a cashier after the PIN has been
 * verified server-side. Privileged server functions accept this token in
 * place of a Supabase access token.
 */
export const issueCashierSession = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z.object({
      username: z.string().min(1).max(64),
      pin: z.string().min(4).max(32),
    }).parse(data),
  )
  .handler(async ({ data }) => {
    const { signCashierSession } = await import("./pos-session.server");
    const { serviceRest } = await import("@/core/api/pos-relay.server");
    try {
      const res = await serviceRest("rpc/verify_terminal_pin", {
        method: "POST",
        body: JSON.stringify({
          p_user_id: data.username.trim().toLowerCase(),
          p_pin: data.pin,
        }),
      });
      if (!res.ok) return { ok: false as const, error: "Sign in failed" };
      const rows = (await res.json()) as unknown;
      const row = (Array.isArray(rows) ? rows[0] : rows) as
        | { user_id?: string; store_id?: string | null }
        | null;
      if (!row?.user_id || !row.store_id) {
        return { ok: false as const, error: "This cashier is not assigned to a branch" };
      }
      return {
        ok: true as const,
        token: signCashierSession({
          id: String(row.user_id),
          username: String(row.user_id),
          storeId: String(row.store_id),
        }),
      };
    } catch {
      return { ok: false as const, error: "Sign in failed" };
    }
  });
