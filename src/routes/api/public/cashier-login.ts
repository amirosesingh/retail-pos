import { createFileRoute } from "@tanstack/react-router";

import { corsPreflight, withCors } from "@/lib/public-cors";
import { publicCashierLoginResponse } from "@/lib/cashier-login-response.server";
import { z } from "zod";

/**
 * POST /api/public/cashier-login — username + PIN sign-in for tills.
 *
 * Public by necessity (the caller has no session yet); the PIN itself is the
 * credential and is verified server-side with the internal key.
 */
const body = z.object({
  username: z.string().min(1).max(120).refine(username => username.trim().length > 0),
  pin: z.string().min(4).max(32),
  platform: z.string().max(60).optional(),
  terminalId: z.string().max(64).optional(),
  deviceBindingProof:z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  /** The branch this till is set to; only used for all-branches accounts. */
  branchId: z.string().max(80).nullish(),
});

export async function handleCashierLogin(request: Request): Promise<Response> {
  const { callerVerifiedDownstream } = await import("@/lib/public-api-guard.server");
  const denied = callerVerifiedDownstream(
    "the PIN itself is the credential and is verified server-side by cashierLoginServer",
  );
  if (denied) return denied;

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ ok: false, error: "Invalid payload" }, { status: 400 });

  const { hasServiceKey } = await import("@/core/api/pos-relay.server");
  if (!hasServiceKey())
    // `code` lets the till tell "the server cannot check anything" apart from
    // "this PIN is wrong", so it can fall back to its local database.
    return Response.json(
      {
        ok: false,
        code: "no_service_key",
        error: "Central database key missing on this server",
      },
      { status: 503 },
    );

  // The account bucket supplements the canonical account lockout in SQL.
  // Address throttling lives inside cashierLoginServer so its other callers
  // cannot bypass it.
  const { throttleStatus, throttleFail, throttleReset, minutesLeft } =
    await import("@/lib/pin-throttle.server");
  const userKey = `cashier:${parsed.data.username.trim().toLowerCase()}`;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(),25_000);
  const signal = AbortSignal.any([abort.signal,request.signal]);
  try {
  try {
    const state = await throttleStatus(userKey,signal);
    if (state.locked)
      return publicCashierLoginResponse(
        {
          ok: false,
          code: "locked",
          error: `Too many wrong PINs. Try again in ${minutesLeft(state)} minutes.`,
        },
        429,
      );
  } catch {
    return Response.json(
      { ok: false, code: "central_unavailable", error: "Central PIN protection is unavailable" },
      { status: 503 },
    );
  }

  const { cashierLoginServer } = await import("@/lib/cashier-login.server");
  try {
    const result = await cashierLoginServer({ ...parsed.data, request }, { signal });
    if (result.ok) {
      await throttleReset(userKey,signal);
    } else if (result.code === "invalid_credentials") {
      await throttleFail(userKey,5,signal);
    }
    signal.throwIfAborted();
    // Infrastructure/identity preparation failures are not wrong PINs. Do not
    // consume an attempt; 503 also lets a terminal use its verified local PIN
    // cache while the hosted Auth handoff is temporarily unavailable.
    const status = result.ok
      ? 200
      : result.code === "locked"
        ? 429
      : result.code === "session_prepare_failed" || result.code === "central_unavailable"
        ? 503
        : result.code === "identity_mismatch"
          ? 409
          : 401;
    return publicCashierLoginResponse(result, status);
  } catch (e) {
    if (signal.aborted) return Response.json({ok:false,code:"central_unavailable",error:"The sign-in service did not complete in time. Your PIN has not been rejected."},{status:503});
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
  } finally { clearTimeout(timer); }
}

export const Route = createFileRoute("/api/public/cashier-login")({
  server: {
    handlers: {
      POST: async ({ request }) => withCors(await handleCashierLogin(request), request),
      OPTIONS: async ({ request }) => corsPreflight(request),
    },
  },
});
