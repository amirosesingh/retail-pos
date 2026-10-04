import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Membership has one public entry point. Keeping the historical URL as a
 * redirect prevents a second OTP-only screen from creating an Auth identity
 * without completing the corresponding member record.
 */
export const Route = createFileRoute("/membership")({
  beforeLoad: () => {
    throw redirect({ to: "/join", replace: true });
  },
});
