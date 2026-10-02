import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { setRuntimeEnv, supabaseConfig } from "./lib/external-supabase-config";
import { withWebSecurityHeaders } from "./lib/web-security-headers";

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
      // Cloudflare passes variables and secrets per request, so hand them to
      // the configuration module before anything tries to reach the database.
      setRuntimeEnv(env);
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
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
