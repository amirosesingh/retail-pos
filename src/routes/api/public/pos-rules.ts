import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { corsPreflight, withCors } from "@/lib/public-cors";

/**
 * POST /api/public/pos-rules — the effective register rules for a branch.
 *
 * The Android shell and the Windows till serve the app from a local address
 * inside the device, so a relative app-server call never reaches a server.
 * They call this endpoint on the configured hosted POS instead. It is the same
 * rule set the website reads: one loader, one database routine, no second
 * implementation.
 *
 * It is not open. The caller must prove itself with an existing credential
 * (session record, cashier session, activation token or staff bearer) and the
 * branch that proof carries decides which rules are returned. Nothing secret
 * is ever in the reply.
 */
const body = z.object({
  sessionToken: z.string().max(400).optional(),
  cashierToken: z.string().max(400).optional(),
  terminalToken: z.string().max(400).optional(),
  deviceBindingProof: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  accessToken: z.string().max(4000).optional(),
  storeId: z.string().max(64).optional(),
});

async function handlePost(request: Request): Promise<Response> {
  const { callerVerifiedDownstream } = await import("@/lib/public-api-guard.server");
  const denied = callerVerifiedDownstream(
    "the caller's own credential is verified below before any rules are read",
  );
  if (denied) return denied;

  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ ok: false, error: "Invalid payload" }, { status: 400 });

  const { resolveRulesAccess } = await import("@/lib/pos-rules-access.server");
  const access = await resolveRulesAccess(parsed.data);
  if (!access.ok)
    return Response.json(
      { ok: false, error: access.error, code: access.code },
      { status: access.status },
    );

  try {
    const { loadRulesResult } = await import("@/lib/pos-rules.server");
    const loaded = await loadRulesResult(access.branchId);
    return Response.json({
      ok: true,
      branchId: access.branchId,
      backend: loaded.source,
      backendError: loaded.error ?? "",
      failure: loaded.failure,
      revision: loaded.revision,
      fetchedAt: loaded.fetchedAt,
      rowVersion: loaded.rowVersion,
      updatedAt: loaded.updatedAt,
      updatedBy: loaded.updatedBy,
      rules: loaded.rules,
      shiftSharingAvailable: loaded.shiftSharingAvailable,
    });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/pos-rules")({
  server: {
    handlers: {
      POST: async ({ request }) => withCors(await handlePost(request), request),
      OPTIONS: async ({ request }) => corsPreflight(request),
    },
  },
});
