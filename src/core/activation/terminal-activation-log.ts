/**
 * Activation attempts, written where an administrator can see them.
 *
 * The local activity journal retains attempts until an authorized session can
 * sync them. Registration clients are anonymous and cannot write audit rows.
 */
import { APP_VERSION } from "@/version";
import { logger } from "@/lib/audit-log";
import { isAndroid, isIOS } from "@/platform-config/platform";
import { isWindowsShell, isMobileShell } from "@/platform-config/features";

export type ActivationOutcome =
  | "succeeded"
  | "already_claimed"
  | "expired"
  | "revoked"
  | "invalid_code"
  | "unreachable";

const OUTCOME_LABEL: Record<ActivationOutcome, string> = {
  succeeded: "Terminal activation succeeded",
  already_claimed: "Terminal activation blocked — code already claimed",
  expired: "Terminal activation blocked — code expired",
  revoked: "Terminal activation blocked — code revoked",
  invalid_code: "Terminal activation blocked — invalid code",
  unreachable: "Terminal activation failed — database unreachable",
};

/** Which shell attempted the activation. */
export function activationPlatform(): string {
  if (isWindowsShell()) return "windows-desktop";
  if (isAndroid()) return "android";
  if (isIOS()) return "ios";
  if (isMobileShell()) return "mobile";
  return "browser";
}

function deviceName(): string {
  return typeof navigator === "undefined" ? "unknown device" : navigator.userAgent.slice(0, 160);
}

export type ActivationAttempt = {
  outcome: ActivationOutcome;
  terminalId: string | null;
  branchId?: string | null;
  branchName?: string | null;
  reason?: string;
};

/**
 * Record one attempt. Never throws: a failed log must not stop, or mask, an
 * activation.
 */
export async function recordActivationAttempt(
  _tenant: unknown,
  attempt: ActivationAttempt,
): Promise<void> {
  const details = {
    outcome: attempt.outcome,
    terminalId: attempt.terminalId ?? null,
    branchId: attempt.branchId ?? null,
    branchName: attempt.branchName ?? null,
    devicePlatform: activationPlatform(),
    deviceName: deviceName(),
    appVersion: APP_VERSION,
    reason: attempt.reason ?? null,
    at: new Date().toISOString(),
  };

  try {
    logger.log("security", OUTCOME_LABEL[attempt.outcome], "Terminal activation", details);
  } catch {
    /* local trail unavailable (server render) */
  }

}
