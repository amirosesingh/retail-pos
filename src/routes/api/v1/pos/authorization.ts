import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { corsPreflight, withCors } from "@/lib/public-cors";

const bodySchema = z.object({
  action: z.enum(["authorize_pin", "submit", "list", "decide", "claim", "cancel"]),
  data: z.record(z.string(), z.unknown()),
});

async function handle(request: Request): Promise<Response> {
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 512 * 1024)
      return Response.json({ ok: false, error: "Approval request is too large" }, { status: 413 });
    const body = bodySchema.parse(JSON.parse(raw));
    const functions = await import("@/lib/authorization.functions");
    const result =
      body.action === "authorize_pin"
        ? await functions.authorizeWithPin({ data: body.data as never })
        : body.action === "submit"
          ? await functions.submitAuthorizationRequest({ data: body.data as never })
          : body.action === "list"
            ? await functions.listAuthorizationRequests({ data: body.data as never })
            : body.action === "decide"
              ? await functions.decideAuthorizationRequest({ data: body.data as never })
              : body.action === "claim"
                ? await functions.claimAuthorizationRequest({ data: body.data as never })
                : await functions.cancelAuthorizationRequest({ data: body.data as never });
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message.slice(0, 300) : "Invalid request" },
      { status: 400 },
    );
  }
}

export const Route = createFileRoute("/api/v1/pos/authorization")({
  server: {
    handlers: {
      POST: async ({ request }) => withCors(await handle(request), request),
      OPTIONS: async ({ request }) => corsPreflight(request),
    },
  },
});
