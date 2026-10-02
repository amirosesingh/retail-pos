/**
 * Cloudflare only reveals its variables while the app is running, so the
 * server prints the public half (project address + publishable key) into the
 * page. The browser reads it before any database call is made. The service
 * key is never included here.
 */
import { publicSupabaseConfig } from "./external-supabase-config";

export function publicConfigScript(): string {
  const config = publicSupabaseConfig();
  const membership = publicSupabaseConfig("membership");
  if (!config?.url || !config.key) return "";
  const payload = JSON.stringify({
    SUPABASE_URL: config.url,
    SUPABASE_ANON_KEY: config.key,
    ...(membership?.url && membership.key
      ? {
          MEMBERSHIP_SUPABASE_URL: membership.url,
          MEMBERSHIP_SUPABASE_PUBLISHABLE_KEY: membership.key,
        }
      : {}),
  }).replace(/</g, "\\u003c");
  return `window.__POS_CONFIG__=Object.assign(window.__POS_CONFIG__||{},${payload});`;
}
