import { fetchWithDeadline } from "@/lib/fetch-deadline";
import { desktopSupabaseFetch } from "@/lib/desktop-supabase-fetch";
// Client for the user's own Supabase project (not the managed backend).
// Publishable keys are safe to ship in client code.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { supabaseConfig } from "@/lib/external-supabase-config";
import { inspectResponse, noteConnectivityIssue } from "@/lib/session-expiry";
import { externalAuthStorage } from "./auth-storage";

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

// New-format keys are opaque strings, not bearer JWTs — send them as `apikey` only.
function supabaseFetchFor(SUPABASE_PUBLISHABLE_KEY: string, useDesktop = true): typeof fetch {
  return async (input, init) => {
    const requestUrl =
      typeof Request !== "undefined" && input instanceof Request ? input.url : String(input);
    if (discardRejectedLogout) {
      try {
        if (new URL(requestUrl).pathname.endsWith("/auth/v1/logout")) {
          return new Response(null, { status: 204 });
        }
      } catch {
        /* malformed URLs continue through the normal fetch path */
      }
    }
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
    const transport = useDesktop ? desktopSupabaseFetch : fetchWithDeadline;
    try {
      const res =
        typeof Request !== "undefined" && input instanceof Request
          ? await transport(new Request(input, { ...init, headers }))
          : await transport(input, { ...init, headers });
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
const MEMBER_STORAGE_KEY = "sb-member-portal-auth-token";
const MEMBER_PROJECT_MARK_KEY = "sb-member-portal-auth-project";
let discardRejectedLogout = false;

/**
 * Forget a server-rejected staff session without calling GoTrue /logout with
 * the already-invalid JWT. AuthProvider clears its React state before this
 * runs; removing the durable token also prevents refresh/catalogue workers
 * from reviving or reusing it.
 */
export async function discardRejectedExternalAuthSession(): Promise<void> {
  if (typeof window === "undefined") return;
  const client = clientRegistry.client;
  if (client) {
    // Let GoTrue own the teardown so its refresh lock, in-memory session and
    // subscribers are updated atomically. The server has already rejected the
    // JWT, so the fetch wrapper acknowledges this one local logout without
    // sending another guaranteed-to-fail request to /auth/v1/logout.
    discardRejectedLogout = true;
    try {
      await client.auth.signOut({ scope: "local" });
    } finally {
      discardRejectedLogout = false;
    }
  }
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(`${STORAGE_KEY}-code-verifier`);
  } catch {
    /* storage unavailable; the in-memory UI session is still cleared */
  }
}

/**
 * A saved session only works against the project that issued it. If the app is
 * now pointed somewhere else, the old token makes every call fail with
 * "unrecognized JWT kid" — so drop it instead of carrying it over.
 */
function dropForeignSession(
  url: string,
  storageKey = STORAGE_KEY,
  projectMarkKey = PROJECT_MARK_KEY,
) {
  if (typeof window === "undefined") return;
  try {
    const previous = localStorage.getItem(projectMarkKey);
    if (previous && previous !== url) localStorage.removeItem(storageKey);
    if (previous !== url) localStorage.setItem(projectMarkKey, url);
  } catch {
    /* storage unavailable */
  }
}

function createExternalClient(
  storageKey = STORAGE_KEY,
  projectMarkKey = PROJECT_MARK_KEY,
  detectSessionInUrl = true,
  persistSession = true,
  configScope: "pos" | "membership" = "pos",
) {
  const { url, key } = supabaseConfig(configScope);
  dropForeignSession(url, storageKey, projectMarkKey);
  return createClient<Database>(url, key, {
    // Keep the key paired with the URL used to construct this client. A
    // periodic connection-profile refresh may replace the global resolver;
    // it must not interrupt an in-flight Auth proof before resetExternalClient
    // swaps the whole client atomically.
    global: { fetch: supabaseFetchFor(key, configScope === "pos") },
    auth: {
      storage: persistSession && typeof window !== "undefined" ? externalAuthStorage : undefined,
      storageKey,
      persistSession,
      autoRefreshToken: true,
      detectSessionInUrl,
    },
  });
}

type ClientConfig = { url: string; key: string };
type ExternalClient = ReturnType<typeof createExternalClient>;
type ExternalClientRegistry = {
  client?: ExternalClient;
  memberClient?: ExternalClient;
  clientConfig?: ClientConfig;
  memberClientConfig?: ClientConfig;
  resetListeners?: Set<() => void>;
};

// Vite HMR, lazy chunks and Electron renderer reloads can evaluate this module
// more than once in the same browser realm. A module-local singleton is not
// enough in that case: each copy creates a GoTrueClient for the same storage
// key and both instances race session refresh and Realtime socket ownership.
// Symbol.for gives every copy one durable owner without exposing it by name.
const CLIENT_REGISTRY_KEY = Symbol.for("retail-pos.supabase.external-clients.v1");
const globalClientRegistry = globalThis as typeof globalThis & {
  [CLIENT_REGISTRY_KEY]?: ExternalClientRegistry;
};
const clientRegistry = (globalClientRegistry[CLIENT_REGISTRY_KEY] ??= {});
const resetListeners = (clientRegistry.resetListeners ??= new Set());

const sameConfig = (left: ClientConfig | undefined, right: ClientConfig | undefined) =>
  Boolean(left && right && left.url === right.url && left.key === right.key);

const resolvedConfig = (scope: "pos" | "membership"): ClientConfig | undefined => {
  try {
    return supabaseConfig(scope);
  } catch {
    return undefined;
  }
};

const retireClient = (client: ExternalClient | undefined): void => {
  if (!client) return;
  client.auth.stopAutoRefresh();
  void client.removeAllChannels().catch(() => {
    /* the retired client no longer owns application state */
  });
};

/**
 * One concrete client for a complete authenticated operation. Holding this
 * snapshot prevents a connection-profile refresh from swapping the proxy
 * between an Auth proof and the protected Data API request it authorises.
 */
export function externalClientSnapshot(): ReturnType<typeof createExternalClient> {
  const currentConfig = resolvedConfig("pos");
  if (
    clientRegistry.client &&
    currentConfig &&
    !sameConfig(clientRegistry.clientConfig, currentConfig)
  ) {
    const previous = clientRegistry.client;
    clientRegistry.client = undefined;
    clientRegistry.clientConfig = undefined;
    retireClient(previous);
  }
  if (!clientRegistry.client) {
    clientRegistry.client = createExternalClient();
    clientRegistry.clientConfig = currentConfig;
  }
  return clientRegistry.client;
}

/**
 * Return the concrete staff client only after GoTrue has restored a bearer
 * session into that same client instance. The application-level staff flag is
 * deliberately checked by callers first; this second check closes the short
 * boot/configuration window where React already knows about a verified user
 * but a newly-created client would otherwise send the Data API request as
 * `anon`.
 */
export async function authenticatedExternalClientSnapshot(): Promise<ExternalClient | null> {
  const client = externalClientSnapshot();
  try {
    const { data, error } = await client.auth.getSession();
    return !error && data.session?.access_token ? client : null;
  } catch {
    return null;
  }
}

/** Re-bind long-lived Auth listeners whenever a tenant client is replaced. */
export function subscribeExternalClientReset(listener: () => void): () => void {
  resetListeners.add(listener);
  return () => resetListeners.delete(listener);
}

/**
 * Customer membership authentication is deliberately isolated from the staff
 * session. A shopper signing in on a shared web register must never replace
 * the cashier's RLS identity. Member login uses an entered OTP, so URL session
 * detection remains off and cannot consume a staff or recovery callback.
 */
export function memberPortalClientSnapshot(): ReturnType<typeof createExternalClient> {
  const currentConfig = resolvedConfig("membership");
  if (
    clientRegistry.memberClient &&
    currentConfig &&
    !sameConfig(clientRegistry.memberClientConfig, currentConfig)
  ) {
    const previous = clientRegistry.memberClient;
    clientRegistry.memberClient = undefined;
    clientRegistry.memberClientConfig = undefined;
    retireClient(previous);
  }
  if (!clientRegistry.memberClient) {
    clientRegistry.memberClient = createExternalClient(
      MEMBER_STORAGE_KEY,
      MEMBER_PROJECT_MARK_KEY,
      false,
      false,
      "membership",
    );
    clientRegistry.memberClientConfig = currentConfig;
  }
  return clientRegistry.memberClient;
}

/**
 * Rebuild the client against a different tenant — used the moment a terminal
 * is activated (or unpaired) so no restart is needed.
 */
export function resetExternalClient(): void {
  const previous = clientRegistry.client;
  const previousMember = clientRegistry.memberClient;
  const nextConfig = resolvedConfig("pos");
  const nextMemberConfig = resolvedConfig("membership");

  // Applying an activation/configuration override can change the resolver's
  // source without changing its actual URL or key. Keep the concrete GoTrue
  // owner in that case: constructing another client with the same storage key
  // triggers Supabase's multiple-client warning and lets two instances race
  // over the same persisted session.
  if (previous && sameConfig(clientRegistry.clientConfig, nextConfig)) {
    clientRegistry.clientConfig = nextConfig;
  } else {
    clientRegistry.client = undefined;
    clientRegistry.clientConfig = undefined;
  }
  if (previousMember && sameConfig(clientRegistry.memberClientConfig, nextMemberConfig)) {
    clientRegistry.memberClientConfig = nextMemberConfig;
  } else {
    clientRegistry.memberClient = undefined;
    clientRegistry.memberClientConfig = undefined;
  }

  if (previous && previous !== clientRegistry.client) {
    // A config refresh must not leave the former Auth client refreshing the
    // same storage key in the background. That produced duplicate GoTrue
    // clients and races where one instance restored a stale bearer token.
    retireClient(previous);
  }
  if (previousMember && previousMember !== clientRegistry.memberClient) {
    retireClient(previousMember);
  }
  if (previous && previous !== clientRegistry.client) {
    for (const listener of resetListeners) {
      try {
        listener();
      } catch {
        /* one stale UI subscriber must not block the client handover */
      }
    }
  }
}

/** A throwaway client for a tenant this machine is not registered to yet. */
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
          return fetchWithDeadline(new Request(input, { ...init, headers }));
        }
        return fetchWithDeadline(input, { ...init, headers });
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      // Supabase warns when independent clients share its default project key
      // even when persistence is disabled. Probe/activation clients are
      // deliberately isolated and never own the live staff session.
      storageKey: `pos-transient-auth-${crypto.randomUUID()}`,
    },
  });
}

export const supabaseExternal = new Proxy({} as ReturnType<typeof createExternalClient>, {
  get(_, prop, receiver) {
    return Reflect.get(externalClientSnapshot(), prop, receiver);
  },
});
