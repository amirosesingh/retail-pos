import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

/** A closed browser request has no recipient; it is not an application failure. */
export function handleDisconnectedRequest(
  error: unknown, request: IncomingMessage, _response: ServerResponse,
  next: (error?: unknown) => void,
): void {
  const failure = error as { code?: unknown; message?: unknown } | null;
  if (request.aborted && failure?.code === "ECONNRESET" && failure.message === "aborted") return;
  next(error);
}

export function disconnectedRequestRecovery(): Plugin {
  return {
    name: "dev-disconnected-request-recovery",
    apply: "serve",
    enforce: "post",
    configureServer(server) {
      // Run after Nitro's request handler, before Vite's final overlay handler.
      return () => { server.middlewares.use(handleDisconnectedRequest); };
    },
  };
}
