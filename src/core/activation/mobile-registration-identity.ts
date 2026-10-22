import { supabaseExternal } from "@/integrations/supabase/external-client";
import { clearStoredCredentials } from "@/lib/pos-credentials";
import { clearOperatorIdentity } from "@/lib/operator-auth-identity";
import { clearDeviceSecret } from "@/lib/device-secrets";
import { clearTerminalBranchBinding } from "@/lib/active-branch";
import { clearApprovalToken } from "@/platform-config/approval-token-client";

/** Called only after a successful mobile claim, before applying its tenant. */
export async function resetMobileRegistrationIdentity(signOutPrevious: boolean): Promise<void> {
  // Local sign-out removes the previous tenant's persisted Auth refresh token.
  if (signOutPrevious) {
    const result = await supabaseExternal.auth.signOut({ scope: "local" });
    if (result.error) throw result.error;
  }
  clearStoredCredentials();
  clearOperatorIdentity();
  clearDeviceSecret("terminal-account");
  await clearApprovalToken(true);
  window.sessionStorage.removeItem("pos-terminal-user-v1");
  clearTerminalBranchBinding();
}
