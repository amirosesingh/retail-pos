import type { RelayScope } from "@/core/api/relay-policy.server";

export type CallerProof = {
  sessionToken?: string;
  cashierToken?: string;
  terminalToken?: string;
  accessToken?: string;
};

/**
 * Verify a browser, till or PIN session before a server function uses the
 * service key.  Service-role reads must never be reachable merely because the
 * caller knows the generated server-function URL.
 */
export async function requireCallerScope(
  proof: CallerProof,
  options: { permission?: string; supervisor?: boolean } = {},
): Promise<RelayScope> {
  const { verifyRelayCaller } = await import("@/core/api/pos-relay.server");
  const { resolveRelayScope } = await import("@/core/api/relay-policy.server");
  const caller = await verifyRelayCaller(proof);
  const scope = await resolveRelayScope(caller);
  if (scope.stale) throw new Error("Your account details are stale — sign in again.");
  if (options.supervisor && !scope.isSupervisor) throw new Error("Supervisor access is required.");
  if (options.permission && !scope.isSupervisor && scope.permissions[options.permission] !== true)
    throw new Error("You do not have permission to use this feature.");
  return scope;
}
