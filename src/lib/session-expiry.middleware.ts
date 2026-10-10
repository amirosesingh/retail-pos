/**
 * Client-side check on every server-function call: a 401 (or a JWT-flavoured
 * 403) means the sign-in is dead and the terminal must return to the login
 * screen. Anything else — including 5xx and network drops — is left alone.
 */
import { createMiddleware } from "@tanstack/react-start";

import { isTokenRejection, notifySessionExpired, noteConnectivityIssue } from "./session-expiry";
import { sessionEpoch } from "./session-epoch";

type MaybeHttpError = { status?: number; statusCode?: number; message?: string };

export const sessionExpiryMiddleware = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const startedAt = sessionEpoch();
    try {
      return await next();
    } catch (error) {
      const err = error as MaybeHttpError;
      const status = err?.status ?? err?.statusCode ?? 0;
      const message = String(err?.message ?? "");
      if (status >= 500)
        noteConnectivityIssue(
          "The server is temporarily unavailable. The till will retry automatically.",
        );
      else if (status && isTokenRejection(status, message)) notifySessionExpired(startedAt);
      throw error;
    }
  },
);
