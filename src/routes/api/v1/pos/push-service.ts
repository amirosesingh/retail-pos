import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
const input = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("delivery"),
    eventId: z.string().uuid(),
    userId: z.string().min(1).max(120),
    status: z.enum(["sent", "failed", "skipped"]),
    reason: z.string().max(200),
  }),
  z.object({ action: z.literal("authorize"), eventId: z.string().uuid() }),
  z.object({
    action: z.literal("poll"),
    after: z.string().datetime({ offset: true }),
    afterId: z.string().uuid().optional(),
  }),
]);
export const Route = createFileRoute("/api/v1/pos/push-service")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { verifyPushService, authorizePhoneEvent } =
            await import("@/lib/central-push.server");
          if (!(await verifyPushService(request)))
            return Response.json({ error: "Unauthorized" }, { status: 401 });
          const raw = await request.text();
          if (raw.length > 2000) return new Response(null, { status: 413 });
          const data = input.parse(JSON.parse(raw));
          if (data.action === "authorize")
            return Response.json(await authorizePhoneEvent(data.eventId));
          const { serviceRest } = await import("@/core/api/pos-relay.server");
          if (data.action === "delivery") {
            const result = await serviceRest(
              `notification_deliveries?event_id=eq.${data.eventId}&channel=eq.push&recipient=eq.${encodeURIComponent(data.userId)}&status=neq.sent`,
              {
                method: "PATCH",
                body: JSON.stringify({
                  status: data.status,
                  reason: data.reason,
                  ...(data.status === "sent" ? { delivered_at: new Date().toISOString() } : {}),
                }),
              },
            );
            if (!result.ok && result.status !== 404)
              throw new Error("Could not update delivery history");
            return Response.json({ ok: true });
          }
          await (await import("@/lib/notification-delivery.server")).drainNotificationWhatsApp(5);
          const filter = data.afterId
            ? `or=${encodeURIComponent(`(created_at.gt.${data.after},and(created_at.eq.${data.after},id.gt.${data.afterId}))`)}`
            : `created_at=gte.${encodeURIComponent(data.after)}`;
          const response = await serviceRest(
            `activity_events?${filter}&select=id,created_at,meta&order=created_at.asc,id.asc&limit=100`,
          );
          if (!response.ok) throw new Error("Unavailable");
          const events = (await response.json()) as {
            id: string;
            created_at: string;
            meta?: Record<string, unknown>;
          }[];
          const pending = await serviceRest("rpc/pending_notification_push_events", {
            method: "POST",
            body: "{}",
          });
          const due = pending.ok
            ? ((await pending.json()) as { id: string; created_at: string }[])
            : [];
          const unique = new Map(
            [...events.filter((event) => !event.meta?.notification_routes), ...due].map((event) => [
              event.id,
              event,
            ]),
          );
          return Response.json({
            events: [...unique.values()].sort(
              (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
            ),
            cursor: events.at(-1) ?? null,
          });
        } catch {
          return Response.json({ error: "Push request could not be completed" }, { status: 503 });
        }
      },
    },
  },
});
