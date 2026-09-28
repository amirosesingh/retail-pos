/**
 * Why a sign-in did not go through — in categories, not raw backend text.
 *
 * A till that has not been connected to a company yet, a company database that
 * cannot be reached and a mistyped password are three completely different
 * problems, and only one of them is about the password. Before this module the
 * screen printed whatever the cloud replied, so every one of them read as
 * "Invalid login credentials" and sent people looking for the wrong fix.
 *
 * Nothing here ever carries a key, a token, a password or a server detail: the
 * category and a short sentence are all that leave this file.
 */
import type { ConfigReadiness } from "@/lib/platform-config-ready";

export type LoginFailure =
  | "configuration-required"
  | "configuration-invalid"
  | "cloud-unreachable"
  | "cloud-schema-missing"
  | "terminal-not-activated"
  | "branch-not-configured"
  | "invalid-credentials"
  | "account-inactive"
  | "permission-denied"
  | "local-backend-unavailable"
  | "unknown-error";

const WORDING: Record<LoginFailure, string> = {
  "configuration-required":
    "This terminal has not been connected to a company yet. Open the connection screen and enter the company database address and key.",
  "configuration-invalid":
    "The saved connection details on this terminal are incomplete or not valid. Open the connection screen and check them.",
  "cloud-unreachable":
    "The company database did not answer. Check this device's internet connection, then try again.",
  "cloud-schema-missing":
    "The company database answered but the point-of-sale tables are missing, so accounts cannot be checked yet.",
  "terminal-not-activated":
    "This terminal has not been activated yet. Complete activation before signing in.",
  "branch-not-configured":
    "This terminal is not assigned to a branch yet. Assign a branch before signing in.",
  "invalid-credentials": "That email or password is not correct.",
  "account-inactive": "Account deactivated. Please contact an administrator.",
  "permission-denied":
    "Your account signed in, but its role and permissions could not be loaded, so access was refused.",
  "local-backend-unavailable":
    "This terminal's own service is not responding, so it cannot complete sign-in.",
  "unknown-error": "Sign in could not be completed. Please try again.",
};

/** Plain wording for a category — safe to show anywhere. */
export const loginFailureMessage = (code: LoginFailure): string => WORDING[code];

/** True when the operator should be sent to the connection screen. */
export const isConfigurationFailure = (code: LoginFailure): boolean =>
  code === "configuration-required" ||
  code === "configuration-invalid" ||
  code === "cloud-unreachable" ||
  code === "cloud-schema-missing";

/**
 * Turn the local readiness answer into a category. `undefined` means the
 * device is ready as far as its saved configuration is concerned.
 */
export function failureFromReadiness(state: ConfigReadiness): LoginFailure | undefined {
  if (state.ready) return undefined;
  switch (state.state) {
    case "missing":
      return "configuration-required";
    case "incomplete":
    case "failed":
      return "configuration-invalid";
    default:
      return undefined;
  }
}

/**
 * Classify what the cloud replied to a password sign-in. Only a genuine
 * credential refusal may be reported as a wrong email or password.
 */
export function failureFromAuthError(
  error: string | { code?: string; message?: string; status?: number } | null | undefined,
): LoginFailure {
  const code = (typeof error === "string" ? "" : error?.code ?? "").toLowerCase();
  const msg = (typeof error === "string" ? error : error?.message ?? "").toLowerCase();
  // Supabase Auth exposes stable machine-readable codes. Prefer them over
  // wording, which can change without changing the actual failure.
  if (["invalid_credentials", "email_not_confirmed"].includes(code))
    return code === "email_not_confirmed" ? "account-inactive" : "invalid-credentials";
  if (["user_banned", "user_not_found"].includes(code)) return "account-inactive";
  if (["validation_failed", "bad_json", "bad_jwt", "no_authorization"].includes(code))
    return "configuration-invalid";
  if (["over_request_rate_limit", "over_email_send_rate_limit"].includes(code))
    return "unknown-error";
  if (!msg) return "unknown-error";
  if (/invalid login credentials|invalid email or password|invalid grant/.test(msg))
    return "invalid-credentials";
  if (/email not confirmed|user is banned|disabled|deactivat/.test(msg)) return "account-inactive";
  if (/failed to fetch|load failed|network|timeout|abort|dns|enotfound|econnrefused/.test(msg))
    return "cloud-unreachable";
  if (/invalid api ?key|no api key|jwt|unrecognized|project not found|not found/.test(msg))
    return "configuration-invalid";
  if (/relation .* does not exist|schema|undefined table/.test(msg)) return "cloud-schema-missing";
  if (/too many requests|rate limit/.test(msg)) return "unknown-error";
  return "unknown-error";
}

/**
 * Classify a cheap read taken against the saved company database *before* a
 * password is ever sent. This is what separates "your password is wrong" from
 * "this terminal is pointed at the wrong place": a refusal on grounds of
 * permission proves the project is reachable and carries the point-of-sale
 * tables, which is all we need to know before trusting a credential refusal.
 *
 * `undefined` means the saved connection is good enough to sign in against.
 */
export function failureFromProbeError(
  error: { message?: string; code?: string } | null | undefined,
): LoginFailure | undefined {
  if (!error) return undefined;
  const code = (error.code ?? "").toUpperCase();
  const msg = (error.message ?? "").toLowerCase();
  // The table is there and the database said "not for you" — exactly right
  // for a signed-out probe.
  if (code === "42501" || /permission denied|row-level security/.test(msg)) return undefined;
  if (code === "PGRST205" || code === "42P01" || /does not exist|undefined table/.test(msg))
    return "cloud-schema-missing";
  if (/invalid api ?key|no api key|jwt/.test(msg)) return "configuration-invalid";
  if (/failed to fetch|load failed|network|timeout|abort|dns|enotfound|econnrefused/.test(msg))
    return "cloud-unreachable";
  // Anything else was still an answer from a live project.
  return undefined;
}
