export type RulesFailure =
  | "none"
  | "config"
  | "network"
  | "auth"
  | "permission"
  | "data"
  | "unknown";

/** Classify a raw database/transport error without leaking credentials. */
export function classifyRulesFailure(message: string): RulesFailure {
  const m = message.toLowerCase();
  if (m.includes("service key is not configured") || m.includes("not configured")) return "config";
  if (
    m.includes("invalid api key") ||
    m.includes("jwt") ||
    m.includes("not signed in") ||
    m.includes("session has ended") ||
    m.includes("could not prove who it is") ||
    m.includes("sign in again") ||
    m.includes("re-activate")
  ) {
    return "auth";
  }
  if (m.includes("permission denied") || m.includes("row-level security") || m.includes("42501")) {
    return "permission";
  }
  if (m.includes("pgrst") || m.includes("schema cache") || m.includes("does not exist")) {
    return "data";
  }
  if (
    m.includes("fetch") ||
    m.includes("network") ||
    m.includes("timeout") ||
    m.includes("econn") ||
    m.includes("getaddrinfo")
  ) {
    return "network";
  }
  return "unknown";
}

/** Only transport failures may queue a change; refusals/context changes may not. */
export function isTransientRulesSaveFailure(error: unknown): boolean {
  const value = error && typeof error === "object" ? error as { code?: unknown; status?: unknown; statusCode?: unknown; message?: unknown } : {};
  if ([400, 401, 403, 409, 422].includes(Number(value.status ?? value.statusCode)) ||
      ["RULES_CONTEXT_CHANGED", "FORBIDDEN", "UNAUTHORIZED", "IDENTITY", "EPRIVILEGE", "EAUTHORISATION", "STORE_FORBIDDEN", "42501", "STALE_RULES"].includes(String(value.code).toUpperCase())) return false;
  return classifyRulesFailure(typeof value.message === "string" ? value.message : String(error)) === "network";
}
