// Client for the user's own Supabase project (not the managed backend).
// Publishable keys are safe to ship in client code.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { supabaseConfig } from "@/lib/external-supabase-config";
import { inspectResponse, noteConnectivityIssue } from "@/lib/session-expiry";

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

// New-format keys are opaque strings, not bearer JWTs — send them as `apikey` only.
function supabaseFetchFor(SUPABASE_PUBLISHABLE_KEY: string): typeof fetch {
  return async (input, init) => {
    const requestHeaders =
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined;
    const headers = new Headers(requestHeaders);
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    if (
      isNewSupabaseApiKey(SUPABASE_PUBLISHABLE_KEY) &&
      headers.get("Authorization") === `Bearer ${SUPABASE_PUBLISHABLE_KEY}`
    ) {
      headers.delete("Authorization");
    }
    headers.set("apikey", SUPABASE_PUBLISHABLE_KEY);
    // A bearer here means a real user session; only those can "expire".
    const hadBearer = !!headers.get("Authorization");
    try {
      const res =
        typeof Request !== "undefined" && input instanceof Request
          ? await fetch(new Request(input, { ...init, headers }))
          : await fetch(input, { ...init, headers });
      void inspectResponse(res.clone(), hadBearer);
      return res;
    } catch (e) {
      // Network failure / timeout: warn, never sign out.
      noteConnectivityIssue();
      throw e;
    }
  };
}

const STORAGE_KEY = "sb-external-auth-token";
const PROJECT_MARK_KEY = "sb-external-auth-project";

/**
 * A saved session only works against the project that issued it. If the app is
 * now pointed somewhere else, the old token makes every call fail with
 * "unrecognized JWT kid" — so drop it instead of carrying it over.
 */
function dropForeignSession(url: string) {
  if (typeof window === "undefined") return;
  try {
    const previous = localStorage.getItem(PROJECT_MARK_KEY);
    if (previous && previous !== url) localStorage.removeItem(STORAGE_KEY);
    if (previous !== url) localStorage.setItem(PROJECT_MARK_KEY, url);
  } catch {
    /* storage unavailable */
  }
}

function createExternalClient() {
  const { url, key } = supabaseConfig();
  dropForeignSession(url);
  return createClient<Database>(url, key, {
    // Keep the key paired with the URL used to construct this client. A
    // periodic connection-profile refresh may replace the global resolver;
    // it must not interrupt an in-flight Auth proof before resetExternalClient
    // swaps the whole client atomically.
    global: { fetch: supabaseFetchFor(key) },
    auth: {
      storage: typeof window !== "undefined" ? localStorage : undefined,
      storageKey: STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

let _client: ReturnType<typeof createExternalClient> | undefined;

/**
 * Rebuild the client against a different tenant — used the moment a terminal
 * is activated (or unpaired) so no restart is needed.
 */
export function resetExternalClient(): void {
  const previous = _client;
  _client = undefined;
  if (previous) {
    // A config refresh must not leave the former Auth client refreshing the
    // same storage key in the background. That produced duplicate GoTrue
    // clients and races where one instance restored a stale bearer token.
    previous.auth.stopAutoRefresh();
    void previous.removeAllChannels();
  }
}

/** A throwaway client for a tenant this machine is not registered to yet. */
let transientClientSequence = 0;
export function createTenantClient(url: string, key: string) {
  return createClient<Database>(url, key, {
    global: {
      fetch: (input, init) => {
        const requestHeaders =
          typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined;
        const headers = new Headers(requestHeaders);
        if (init?.headers) {
          new Headers(init.headers).forEach((value, k) => headers.set(k, value));
        }
        if (isNewSupabaseApiKey(key) && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        if (typeof Request !== "undefined" && input instanceof Request) {
          return fetch(new Request(input, { ...init, headers }));
        }
        return fetch(input, { ...init, headers });
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      // Supabase warns when independent clients share its default project key
      // even when persistence is disabled. Probe/activation clients are
      // deliberately isolated and never own the live staff session.
      storageKey: `pos-transient-auth-${++transientClientSequence}`,
    },
  });
}

export const supabaseExternal = new Proxy({} as ReturnType<typeof createExternalClient>, {
  get(_, prop, receiver) {
    if (!_client) _client = createExternalClient();
    return Reflect.get(_client, prop, receiver);
  },
});
