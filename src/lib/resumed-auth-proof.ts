import type { AuthSessionCheck } from "./auth-session-guard";
import { matchesOperatorIdentity } from "./operator-auth-identity";

/** null leaves both the previous proof and its paired bearer untouched. */
export function resumedAuthProof(
  check: AuthSessionCheck,
  previousVerified: boolean,
  operatorId: string | null,
): { verified: boolean; accessToken?: string } | null {
  // A failed restore/check has no identity evidence. It must neither revoke
  // an existing operator proof nor create a new proof from a cached token.
  if (check.state === "unavailable") return null;
  const sameOperator = matchesOperatorIdentity(check.session?.user, operatorId);
  const verified = sameOperator &&
    (check.state === "verified" || (check.state === "unverified" && previousVerified));
  return { verified, accessToken: verified ? check.session?.access_token : undefined };
}
