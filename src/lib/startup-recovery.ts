import type { ConfigReadiness } from "./platform-config-ready";
import type { RegistrationState } from "@/core/activation/activation-record";

/** A transport outage is never evidence that setup or registration is missing. */
export function needsSetupRecovery(profile: ConfigReadiness | null, registration: RegistrationState | null, configurationRejected = false): boolean {
  return configurationRejected || profile?.state === "missing" || profile?.state === "incomplete" || registration === "not-registered";
}
