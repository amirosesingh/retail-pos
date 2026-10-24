import { createFileRoute, redirect } from "@tanstack/react-router";

/** Keep saved links working after moving access controls into Staff. */
export const Route = createFileRoute("/settings/access")({
  beforeLoad: () => { throw redirect({ to: "/staff", search: { tab: "policies" }, replace: true }); },
});
