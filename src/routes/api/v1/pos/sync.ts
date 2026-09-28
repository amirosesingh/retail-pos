import { createFileRoute } from "@tanstack/react-router";

import { corsPreflight, withCors } from "@/lib/public-cors";

/**
 * POST /api/v1/pos/sync — canonical write relay for tills.
 *
 * The caller must prove itself (signed cashier session, active terminal
 * token, or staff access token). The server then resolves that caller's
 * branch and permissions and refuses anything outside them.
 *
 * A Windows till and an Android shell are never served from this origin, so
 * every call they make here is cross-origin. Without the allowance below the
 * browser layer blocks the request before it is sent and the device reports
 * "failed to fetch" even though the server is healthy.
 */
export const Route = createFileRoute("/api/v1/pos/sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (new URL(request.url).searchParams.get("operation") === "authorization") {
          const { handleAuthorizationRequest } =
            await import("@/lib/authorization-endpoint.server");
          return withCors(await handleAuthorizationRequest(request), request);
        }
        const { handleSyncRequest } = await import("@/lib/sync-endpoint.server");
        return withCors(await handleSyncRequest(request), request);
      },
      OPTIONS: async ({ request }) => corsPreflight(request),
    },
  },
});
