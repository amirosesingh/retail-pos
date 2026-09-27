import type { Session } from "@supabase/supabase-js";
import { isTokenRejection } from "./session-expiry";

type AuthErrorLike = { message: string; status?: number };

/** The small Auth surface needed to validate a persisted session. */
export type AuthSessionApi = {
  getSession: () => Promise<{
    data: { session: Session | null };
    error?: AuthErrorLike | null;
  }>;
  refreshSession: () => Promise<{
    data: { session: Session | null };
    error: AuthErrorLike | null;
  }>;
  getUser: () => Promise<{
    data: { user: unknown | null };
    error: AuthErrorLike | null;
  }>;
};

export type AuthSessionCheck =
  | { state: "signed-out" | "rejected" | "unavailable"; session: null }
  | { state: "verified" | "unverified"; session: Session };

export type SessionVerifier = (
  session: Session,
) => Promise<"verified" | "rejected" | "unavailable">;

const rejected = (error: AuthErrorLike | null | undefined) =>
  Boolean(error && isTokenRejection(Number(error.status ?? 0), error.message));

/**
 * Validate a locally persisted Supabase session before the UI or background
 * workers are allowed to treat it as signed in.
 *
 * `getSession()` alone only reads the saved token. `getUser()` is the
 * authoritative server check. A network failure preserves the local session
 * so a till can continue offline; a definite token refusal does not.
 */
export async function validateStoredAuthSession(
  auth: AuthSessionApi,
  options: {
    online: boolean;
    now?: number;
    refreshLeewayMs?: number;
    /**
     * Hosted clients validate through the app server. It performs the same
     * GoTrue `/user` check without exposing an expected revoked-session 403
     * as a failed browser resource in DevTools.
     */
    verifySession?: SessionVerifier;
  },
): Promise<AuthSessionCheck> {
  let current: Session | null;
  try {
    const loaded = await auth.getSession();
    if (rejected(loaded.error)) return { state: "rejected", session: null };
    current = loaded.data.session;
  } catch {
    return { state: "unavailable", session: null };
  }

  if (!current) return { state: "signed-out", session: null };
  if (!options.online) return { state: "unverified", session: current };

  const now = options.now ?? Date.now();
  const refreshLeewayMs = options.refreshLeewayMs ?? 90_000;
  const expiresAt = Number(current.expires_at ?? 0) * 1000;
  if (expiresAt > 0 && expiresAt <= now + refreshLeewayMs) {
    try {
      const refreshed = await auth.refreshSession();
      if (refreshed.error) {
        return rejected(refreshed.error)
          ? { state: "rejected", session: null }
          : { state: "unverified", session: current };
      }
      if (!refreshed.data.session) return { state: "rejected", session: null };
      current = refreshed.data.session;
    } catch {
      return { state: "unverified", session: current };
    }
  }

  if (options.verifySession) {
    try {
      const state = await options.verifySession(current);
      return state === "verified"
        ? { state, session: current }
        : state === "rejected"
          ? { state, session: null }
          : { state: "unverified", session: current };
    } catch {
      return { state: "unverified", session: current };
    }
  }

  try {
    const checked = await auth.getUser();
    if (!checked.error && checked.data.user) return { state: "verified", session: current };
    return rejected(checked.error)
      ? { state: "rejected", session: null }
      : { state: "unverified", session: current };
  } catch {
    return { state: "unverified", session: current };
  }
}
