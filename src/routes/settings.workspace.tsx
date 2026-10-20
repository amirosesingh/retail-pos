import { createFileRoute, redirect } from "@tanstack/react-router";
/** Preserve old bookmarks without retaining the retired workspace editor. */
export const Route = createFileRoute("/settings/workspace")({
  beforeLoad: () => { throw redirect({ to: "/settings" }); },
});
