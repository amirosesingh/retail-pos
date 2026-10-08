/**
 * Stops the till shouting "database offline" when it plainly is not.
 *
 * Every connectivity-flavoured message passes through here first. If either
 * the central database or the local SQL Server is reachable, the warning is
 * dropped and any banner already on screen is cleared. Only when *both* are
 * unreachable does the operator see it — and then it is the one that matters.
 *
 * Real failures (permission, validation, duplicate keys) are not connectivity
 * messages, so they are never suppressed.
 */
import { anyDatabaseReachable } from "@/core/activation/connection-health";

/** Event fired when a stale connectivity banner should disappear. */
export const CLEAR_EVENT = "pos:db-warning-clear";

const CONNECTIVITY =
  /database offline|database connection required|connection missing|could not reach|unable to reach|cannot reach|central database key missing|server setup|offline|failed to fetch|network|will sync when the connection|saved on this terminal|queued locally|relay is offline/i;

/** Does this message talk about connectivity rather than a real refusal? */
export function isConnectivityMessage(message: string): boolean {
  return CONNECTIVITY.test(message ?? "");
}

/** Tell any banner on screen that the connection is fine again. */
export function clearConnectivityBanners() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CLEAR_EVENT));
}

/**
 * Should this connectivity warning be shown? `false` means at least one
 * database answered, so the warning is wrong and has been cleared instead.
 */
export async function connectivityWarningAllowed(): Promise<boolean> {
  if (await anyDatabaseReachable()) {
    clearConnectivityBanners();
    return false;
  }
  return true;
}

/**
 * Run `show` only when the message survives the guard. Non-connectivity
 * messages are shown straight away, with no probe and no delay.
 */
export function guardNotification(message: string, show: () => void): void {
  if (!isConnectivityMessage(message)) {
    show();
    return;
  }
  void connectivityWarningAllowed().then((allowed) => {
    if (allowed) show();
  }).catch(() => show());
}