import { createFileRoute } from "@tanstack/react-router";

import { corsPreflight, withCors } from "@/lib/public-cors";

/**
 * POST /api/public/health-metadata
 *
 * The database health screens need two things the Data API only hands to a
 * signed-in cloud account: the published table list and the relationship
 * check. A till signed in with a PIN has no such account, so it used to get a
 * bare 401 and the relationship function looked "missing".
 *
 * This endpoint proves the caller the same way the write relay does (device
 * session, cashier session, terminal token or staff account) and then reads
 * the metadata centrally. It is read-only: nothing here can change a record.
 */
type Body = {
  action?: "shapes" | "relations";
  sessionToken?: string;
  cashierToken?: string;
  terminalToken?: string;
  accessToken?: string;
};

async function handle({ request }: { request: Request }) {
  const { callerVerifiedDownstream } = await import("@/lib/public-api-guard.server");
  const guarded = callerVerifiedDownstream(
    "verifyRelayCaller below proves the device, cashier, terminal or staff session",
  );
  if (guarded) return guarded;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }

  const { verifyRelayCaller, serviceRest, hasServiceKey, serviceKey } =
    await import("@/core/api/pos-relay.server");
  if (!hasServiceKey()) {
    return Response.json(
      { ok: false, error: "This server does not hold the central database key." },
      { status: 503 },
    );
  }

  let caller;
  try {
    caller = await verifyRelayCaller({
      ...(body.sessionToken ? { sessionToken: body.sessionToken } : {}),
      ...(body.cashierToken ? { cashierToken: body.cashierToken } : {}),
      ...(body.terminalToken ? { terminalToken: body.terminalToken } : {}),
      ...(body.accessToken ? { accessToken: body.accessToken } : {}),
    });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 401 });
  }
  if (!caller) {
    return Response.json(
      { ok: false, error: "Sign in on this till to run the database checks." },
      { status: 401 },
    );
  }
  const { resolveRelayScope } = await import("@/core/api/relay-policy.server");
  const scope = await resolveRelayScope(caller);
  // The full table and column inventory is administrative information.
  if (
    scope.stale ||
    (!scope.isSupervisor && scope.permissions["can_manage_sync_backup"] !== true)
  ) {
    return Response.json(
      {
        ok: false,
        error: "Database checks are limited to staff accounts — sign in as a manager to run them.",
      },
      { status: 403 },
    );
  }

  try {
    if (body.action === "relations") {
      const res = await serviceRest("rpc/operational_relational_health", {
        method: "POST",
        body: "{}",
      });
      const text = await res.text();
      if (!res.ok) return Response.json({ ok: false, error: text.slice(0, 400) }, { status: 502 });
      return Response.json({ ok: true, data: JSON.parse(text) });
    }

    const { supabaseConfig } = await import("@/lib/external-supabase-config");
    const key = serviceKey();
    const headers: Record<string, string> = {
      apikey: key,
      Accept: "application/openapi+json",
    };
    if (!key.startsWith("sb_")) headers["Authorization"] = `Bearer ${key}`;
    const res = await fetch(`${supabaseConfig().url}/rest/v1/`, { headers });
    if (!res.ok) {
      return Response.json(
        { ok: false, error: `The database did not publish its table list (HTTP ${res.status})` },
        { status: 502 },
      );
    }
    const spec = (await res.json()) as import("@/lib/health-function-metadata").OpenApiFunctions & {
      definitions?: Record<string, { properties?: Record<string, unknown>; required?: string[] }>;
    };
    const { trulyRequired } = await import("@/lib/schema-required");
    const tables: Record<string, { columns: string[]; required: string[] }> = {};
    for (const [table, def] of Object.entries(spec.definitions ?? {})) {
      tables[table] = {
        columns: Object.keys(def.properties ?? {}),
        required: trulyRequired(def.required, def.properties),
      };
    }
    const { functionShapes } = await import("@/lib/health-function-metadata");
    return Response.json({ ok: true, tables, functions: functionShapes(spec) });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/health-metadata")({
  server: {
    handlers: {
      POST: async (ctx) => withCors(await handle(ctx), ctx.request),
      OPTIONS: async ({ request }) => corsPreflight(request),
    },
  },
});
