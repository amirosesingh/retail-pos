import type { CloudDiagnosis, CloudVerdict, Connectivity } from "@/core/activation/connection-health";

/** Backend readiness is not proof of an internet outage during first setup. */
export function connectionLabel(state: Connectivity, verdict: CloudVerdict, issue: CloudDiagnosis["issue"]) {
  if (state === "online") return "Online";
  if (state === "connecting") return "Checking connection";
  if (verdict === "unconfigured" || issue === "configuration") return "Connection setup required";
  if (issue === "authentication") return "Sign-in required";
  if (issue === "permission") return "Access restricted";
  if (issue === "device-offline") return "Offline";
  return "Cannot reach server";
}
