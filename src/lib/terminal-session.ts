/**
 * Keeps an activated till signed in to the central database with its own
 * machine account, so writes made during a cashier PIN shift are accepted
 * normally instead of being refused by the row rules.
 */
import { supabaseExternal } from "@/integrations/supabase/external-client";
import { getTerminalAccount } from "./terminal-account.functions";
import { getDeviceSecret, setDeviceSecret } from "./device-secrets";
import { readTerminalConfig } from "@/core/activation/terminal-tokens";
import { deviceProofHash } from "@/core/activation/device-proof";
import { logger } from "./audit-log";

type Account = { email: string; password: string };

const SECRET = "terminal-account";

/** Fetch (once) and remember this terminal's machine account, encrypted. */
export async function provisionTerminalAccount(tokenId: string): Promise<Account | null> {
  const proofHash = await deviceProofHash();
  if (!proofHash) {
    logger.log("security", "Terminal cloud authentication unavailable", "Terminal activation", {
      reason: "secure-device-proof-unavailable",
    });
    return null;
  }
  const res = await getTerminalAccount({ data: { tokenId, proofHash } }).catch(() => null);
  if (!res?.ok) {
    logger.log("security", "Terminal cloud authentication retry required", "Terminal activation", {
      reason: res?.error ?? "provisioning-request-failed",
    });
    return null;
  }
  const account: Account = { email: res.email, password: res.password };
  await setDeviceSecret(SECRET, account);
  return account;
}

/**
 * Make sure there is a live cloud session for this till. Returns true when the
 * terminal is signed in (either already, or after signing in as the machine
 * account). Failures are silent — the server relay still carries the writes.
 */
export async function ensureTerminalSession(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const current = (await supabaseExternal.auth.getSession()).data.session;
    if (current) return true;

    const tokenId = readTerminalConfig()?.tokenId;
    if (!tokenId) return false;

    let account = await getDeviceSecret<Account>(SECRET);
    if (!account) account = await provisionTerminalAccount(tokenId);
    if (!account) return false;

    const { error } = await supabaseExternal.auth.signInWithPassword(account);
    if (!error) return true;

    // Credentials rotated or the account was rebuilt — re-provision once.
    const fresh = await provisionTerminalAccount(tokenId);
    if (!fresh) return false;
    const retry = await supabaseExternal.auth.signInWithPassword(fresh);
    if (!retry.error) return true;
    logger.log("security", "Terminal cloud sign-in failed", "Terminal activation", {
      reason: retry.error.message,
    });
    return false;
  } catch (error) {
    logger.log("security", "Terminal cloud sign-in failed", "Terminal activation", {
      reason: error instanceof Error ? error.message : "unknown-error",
    });
    return false;
  }
}
