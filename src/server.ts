import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { setRuntimeEnv, supabaseConfig } from "./lib/external-supabase-config";
import { withWebSecurityHeaders } from "./lib/web-security-headers";
import { appleAppAssociation } from "./lib/apple-app-association";
import { corsPreflight, withCors } from "./lib/public-cors";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

function configuredSupabaseUrls(): string[] {
  const urls: string[] = [];
  for (const scope of ["pos", "membership"] as const) {
    try {
      urls.push(supabaseConfig(scope).url);
    } catch {
      // The error page can still render while one independently configured
      // backend is unavailable.
    }
  }
  return urls;
}

function secure(response: Response): Response {
  return withWebSecurityHeaders(response, configuredSupabaseUrls());
}

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      // Nitro's Cloudflare adapter saves the Worker bindings before delegating
      // the Request to the SSR entry without its second argument.
      const bindings = env ?? (globalThis as typeof globalThis & { __env__?: unknown }).__env__;
      setRuntimeEnv(bindings);
      const association = appleAppAssociation(request, bindings);
      if (association) return secure(association);
      // This credential-verified endpoint does not need the application's UI
      // router. Keep its exact methods/path and the same response protections.
      if (new URL(request.url).pathname === "/api/public/cashier-login") {
        if (request.method === "OPTIONS") return secure(corsPreflight(request));
        // cf is runtime metadata, never a field in the submitted JSON or a
        // forwarding header. Other runtimes need the original framework scope
        // to resolve their transport address, so their POSTs fall through.
        const cf = (request as Request & { cf?: unknown }).cf;
        if (request.method === "POST" && cf !== null && typeof cf === "object") {
          const { handleCashierLogin } = await import("./lib/cashier-login-endpoint.server");
          const transport = { trustedWorkerIp: request.headers.get("cf-connecting-ip") };
          const response = withCors(await handleCashierLogin(request, transport), request);
          return secure(await normalizeCatastrophicSsrResponse(response));
        }
      }
      // Native API requests retain their existing guards but do not need the
      // UI router. Runtime metadata cannot be supplied in a client header/body.
      const cf = (request as Request & { cf?: unknown }).cf;
      if (cf !== null && typeof cf === "object") {
        const url = new URL(request.url);
        if (url.pathname === "/api/v1/pos/sync" && !url.searchParams.has("operation")) {
          if (request.method === "OPTIONS") return secure(corsPreflight(request));
          if (request.method === "POST") {
            const { handleSyncRequest } = await import("./lib/sync-endpoint.server");
            const response = withCors(await handleSyncRequest(request), request);
            return secure(await normalizeCatastrophicSsrResponse(response));
          }
        }
        if (request.method === "POST" && url.pathname === "/api/v1/pos/ipc-adopt") {
          const { handleIpcAdopt } = await import("./lib/ipc-adopt-endpoint.server");
          return secure(await normalizeCatastrophicSsrResponse(await handleIpcAdopt(request)));
        }
        if (request.method === "POST" && url.pathname === "/api/v1/pos/shift-author-enroll") {
          const { handleShiftAuthorEnroll } = await import("./lib/shift-author-enroll-endpoint.server");
          return secure(await normalizeCatastrophicSsrResponse(await handleShiftAuthorEnroll(request)));
        }
      }
      const handler = await getServerEntry();
      const response = await handler.fetch(request, bindings, ctx);
      return secure(await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      const misconfigured =
        error instanceof Error && error.name === "SupabaseConfigError" ? error.message : undefined;
      return secure(
        new Response(renderErrorPage(misconfigured), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
