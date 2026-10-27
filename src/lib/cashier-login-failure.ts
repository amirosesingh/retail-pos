import { localCashierLoginFailure, loginFailureMessage, type LoginFailure } from "./login-failure";

export type CashierFailure = { ok: false; code: LoginFailure | "session-open-failed"; error: string };

/** Only an explicit credential refusal is a wrong PIN. Never infer it from missing data. */
export function cashierServiceFailure(status: number, payload: { code?: string; error?: string } | null): CashierFailure & { useLocal: boolean } {
  const code = payload?.code;
  const error = payload?.error ?? "";
  if (code === "activation_denied")
    return {ok:false,code:"permission-denied",error:error || "This device activation is not valid. Review its registration before signing in.",useLocal:false};
  if (code === "identity_mismatch")
    return { ok: false, code: "session-open-failed", error: error || "The verified cashier identity needs administrator repair.", useLocal: false };
  if (status === 429 || code === "locked")
    return { ok: false, code: "unknown-error", error: error || "Too many attempts. Please wait before trying again.", useLocal: false };
  if (status === 401 && (code === "invalid_credentials" || /^Invalid username or PIN$/i.test(error)))
    return { ok: false, code: "invalid-credentials", error: "Invalid username or PIN", useLocal: false };
  if (/deactivat|not active|blocked/i.test(error))
    return { ok: false, code: "account-inactive", error: loginFailureMessage("account-inactive"), useLocal: false };
  if (status === 403)
    return { ok: false, code: "permission-denied", error: error || loginFailureMessage("permission-denied"), useLocal: false };
  const useLocal = status >= 500 || (status >= 200 && status < 300) || [408, 404].includes(status) ||
    ["central_unavailable", "session_prepare_failed", "no_service_key", "no_server"].includes(code ?? "");
  return { ok: false, code: useLocal ? "cloud-unreachable" : "unknown-error",
    error: useLocal ? "The sign-in service did not complete the PIN check. Check the connection and try again. Your PIN has not been rejected."
      : error || loginFailureMessage("unknown-error"), useLocal };
}

/** A stale offline PIN cannot establish that the central server rejected a delayed request. */
export function cashierFallbackFailure(reason: string, offline: boolean): CashierFailure {
  if (!offline && ["invalid", "bad-pin", "missing", "unavailable", "unknown", "error"].includes(reason))
    return { ok: false, code: "cloud-unreachable",
      error: "The sign-in service did not answer, and this device could not verify the PIN from its saved records. Check the connection and try again. Your PIN has not been confirmed." };
  return localCashierLoginFailure(reason);
}
