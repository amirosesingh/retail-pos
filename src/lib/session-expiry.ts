/**
 * One place that decides what an unhappy HTTP answer means for the session.
 *
 * A rejected token (401, or a 403 the server explains as a JWT problem) means
 * the sign-in is genuinely dead: the terminal wipes its session and returns to
 * the login screen. A timeout, an offline moment or a 5xx never signs anyone
 * out — the till keeps working and only raises a connectivity warning.
 */

import { isCurrentEpoch, sessionEpoch } from "./session-epoch";

type Listener = () => void;

const listeners = new Set<Listener>();
let announcing = false;

export function onSessionExpired(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Fire once per burst — a dead token usually fails several calls at a time. */
export function notifySessionExpired(startedAt = sessionEpoch()): void {
  if (!isCurrentEpoch(startedAt)) return;
  if (announcing) return;
  announcing = true;
  setTimeout(() => {
    announcing = false;
  }, 8000);
  for (const cb of listeners) {
    try {
      cb();
    } catch {
      /* a listener must never break the others */
    }
  }
}

/** PostgREST / GoTrue codes that mean "this token is no longer valid". */
const JWT_HINTS =
  /(pgrst301|pgrst303|jwt expired|invalid jwt|jwt is expired|invalid claim|bad_jwt|token is expired|session[_ ]not[_ ]found|user[_ ]not[_ ]found|invalid token|refresh[_ ]token.*(?:missing|not[_ ]found|already[_ ]used|invalid|expired))/i;

/**
 * True when the answer proves the caller's token is missing, stale or revoked.
 * A plain 403 from a row-level rule is NOT an expired session, so it only
 * counts when the body names a token problem.
 */
export function isTokenRejection(status: number, body: string): boolean {
  if (status === 401) return true;
  if (status === 400 || status === 403 || status === 422) return JWT_HINTS.test(body);
  return false;
}

let lastWarning = 0;

/** Remove the shared connectivity warning after a confirmed recovery. */
export function clearConnectivityIssue(): void {
  lastWarning = 0;
  if (typeof window === "undefined") return;
  void import("sonner").then(({ toast }) => toast.dismiss("pos-connectivity"));
}

/** Temporary "we can't reach the server" note. Never signs anyone out. */
export function noteConnectivityIssue(detail?: string): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - lastWarning < 15000) return;
  lastWarning = now;
  void import("sonner").then(({ toast }) => {
    toast.warning("Connection trouble", {
      id: "pos-connectivity",
      description:
        detail ?? "The server did not answer. The till keeps working and will retry shortly.",
    });
  });
}

/**
 * Inspect a finished response from the central database. Safe to call with a
 * clone; it never throws.
 */
export async function inspectResponse(res: Response, hadBearer: boolean, startedAt = sessionEpoch()): Promise<void> {
  try {
    if (res.status >= 500) {
      noteConnectivityIssue(
        "The server is temporarily unavailable. The till will retry automatically.",
      );
      return;
    }
    if (res.status !== 401 && res.status !== 403) return;
    if (!hadBearer) return; // an anonymous call being refused is not a dead session
    const body = await res.text().catch(() => "");
    if (isTokenRejection(res.status, body)) notifySessionExpired(startedAt);
  } catch {
    /* diagnostics must never break a request */
  }
}
