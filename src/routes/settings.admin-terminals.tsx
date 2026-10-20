import { createFileRoute, redirect } from "@tanstack/react-router";

/** Existing bookmarks lead to the replacement device-management page. */
export const Route = createFileRoute("/settings/admin-terminals")({
  beforeLoad: () => { throw redirect({ to: "/settings/mobile-terminals" }); },
});
