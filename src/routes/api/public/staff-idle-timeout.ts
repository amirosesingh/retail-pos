import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { corsPreflight, withCors } from "@/lib/public-cors";

async function handle(request: Request) {
  const { callerVerifiedDownstream } = await import("@/lib/public-api-guard.server");
  const denied = callerVerifiedDownstream(
    "requireSupervisor verifies the staff access token before reading or changing another account",
  );
  if (denied) return denied;
  const parsed = z
    .object({
      accessToken: z.string().min(1).max(4000),
      kind: z.enum(["account", "cashier"]),
      key: z.string().min(1).max(64),
      minutes: z.number().int().min(0).max(1440).optional(),
    })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ ok: false, error: "Invalid timeout request" }, { status: 400 });
  const data = parsed.data;
  try {
    const { requireSupervisor } = await import("@/lib/staff-admin.server");
    await requireSupervisor(data.accessToken);
  } catch (error) {
    return Response.json({ ok: false, error: (error as Error).message }, { status: 403 });
  }
  try {
    const { serviceRest } = await import("@/core/api/pos-relay.server");
    const target = data.kind === "cashier" ? "cashiers?id" : "app_users?user_id";
    const response = await serviceRest(
      `${target}=eq.${encodeURIComponent(data.key)}&select=idle_timeout_minutes,store_id&limit=1`,
    );
    if (!response.ok) throw new Error("Could not read the account idle limit");
    const rows = (await response.json()) as {
      idle_timeout_minutes: number | null;
      store_id: string | null;
    }[];
    if (!rows.length)
      return Response.json({ ok: false, error: "Account not found" }, { status: 404 });
    if (data.minutes !== undefined) {
      if (data.minutes > 0) {
        const { resolveIdleMinutes } = await import("@/lib/session-guard.server");
        const branchDefault = await resolveIdleMinutes({ branchId: rows[0].store_id });
        if (data.minutes > branchDefault)
          return Response.json(
            {
              ok: false,
              error: `Personal limit must be ${branchDefault} minutes or less for this branch`,
            },
            { status: 400 },
          );
      }
      const { saveStaffIdleTimeout } = await import("@/lib/idle-timeout.functions");
      const result = await saveStaffIdleTimeout({ data: { ...data, minutes: data.minutes } });
      if (!result.ok) return Response.json(result, { status: 403 });
    }
    return Response.json({ ok: true, minutes: data.minutes ?? rows[0].idle_timeout_minutes ?? 0 });
  } catch (error) {
    return Response.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
export const Route = createFileRoute("/api/public/staff-idle-timeout")({
  server: {
    handlers: {
      POST: async ({ request }) => withCors(await handle(request), request),
      OPTIONS: async ({ request }) => corsPreflight(request),
    },
  },
});
