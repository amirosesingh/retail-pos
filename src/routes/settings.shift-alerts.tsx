import { createFileRoute, redirect } from "@tanstack/react-router";
/** Preserve old bookmarks; all notification delivery is configured in one table. */
export const Route = createFileRoute("/settings/shift-alerts")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/notifications" });
  },
});
