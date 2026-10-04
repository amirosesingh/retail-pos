import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { corsPreflight, withCors } from "@/lib/public-cors";
import {
  ACTIVITY_SOURCE_BATCH_SIZE,
  ACTIVITY_WINDOW_ERROR,
  MAX_ACTIVITY_OFFSET,
  MAX_ACTIVITY_SOURCE_BATCHES,
  activityScanBudgetExhausted,
} from "@/lib/activity-pagination";

const bodySchema = z.object({
  action: z.enum(["list", "clear", "clear_all"]),
  sessionToken: z.string().max(400).optional(),
  cashierToken: z.string().max(2000).optional(),
  terminalToken: z.string().max(200).optional(),
  accessToken: z.string().max(4000).optional(),
  eventId: z.string().uuid().optional(),
  cleared: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).max(MAX_ACTIVITY_OFFSET).optional(),
  query: z.string().trim().max(160).optional(),
  sortBy: z.enum(["created_at", "severity", "event_type", "store_id", "title"]).optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
  types: z
    .array(z.string().regex(/^[a-z_]{1,60}$/))
    .max(30)
    .optional(),
  severities: z
    .array(z.enum(["info", "warning", "critical"]))
    .max(3)
    .optional(),
  storeId: z.string().max(64).optional(),
  actor: z.string().max(160).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const Route = createFileRoute("/api/v1/pos/activity-preferences")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const reply = (body: unknown, status = 200) =>
          withCors(Response.json(body, { status }), request);
        const raw = await request.text();
        if (raw.length > 12_000) return reply({ ok: false, error: "Request too large" }, 413);
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          return reply({ ok: false, error: "Invalid JSON" }, 400);
        }
        const parsed = bodySchema.safeParse(body);
        if (!parsed.success) return reply({ ok: false, error: "Invalid request" }, 400);
        const input = parsed.data;
        const { verifyRelayCaller, serviceRest } = await import("@/core/api/pos-relay.server");
        const { resolveRelayScope } = await import("@/core/api/relay-policy.server");
        let caller: Awaited<ReturnType<typeof verifyRelayCaller>>;
        try {
          caller = await verifyRelayCaller(input);
        } catch {
          return reply({ ok: false, error: "Sign in is required" }, 401);
        }
        // Reuse the relay's canonical account resolver. Besides Auth id, staff
        // id and email, it safely falls back to the verified session label and
        // signed claims. The former hand-rolled lookup missed those legitimate
        // supervisor sessions and returned a false 403.
        const scope = await resolveRelayScope(caller);
        if (scope.stale || !scope.staffUserId)
          return reply({ ok: false, error: "Activity access denied" }, 403);
        const mayViewGeneralActivity =
          scope.isSupervisor || scope.permissions.can_view_audit_trail === true;
        const audienceIdentity = {
          userIds: [scope.staffUserId, scope.label].filter(Boolean) as string[],
          role: scope.roleSlug ?? scope.role,
          storeId: scope.storeId,
          terminalId: scope.terminalId,
          mayViewGeneralActivity,
        };

        const branch = scope.storeId;
        const isAdmin = scope.role === "admin" || scope.roleSlug === "admin";

        if (input.action === "clear") {
          if (!input.eventId || input.cleared === undefined)
            return reply({ ok: false, error: "Event and clear state are required" }, 400);
          const eventResponse = await serviceRest(
            `activity_events?id=eq.${encodeURIComponent(input.eventId)}&select=store_id,terminal_id,meta&limit=1`,
          );
          const eventRows = eventResponse.ok
            ? ((await eventResponse.json()) as Record<string, unknown>[])
            : [];
          const { activityVisibleTo } = await import("@/lib/activity-audience");
          if (!eventRows[0] || !activityVisibleTo(eventRows[0], audienceIdentity))
            return reply({ ok: false, error: "Notification access denied" }, 403);
          const response = await serviceRest("rpc/pos_set_activity_event_cleared", {
            method: "POST",
            body: JSON.stringify({
              p_event_id: input.eventId,
              p_user_id: scope.staffUserId,
              p_cleared: input.cleared,
            }),
          });
          if (!response.ok)
            return reply({ ok: false, error: "Could not save notification state" }, 503);
          return reply({ ok: true });
        }

        if (input.action === "clear_all") {
          if (!mayViewGeneralActivity)
            return reply({ ok: false, error: "Clear notifications one at a time" }, 403);
          const response = await serviceRest("rpc/pos_set_all_activity_events_cleared", {
            method: "POST",
            body: JSON.stringify({
              p_user_id: scope.staffUserId,
              p_store_id: isAdmin ? null : branch,
            }),
          });
          if (!response.ok)
            return reply({ ok: false, error: "Could not clear active notifications" }, 503);
          return reply({ ok: true, count: Number(await response.json()) || 0 });
        }

        const params = new URLSearchParams({
          select: "*",
          order: `${input.sortBy ?? "created_at"}.${input.sortDirection ?? "desc"},id.asc`,
        });
        if (input.types?.length) params.set("event_type", `in.(${input.types.join(",")})`);
        if (input.severities?.length) params.set("severity", `in.(${input.severities.join(",")})`);
        if (branch && !isAdmin) {
          if (input.storeId && input.storeId !== branch)
            return reply({ ok: false, error: "Branch access denied" }, 403);
          params.set("store_id", `eq.${branch}`);
        } else if (input.storeId) params.set("store_id", `eq.${input.storeId}`);
        if (input.actor) params.set("actor_name", `ilike.*${input.actor.replace(/[,*()]/g, "")}*`);
        if (input.query) {
          const term = input.query.replace(/[,*()]/g, "");
          if (term)
            params.set(
              "or",
              `(title.ilike.*${term}*,message.ilike.*${term}*,actor_name.ilike.*${term}*,entity_id.ilike.*${term}*)`,
            );
        }
        if (input.from) params.set("created_at", `gte.${input.from}`);
        if (input.to) params.append("created_at", `lte.${input.to}`);
        const { activityVisibleTo } = await import("@/lib/activity-audience");
        const offset = input.offset ?? 0;
        const limit = input.limit ?? 200;
        const target = offset + limit;
        const visibleRows: Record<string, unknown>[] = [];
        const batchSize = ACTIVITY_SOURCE_BATCH_SIZE;
        let sourceOffset = 0;
        let exhausted = false;
        let batchesRead = 0;
        // Continue from the last bounded source batch until the requested
        // audience-filtered page is full; large valid offsets remain reachable.
        while (visibleRows.length < target && batchesRead < MAX_ACTIVITY_SOURCE_BATCHES) {
          const page = new URLSearchParams(params);
          page.set("limit", String(batchSize));
          page.set("offset", String(sourceOffset));
          const response = await serviceRest(`activity_events?${page}`);
          if (!response.ok) return reply({ ok: false, error: "Could not load activity" }, 503);
          const rows = (await response.json()) as Record<string, unknown>[];
          batchesRead += 1;
          visibleRows.push(...rows.filter((row) => activityVisibleTo(row, audienceIdentity)));
          if (rows.length < batchSize) {
            exhausted = true;
            break;
          }
          sourceOffset += rows.length;
        }
        let sourceRowRemains = false;
        if (!exhausted && batchesRead >= MAX_ACTIVITY_SOURCE_BATCHES && visibleRows.length < target) {
          const probe = new URLSearchParams(params);
          probe.set("limit", "1");
          probe.set("offset", String(sourceOffset));
          const response = await serviceRest(`activity_events?${probe}`);
          if (!response.ok) return reply({ ok: false, error: "Could not load activity" }, 503);
          sourceRowRemains = ((await response.json()) as Record<string, unknown>[]).length > 0;
          exhausted = !sourceRowRemains;
        }
        if (activityScanBudgetExhausted({ batchesRead, exhausted, sourceRowRemains, visibleCount: visibleRows.length, target }))
          return reply({ ok: false, code: "ACTIVITY_WINDOW_EXCEEDED", error: ACTIVITY_WINDOW_ERROR }, 422);
        return reply({
          ok: true,
          rows: visibleRows.slice(offset, offset + limit),
          total: visibleRows.length,
          totalExact: exhausted,
        });
      },
      OPTIONS: async ({ request }) => corsPreflight(request),
    },
  },
});
