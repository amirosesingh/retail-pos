import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { corsPreflight, withCors } from "@/lib/public-cors";

const body = z.object({
  sessionToken: z.string().max(400).optional(),
  cashierToken: z.string().max(400).optional(),
  terminalToken: z.string().max(400).optional(),
  accessToken: z.string().min(10).max(4000),
  storeId: z.string().max(64).optional(),
  patch: z.record(z.string(), z.union([z.boolean(), z.number()])),
  expectedVersion: z.number().int().nonnegative(),
});

async function handlePost(request: Request): Promise<Response> {
  const { callerVerifiedDownstream } = await import("@/lib/public-api-guard.server");
  const denied = callerVerifiedDownstream(
    "the caller and supervisor role are verified before the branch-scoped RPC",
  );
  if (denied) return denied;

  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success)
    return Response.json({ ok: false, error: "Invalid payload" }, { status: 400 });

  const { resolveRulesAccess } = await import("@/lib/pos-rules-access.server");
  const access = await resolveRulesAccess(parsed.data);
  if (!access.ok) {
    return Response.json(
      { ok: false, error: access.error, code: access.code },
      { status: access.status },
    );
  }

  const { resolveRelayScope } = await import("@/core/api/relay-policy.server");
  const scope = await resolveRelayScope(access.caller);
  if (!(scope.isSupervisor || scope.permissions.can_access_pos_settings === true)) {
    return Response.json(
      { ok: false, error: "POS settings permission is required", code: "FORBIDDEN" },
      { status: 403 },
    );
  }

  try {
    const { saveRules } = await import("@/lib/pos-rules.server");
    const snapshot = await saveRules(
      access.branchId,
      parsed.data.patch,
      parsed.data.accessToken,
      parsed.data.expectedVersion,
    );
    return Response.json({ ok: true, branchId: access.branchId, snapshot, rules: snapshot.rules });
  } catch (error) {
    const message = (error as Error).message;
    const stale = /STALE_RULES/i.test(message);
    return Response.json(
      {
        ok: false,
        error: stale ? "STALE_RULES" : message,
        code: stale ? "STALE_RULES" : "SAVE_FAILED",
      },
      { status: stale ? 409 : 500 },
    );
  }
}

export const Route = createFileRoute("/api/public/pos-rules/save")({
  server: {
    handlers: {
      POST: async ({ request }) => withCors(await handlePost(request), request),
      OPTIONS: async ({ request }) => corsPreflight(request),
    },
  },
});
