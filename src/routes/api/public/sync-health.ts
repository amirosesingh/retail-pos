import { createFileRoute } from "@tanstack/react-router";

import { corsPreflight, withCors } from "@/lib/public-cors";

/**
 * GET /api/public/sync-health
 *
 * Tells an administrator whether the server that answered the browser can
 * reach the central database. It reports presence only — never key values,
 * lengths or prefixes — so it is safe to leave open.
 */
async function handleGet(): Promise<Response> {
        const { publiclyReadable } = await import("@/lib/public-api-guard.server");
        const denied = publiclyReadable(
          "presence-only flags: no key values, lengths or prefixes are returned",
        );
        if (denied) return denied;
        const { hasServiceKey } = await import("@/core/api/pos-relay.server");
        const { hasSupabaseConfig, supabaseConfigSource, runtimeEnvValue } = await import(
          "@/lib/external-supabase-config"
        );
        const { hasMembershipGatewayConfig } = await import("@/lib/membership-service.server");
        // Presence only — never a value, a length or a prefix. Each line
        // accepts every name the resolver accepts, so a value supplied under
        // an alias is not reported as missing.
        const present = (...names: string[]) =>
          names.some((name) => Boolean(runtimeEnvValue(name) ?? process.env[name]));
        return Response.json(
          {
            serviceKey: hasServiceKey(),
            posUrl: hasSupabaseConfig(),
            posUrlSource: supabaseConfigSource(),
            // Presence only. The membership URL and privileged key never
            // leave the hosted backend during the device handshake.
            membershipService: hasMembershipGatewayConfig(),
            cloudflare: {
              SUPABASE_URL: present("SUPABASE_URL", "VITE_POS_SUPABASE_URL", "VITE_SUPABASE_URL"),
              SUPABASE_ANON_KEY: present(
                "SUPABASE_ANON_KEY",
                "SUPABASE_PUBLISHABLE_KEY",
                "VITE_POS_SUPABASE_ANON_KEY",
                "VITE_SUPABASE_PUBLISHABLE_KEY",
              ),
              // The write-relay key is reported by `serviceKey` above; naming
              // it here would trip the client-code secret guard.
              SETTINGS_ENCRYPTION_KEY: present("SETTINGS_ENCRYPTION_KEY"),
            },

            runtime: process.env["NODE_ENV"] === "production" ? "edge" : "dev",
          },
          { headers: { "Cache-Control": "no-store" } },
        );
}

export const Route = createFileRoute("/api/public/sync-health")({
  server: {
    handlers: {
      GET: async ({ request }) => withCors(await handleGet(), request),
      OPTIONS: async ({ request }) => corsPreflight(request),
    },
  },
});
