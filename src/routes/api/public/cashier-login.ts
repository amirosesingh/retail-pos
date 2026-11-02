import { createFileRoute } from "@tanstack/react-router";

import { corsPreflight, withCors } from "@/lib/public-cors";
import { handleCashierLogin } from "@/lib/cashier-login-endpoint.server";

// Preserve the existing direct-handler import for callers and contract tests.
export { handleCashierLogin } from "@/lib/cashier-login-endpoint.server";

export const Route = createFileRoute("/api/public/cashier-login")({
  server: {
    handlers: {
      POST: async ({ request }) => withCors(await handleCashierLogin(request), request),
      OPTIONS: async ({ request }) => corsPreflight(request),
    },
  },
});
