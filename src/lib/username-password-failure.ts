import type { LoginFailure } from "./login-failure";

/** A gateway's 401 is not proof that the password verifier refused credentials. */
export function usernamePasswordFailure(status: number, payload: { code?: string } | null): LoginFailure {
  if (status === 401 && payload?.code === "invalid_credentials") return "invalid-credentials";
  if (status === 429 || payload?.code === "locked") return "unknown-error";
  if (status === 403) return "permission-denied";
  if (payload?.code === "invalid_api_key") return "configuration-invalid";
  return "cloud-unreachable";
}
