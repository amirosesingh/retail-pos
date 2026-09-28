import { createFileRoute } from "@tanstack/react-router";

import { corsPreflight, withCors } from "@/lib/public-cors";
import { handleAuthorizationRequest } from "@/lib/authorization-endpoint.server";

export const Route = createFileRoute("/api/v1/pos/authorization")({
  server: {
    handlers: {
      POST: async ({ request }) => withCors(await handleAuthorizationRequest(request), request),
      OPTIONS: async ({ request }) => corsPreflight(request),
    },
  },
});
