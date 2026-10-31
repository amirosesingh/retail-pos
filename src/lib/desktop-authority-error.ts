/** Public messages are local constants; IPC/server diagnostics never become UI text. */
const messages = {
  EBACKEND_UPGRADE_REQUIRED: "The configured POS backend needs an update before it can verify this terminal. Ask an administrator to update the backend.",
  EACTIVATION_BINDING: "This terminal's saved registration does not match its verified computer registration. Ask an administrator to review the registration.",
  EAUTH_UNAVAILABLE: "The POS backend is temporarily unavailable. Check the connection and try again.",
  EAUTH_DENIED: "Your sign-in or access could not be verified. Sign in again or ask an administrator.",
} as const;

export type DesktopAuthorityFailureCode = keyof typeof messages;
export type DesktopAuthorityFailure = {
  ok: false;
  code: DesktopAuthorityFailureCode;
  status: 401 | 403 | 426 | 503;
  error: string;
};

/** Recognize only the native authority contract, never arbitrary error messages. */
export function desktopAuthorityFailure(value: unknown): DesktopAuthorityFailure | null {
  if (!value || typeof value !== "object") return null;
  const cause = value as { code?: unknown; status?: unknown };
  switch (cause.code) {
    case "EBACKEND_UPGRADE_REQUIRED":
      return { ok: false, code: cause.code, status: 426, error: messages[cause.code] };
    case "EACTIVATION_BINDING":
      return { ok: false, code: cause.code, status: 403, error: messages[cause.code] };
    case "EAUTH_UNAVAILABLE":
      return { ok: false, code: cause.code, status: 503, error: messages[cause.code] };
    case "EAUTH_DENIED":
      return { ok: false, code: cause.code, status: cause.status === 401 ? 401 : 403, error: messages[cause.code] };
    default:
      return null;
  }
}

export function desktopAuthorityError(value: unknown): Error & { code: string; status?: number } {
  const failure = desktopAuthorityFailure(value);
  return failure
    ? Object.assign(new Error(failure.error), { code: failure.code, status: failure.status })
    : Object.assign(new Error("The signed-in account could not be verified on this PC."), { code: "EPRIVILEGE" });
}
