/** Shared session activity rules. Polling must never extend this clock. */
export const SESSION_ACTIVITY_WINDOW_MS = 24 * 60 * 60_000;

export function sessionActivityExpiresAt(session: {
  last_activity_at: string;
  idle_timeout_minutes: number;
}): number {
  const activity = Date.parse(session.last_activity_at);
  const minutes = Number(session.idle_timeout_minutes);
  const idle = Number.isFinite(minutes) && minutes > 0 ? Math.min(1440, Math.max(1, minutes)) : 30;
  return Number.isFinite(activity) ? activity + idle * 60_000 : 0;
}

export function isVisibleActiveSession(session: {
  last_activity_at: string;
  idle_timeout_minutes: number;
  is_revoked: boolean;
}, now = Date.now()): boolean {
  const activity = Date.parse(session.last_activity_at);
  return !session.is_revoked && activity > now - SESSION_ACTIVITY_WINDOW_MS &&
    activity <= now && sessionActivityExpiresAt(session) > now;
}
