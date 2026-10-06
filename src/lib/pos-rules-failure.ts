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
