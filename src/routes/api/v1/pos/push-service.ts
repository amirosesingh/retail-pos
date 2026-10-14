import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
const input = z.discriminatedUnion("action", [
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
          const filter = data.afterId
            ? `or=${encodeURIComponent(`(created_at.gt.${data.after},and(created_at.eq.${data.after},id.gt.${data.afterId}))`)}`
            : `created_at=gte.${encodeURIComponent(data.after)}`;
          const response = await serviceRest(
            `activity_events?${filter}&select=id,created_at&order=created_at.asc,id.asc&limit=100`,
          );
          if (!response.ok) throw new Error("Unavailable");
          return Response.json({ events: await response.json() });
        } catch {
          return Response.json({ error: "Push request could not be completed" }, { status: 503 });
        }
      },
    },
  },
});
