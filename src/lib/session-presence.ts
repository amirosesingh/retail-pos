/**
 * "Is anybody signed in on this device right now?" — one shared answer for the
 * background jobs that must not run for a visitor sitting on the sign-in
 * screen.
 *
 * Every central table is protected by row-level security, so a signed-out
 * browser that keeps syncing does not read or write anything: it only produces
 * a steady stream of rejected requests. Sync and telemetry therefore ask here
 * first and stay quiet until somebody is actually signed in.
 *
 * Three identities count, because the POS has three ways in:
 *   • a back-office account (central authentication session)
 *   • a cashier signed in on a till (session token)
 *   • the till itself, holding a cashier token from an earlier sign-in
 */
import { cashierTokenSync, sessionTokenSync } from "./pos-credentials";

let authSession = false;

/**
 * AuthProvider is the authority for this flag. In particular, a persisted
 * token is not counted until its server-side session has been checked.
 */
export function setCentralAuthSessionPresent(value: boolean): void {
  authSession = value;
}

/** A persisted JWT counts only after AuthProvider has verified it server-side. */
export function hasCentralAuthSession(): boolean {
  return authSession;
}

/**
 * True when a request sent right now would carry an identity the database
 * will accept. Synchronous on purpose: it guards hot paths (sync ticks,
 * heartbeats) that must not await anything.
 */
export function hasSignedInIdentity(): boolean {
  if (typeof window === "undefined") return false;
  return authSession || Boolean(sessionTokenSync()) || Boolean(cashierTokenSync());
}

/** Test seam. */
export function __setAuthSessionForTests(value: boolean) {
  setCentralAuthSessionPresent(value);
}
