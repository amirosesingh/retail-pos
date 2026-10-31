import type { CashierLoginResult } from "./cashier-login.server";

/** Serialize only after private credential/request accounting has finished. */
export function publicCashierLoginResponse(result: CashierLoginResult, status: number): Response {
  if (!result.ok && ["invalid_credentials", "account_inactive", "credential_unavailable", "locked", "invalid_input"].includes(result.code ?? "")) {
    // Include locks: exposing a later 429 would let repeated guesses distinguish
    // accounts that consume PIN attempts from inactive/unconfigured accounts.
    // Private SQL validation also occurs after the address check, so its result
    // must not provide a probe for whether that address is currently locked.
    // Enforcement remains private; this refusal never permits local fallback or
    // tells the keypad that unavailable verification was a wrong PIN.
    return Response.json({
      ok: false,
      code: "sign_in_failed",
      error: "Sign-in was not accepted. Check your details, wait before retrying, or ask an administrator for help.",
    }, { status: 401 });
  }
  return Response.json(result, { status });
}
