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
      terminalToken:z.string().max(200).optional(),
      deviceBindingProof:z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    }).parse(data),
  )
  .handler(async ({ data }) => {
    const { signCashierSession } = await import("./pos-session.server");
    const { serviceRest } = await import("@/core/api/pos-relay.server");
    const { beginPinRequest, finishPinRequest } = await import("./pin-request-throttle.server");
    try {
      const attempt = await beginPinRequest();
      if (attempt.locked) return { ok: false as const, error: "Too many wrong PINs. Try again later." };
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
      await finishPinRequest(attempt.key, Boolean(row?.user_id));
      if (!row?.user_id || (!row.store_id && !data.terminalToken)) {
        return { ok: false as const, error: "This cashier is not assigned to a branch" };
      }
      const terminal=data.terminalToken ? await (await import("./terminal-binding.server")).readVerifiedTerminal(data.terminalToken,data.deviceBindingProof,true) : undefined;
      const {resolveRelayScope}=await import("@/core/api/relay-policy.server");
      const scope=await resolveRelayScope({kind:"cashier",label:row.user_id,staffUserId:row.user_id,
        storeId:terminal?.branchId ?? row.store_id ?? null,terminalId:terminal?.id,
        ...(terminal?.mode==="management" ? {managementDevice:true,managementMobileDevice:terminal.platform==="mobile"}: {})});
      const { startSession } = await import("./session-guard.server");
      const session = await startSession({
        kind: "cashier", staffUserId: String(row.user_id), branchId: scope.storeId,terminalId:terminal?.id,
      });
      return {
        ok: true as const,
        sessionToken: session.token,
        idleMinutes: session.idleMinutes,
        token: signCashierSession({
          id: String(row.user_id),
          username: String(row.user_id),
          storeId: scope.storeId,
          sessionToken: session.token,
        }),
      };
    } catch(error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "Sign in failed" };
    }
  });
