import { createFileRoute } from "@tanstack/react-router";
import { handleShiftAuthorEnroll } from "@/lib/shift-author-enroll-endpoint.server";

export const Route = createFileRoute("/api/v1/pos/shift-author-enroll")({
  server: { handlers: { POST: async ({ request }) => handleShiftAuthorEnroll(request) } },
});
