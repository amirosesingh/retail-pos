/** Credential switches are independent of page permissions and are never copied with them. */
export const APPROVAL_PIN_KEY = "approval_pin_enabled";
export const APPROVAL_TOTP_KEY = "approval_totp_enabled";
export function approvalMethods(permissions: Record<string, unknown> | null | undefined) {
  return {
    pin: permissions?.[APPROVAL_PIN_KEY] !== false,
    totp: permissions?.[APPROVAL_TOTP_KEY] === true,
  };
}
export function preserveApprovalMethods(
  next: Record<string, boolean>,
  previous: Record<string, unknown> | null | undefined,
) {
  const clean = { ...next };
  delete clean[APPROVAL_PIN_KEY];
  delete clean[APPROVAL_TOTP_KEY];
  for (const key of [APPROVAL_PIN_KEY, APPROVAL_TOTP_KEY])
    if (typeof previous?.[key] === "boolean") clean[key] = previous[key];
  return clean;
}
export const APPROVAL_TOKEN_LEASE_MS = 24 * 60 * 60 * 1000;
/** Maximum time a registered device may keep generating/verifying codes offline. */
export const OFFLINE_APPROVAL_TOKEN_LEASE_MS = 30 * 24 * 60 * 60 * 1000;
