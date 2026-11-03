import { createFileRoute } from "@tanstack/react-router";
import { handleIpcAdopt } from "@/lib/ipc-adopt-endpoint.server";

export const Route = createFileRoute("/api/v1/pos/ipc-adopt")({
  server: { handlers: { POST: async ({ request }) => handleIpcAdopt(request) } },
});
