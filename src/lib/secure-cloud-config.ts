/**
 * Cross-platform access to the tenant's central cloud credentials
 * (Supabase URL + publishable key) on terminal apps.
 *
 * - Windows (Electron): values live in the OS vault (DPAPI via safeStorage),
 *   written and read through the main-process bridge. The renderer only ever
 *   sees a masked hint.
 * - Android (APK): values live in the Android Keystore via
 *   EncryptedSharedPreferences (capacitor-secure-storage-plugin).
 * - Web: nothing to do — the deployment carries its own publishable config.
 *
 * After any change the in-memory tenant override is refreshed so the next
 * cloud call picks the new credentials up without an app restart.
 */
import { isTerminalApp } from "@/platform-config/platform";
import { isWindowsShell, isMobileShell } from "@/platform-config/features";
import {
  setTerminalSupabaseOverride,
  clearTerminalSupabaseOverride,
  hasSupabaseConfig,
  supabaseConfig,
} from "./external-supabase-config";
import { resetExternalClient, createTenantClient } from "@/integrations/supabase/external-client";
import { setSyncState } from "./sync-status";
import { runExclusive } from "./sync-engine";
import {
  backendUrl,
  normaliseBackendUrl,
  saveBackendUrl,
  testBackendUrl,
  type BackendTestResult,
} from "./backend-config";

/** Fresh keys saved: unpark the sync engine and let it catch up at once. */
function afterCredentialsSaved() {
  setSyncState({ credentialsInvalid: false, lastError: null, cloudConfigured: true });
  void runExclusive("credentials-saved").catch(() => {});
}

export type CloudKeyStatus = {
  configured: boolean;
  /** Tenant URL — not a secret, safe to prefill in the settings form. */
  url: string;
  /** Masked key (first 6 … last 4). The full key never reaches the renderer on Electron. */
  keyHint: string;
  /** True when the platform vault encrypted the values at rest. */
  encrypted: boolean;
  source: "electron" | "android" | "web";
};

const ANDROID_URL_KEY = "pos.cloud.url";
const ANDROID_KEY_KEY = "pos.cloud.key";

type SecureStoragePluginType = {
  get(options: { key: string }): Promise<{ value: string }>;
  set(options: { key: string; value: string }): Promise<{ value: boolean }>;
  remove(options: { key: string }): Promise<{ value: boolean }>;
};

/**
 * The plugin handle is returned inside a wrapper object: a Capacitor plugin
 * Proxy answers every property — `then` included — with a native call, so
 * returning it straight from an `async` function makes the runtime call
 * `SecureStoragePlugin.then(...)` and Android replies "not implemented".
 */
async function androidStore(): Promise<{ value: SecureStoragePluginType } | null> {
  try {
    const mod = await import("capacitor-secure-storage-plugin");
    const plugin = mod.SecureStoragePlugin as unknown as SecureStoragePluginType | undefined;
    if (!plugin || typeof plugin.get !== "function") return null;
    return { value: plugin };
  } catch {
    return null;
  }
}

async function androidRead(): Promise<{ url: string; key: string } | null> {
  try {
    const loaded = await androidStore();
    if (!loaded) return null;
    const store = loaded.value;
    const [url, key] = await Promise.all([
      store.get({ key: ANDROID_URL_KEY }).then((r) => r.value, () => ""),
      store.get({ key: ANDROID_KEY_KEY }).then((r) => r.value, () => ""),
    ]);
    return url && key ? { url, key } : null;
  } catch {
    return null;
  }
}


const mask = (key: string) => (key.length > 10 ? `${key.slice(0, 6)}…${key.slice(-4)}` : "••••");

export async function cloudKeyStatus(): Promise<CloudKeyStatus> {
  if (isWindowsShell() && window.pos?.cloudKeyStatus) {
    const res = await window.pos.cloudKeyStatus();
    return {
      configured: Boolean(res.configured),
      url: res.url ?? "",
      keyHint: res.keyHint ?? "",
      encrypted: Boolean(res.encrypted),
      source: "electron",
    };
  }
  if (isMobileShell()) {
    const saved = await androidRead();
    return {
      configured: Boolean(saved),
      url: saved?.url ?? "",
      keyHint: saved ? mask(saved.key) : "",
      encrypted: true,
      source: "android",
    };
  }
  return {
    configured: hasSupabaseConfig(),
    url: hasSupabaseConfig() ? supabaseConfig().url : "",
    keyHint: "",
    encrypted: false,
    source: "web",
  };
}

export type CloudTestResult = { ok: boolean; detail: string };

/**
 * Two separate questions, answered separately, because a brand-new customer
 * has a perfectly good project whose POS schema has not been created yet:
 *
 *   A. reachable + authenticated — the address answers and accepts the key
 *   B. schemaReady               — the POS tables exist in that project
 *
 * A failure of B is a warning, never a reason to refuse the configuration.
 */
export type CloudProbe = {
  /** the address answered at all */
  reachable: boolean;
  /** the project accepted the publishable key */
  authenticated: boolean;
  /** the POS tables are present */
  schemaReady: boolean;
  stage: "invalid" | "unreachable" | "rejected" | "no-schema" | "ok";
  detail: string;
};

const NOT_REACHED = (detail: string): CloudProbe => ({
  reachable: false,
  authenticated: false,
  schemaReady: false,
  stage: "unreachable",
  detail,
});

/** A. Does the address answer, and does it accept this key? */
async function probeAuth(url: string, key: string): Promise<CloudProbe | null> {
  try {
    const headers: Record<string, string> = { apikey: key };
    // New Supabase publishable keys are opaque API keys, not JWT bearer tokens.
    // Keep legacy anon JWT behavior for older projects.
    if (!key.startsWith("sb_publishable_") && !key.startsWith("sb_secret_")) {
      headers.Authorization = `Bearer ${key}`;
    }
    const res = await fetch(`${url}/auth/v1/health`, {
      headers,
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403)
      return {
        reachable: true,
        authenticated: false,
        schemaReady: false,
        stage: "rejected",
        detail: "The address answered but rejected this API key — check the key and try again.",
      };
    return null; // reachable; the key is proven properly by the REST call below
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NOT_REACHED(
      `No answer from ${url} — check the address and this device's internet connection (${msg}).`,
    );
  }
}

/** Full two-part probe. Never throws. */
export async function probeCloudConnection(url: string, key: string): Promise<CloudProbe> {
  const cleanUrl = url.trim().replace(/\/+$/, "");
  const cleanKey = key.trim();
  if (!/^https:\/\/.+/i.test(cleanUrl))
    return {
      reachable: false,
      authenticated: false,
      schemaReady: false,
      stage: "invalid",
      detail: "Enter the full https:// project URL.",
    };
  if (cleanKey.length < 10)
    return {
      reachable: false,
      authenticated: false,
      schemaReady: false,
      stage: "invalid",
      detail: "The API key looks too short.",
    };

  const early = await probeAuth(cleanUrl, cleanKey);
  if (early) return early;

  try {
    const client = createTenantClient(cleanUrl, cleanKey);
    const { error } = await client.from("stores").select("id").limit(1);
    if (!error)
      return {
        reachable: true,
        authenticated: true,
        schemaReady: true,
        stage: "ok",
        detail: "Connected — the address, the key and the POS tables all check out.",
      };

    const msg = error.message ?? "query failed";
    if (/invalid api ?key|jwt|unauthorized|not authorized/i.test(msg))
      return {
        reachable: true,
        authenticated: false,
        schemaReady: false,
        stage: "rejected",
        detail: "The key was rejected by the server — check it and try again.",
      };
    // Missing table or a row rule that hides everything: the connection itself
    // is proven, the customer's POS schema simply is not provisioned yet.
    if (/does not exist|relation|schema cache|permission denied/i.test(msg))
      return {
        reachable: true,
        authenticated: true,
        schemaReady: false,
        stage: "no-schema",
        detail: "Connected. The POS tables are not provisioned in this project yet.",
      };
    return {
      reachable: true,
      authenticated: true,
      schemaReady: false,
      stage: "no-schema",
      detail: `Connected, but the POS tables could not be read: ${msg}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NOT_REACHED(
      /fetch|network/i.test(msg)
        ? "No route to the server — check the URL and this device's internet connection."
        : msg,
    );
  }
}

/**
 * Back-compatible wrapper: a connection counts as usable once the address
 * answers and the key is accepted, whether or not the schema exists yet.
 */
export async function testCloudCredentials(url: string, key: string): Promise<CloudTestResult> {
  const probe = await probeCloudConnection(url, key);
  return { ok: probe.reachable && probe.authenticated, detail: probe.detail };
}

/**
 * Persist a new pair in the platform vault and make it live immediately.
 *
 * Deliberately does NOT start sync: that happens once the *whole* profile is
 * committed and activated, at the end of `saveConnectionProfile()`.
 */
export async function saveCloudCredentials(
  url: string,
  key: string,
): Promise<{ ok: boolean; error?: string; encrypted?: boolean }> {
  const cleanUrl = url.trim().replace(/\/+$/, "");
  const cleanKey = key.trim();
  if (isWindowsShell() && window.pos?.setCloudCredentials) {
    const res = await window.pos.setCloudCredentials({ url: cleanUrl, key: cleanKey });
    if (!res.ok) return { ok: false, error: res.error ?? "Could not save the credentials." };
    if (setTerminalSupabaseOverride(cleanUrl, cleanKey)) resetExternalClient();
    notifyCloudKeysChanged();
    return { ok: true, encrypted: res.encrypted };
  }
  if (isMobileShell()) {
    try {
      const loaded = await androidStore();
      if (!loaded) return { ok: false, error: "Secure storage is unavailable on this device." };
      const store = loaded.value;
      await store.set({ key: ANDROID_URL_KEY, value: cleanUrl });
      await store.set({ key: ANDROID_KEY_KEY, value: cleanKey });
      if (setTerminalSupabaseOverride(cleanUrl, cleanKey)) resetExternalClient();
      notifyCloudKeysChanged();
      return { ok: true, encrypted: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return { ok: false, error: "Cloud keys are managed by this deployment." };
}


/** Forget the saved pair — the till keeps trading locally, cloud sync stops. */
export async function removeCloudCredentials(): Promise<{ ok: boolean; error?: string }> {
  if (isWindowsShell() && window.pos?.removeCloudCredentials) {
    const res = await window.pos.removeCloudCredentials();
    if (!res.ok) return { ok: false, error: res.error ?? "Could not remove the credentials." };
    if (clearTerminalSupabaseOverride()) resetExternalClient();
    notifyCloudKeysChanged();
    setSyncState({ cloudConfigured: false });
    return { ok: true };
  }
  if (isMobileShell()) {
    try {
      const loaded = await androidStore();
      if (!loaded) return { ok: false, error: "Secure storage is unavailable on this device." };
      const store = loaded.value;
      await store.remove({ key: ANDROID_URL_KEY });
      await store.remove({ key: ANDROID_KEY_KEY });
      if (clearTerminalSupabaseOverride()) resetExternalClient();
      notifyCloudKeysChanged();
      setSyncState({ cloudConfigured: false });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return { ok: false, error: "Cloud keys are managed by this deployment." };
}

/**
 * Boot-time hydration: read the platform vault and point the tenant client at
 * it. Returns the status so the shell can decide whether to show the setup
 * prompt. No-op on web.
 */
export async function initCloudConfigFromShell(): Promise<CloudKeyStatus> {
  if (!isTerminalApp()) return cloudKeyStatus();
  if (isWindowsShell() && window.pos?.bootstrapCloudCredentials) {
    // The main process owns the key; ask it for the live pair through the
    // dedicated bootstrap channel so the renderer can configure its client.
    const res = await window.pos.bootstrapCloudCredentials();
    if (res.ok && res.url && res.key) {
      if (setTerminalSupabaseOverride(res.url, res.key)) resetExternalClient();
    }
    return cloudKeyStatus();
  }
  const saved = await androidRead();
  if (saved) {
    if (setTerminalSupabaseOverride(saved.url, saved.key)) resetExternalClient();
  }
  return cloudKeyStatus();
}

/* ------------------------- change notifications ------------------------- */

const listeners = new Set<() => void>();

export function subscribeCloudKeys(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notifyCloudKeysChanged() {
  for (const cb of listeners) {
    try {
      cb();
    } catch {
      /* a broken listener must not break the settings flow */
    }
  }
}

/* --------------------------- connection profile -------------------------- */

/**
 * Everything a terminal needs to reach ONE customer's deployment, as a single
 * unit. This POS is sold to many customers and the same APK/EXE serves all of
 * them, so these three values are runtime configuration, never build values.
 *
 * SQL Server credentials are deliberately NOT part of this: they stay in the
 * Electron main process's own sealed store and never reach the renderer.
 */
export type ConnectionProfile = {
  /** central database (Supabase project) address */
  supabaseUrl: string;
  /**
   * publishable / anon key — public by design, still sealed at rest.
   *
   * `null` means "keep whatever is already stored". An operator who only
   * changes the backend address must never be made to type the key again: the
   * renderer never sees it on Windows, and it is masked everywhere.
   */
  supabaseKey: string | null;
  /** the POS website this device sends sign-in and sync to */
  backendUrl: string;
};

/** The profile as it is actually stored, with a real key. */
type ResolvedProfile = { supabaseUrl: string; supabaseKey: string; backendUrl: string };

export type ProfileSaveResult = {
  ok: boolean;
  /** where it stopped, so the setup screen can say something useful */
  stage: "validate" | "cloud" | "backend" | "save" | "saved";
  detail: string;
  cloud?: CloudProbe;
  backend?: BackendTestResult;
  profile?: ResolvedProfile;
};

/**
 * Read the three values currently in force on this device, for prefilling the
 * settings form. The key is a mask — the real one never leaves storage.
 */
export async function connectionProfile(): Promise<{
  supabaseUrl: string;
  keyHint: string;
  hasKey: boolean;
  backendUrl: string;
}> {
  const [status, backend] = await Promise.all([cloudKeyStatus(), backendUrl()]);
  return {
    supabaseUrl: status.url,
    keyHint: status.configured ? status.keyHint : "",
    hasKey: Boolean(status.configured),
    backendUrl: backend,
  };
}

/**
 * The key this device is using right now, so a candidate profile that only
 * changes the backend can still be tested end to end. On Windows the live pair
 * comes from the main process through the bootstrap channel; on Android from
 * the Keystore. Never persisted or displayed by callers.
 */
async function storedCloudKey(): Promise<{ url: string; key: string } | null> {
  if (isWindowsShell() && window.pos?.bootstrapCloudCredentials) {
    const res = await window.pos.bootstrapCloudCredentials().catch(() => null);
    return res?.ok && res.url && res.key ? { url: res.url, key: res.key } : null;
  }
  if (isMobileShell()) return androidRead();
  return null;
}

/** Fill in the values the operator did not change from what is already stored. */
async function resolveCandidate(input: ConnectionProfile): Promise<ResolvedProfile | null> {
  const supabaseUrl = input.supabaseUrl.trim().replace(/\/+$/, "");
  const typedKey = input.supabaseKey?.trim() ?? "";
  if (typedKey) return { supabaseUrl, supabaseKey: typedKey, backendUrl: input.backendUrl };
  const stored = await storedCloudKey();
  if (!stored) return null;
  return {
    supabaseUrl: supabaseUrl || stored.url,
    supabaseKey: stored.key,
    backendUrl: input.backendUrl,
  };
}

/** Test a candidate profile without writing anything. */
export async function testConnectionProfile(input: ConnectionProfile): Promise<{
  ok: boolean;
  cloud: CloudProbe;
  backend: BackendTestResult;
}> {
  const candidate = await resolveCandidate(input);
  if (!candidate)
    return {
      ok: false,
      cloud: {
        reachable: false,
        authenticated: false,
        schemaReady: false,
        stage: "invalid",
        detail: "Enter the publishable API key for that project.",
      },
      backend: { ok: false, detail: "Not tested — the database details are incomplete." },
    };
  const cloud = await probeCloudConnection(candidate.supabaseUrl, candidate.supabaseKey);
  const backend = await testBackendUrl(candidate.backendUrl);
  return { ok: cloud.reachable && cloud.authenticated && (backend.ok || Boolean(backend.warn)), cloud, backend };
}

/**
 * The ONE way a terminal's connection is written.
 *
 * Complete the candidate from what is already stored → validate → test the
 * database → test the backend → commit both halves → activate → start sync.
 * Nothing is written until both halves pass, and if the second write fails the
 * first is rolled back, so a working profile is never half-replaced.
 */
export async function saveConnectionProfile(
  input: ConnectionProfile,
  options?: { skipTests?: boolean },
): Promise<ProfileSaveResult> {
  if (!isTerminalApp())
    return {
      ok: false,
      stage: "validate",
      detail: "On the website these values come from the hosting environment.",
    };

  const candidate = await resolveCandidate(input);
  const supabaseUrl = candidate?.supabaseUrl ?? input.supabaseUrl.trim().replace(/\/+$/, "");
  const supabaseKey = candidate?.supabaseKey ?? "";
  const backend = normaliseBackendUrl(input.backendUrl);

  if (!/^https:\/\/.+/i.test(supabaseUrl))
    return { ok: false, stage: "validate", detail: "Enter the full https:// central database URL." };
  if (supabaseKey.length < 10)
    return { ok: false, stage: "validate", detail: "Enter the publishable API key for that project." };
  if (!backend)
    return {
      ok: false,
      stage: "validate",
      detail: "Enter the web address of your POS site, e.g. https://pos.example.com",
    };

  const profile: ResolvedProfile = { supabaseUrl, supabaseKey, backendUrl: backend };

  let cloud: CloudProbe | undefined;
  let backendResult: BackendTestResult | undefined;
  if (!options?.skipTests) {
    cloud = await probeCloudConnection(supabaseUrl, supabaseKey);
    if (!cloud.reachable || !cloud.authenticated)
      return { ok: false, stage: "cloud", detail: cloud.detail, cloud };

    backendResult = await testBackendUrl(backend);
    // `warn` means "this is the POS backend, but its administrator still has
    // work to do" — the address itself is proven, so the profile may be saved.
    if (!backendResult.ok && !backendResult.warn)
      return { ok: false, stage: "backend", detail: backendResult.detail, cloud, backend: backendResult };
  }

  // Both halves are proven before anything is written. The backend address is
  // written first because it is the one we can put back if the vault refuses.
  const previousBackend = await backendUrl();
  const savedBackend = await saveBackendUrl(backend);
  if (!savedBackend.ok)
    return {
      ok: false,
      stage: "save",
      detail: savedBackend.error ?? "Could not save the backend address on this device.",
      cloud,
      backend: backendResult,
    };

  const savedCloud = await saveCloudCredentials(supabaseUrl, supabaseKey);
  if (!savedCloud.ok) {
    await saveBackendUrl(previousBackend); // no partial profile is left behind
    return {
      ok: false,
      stage: "save",
      detail: savedCloud.error ?? "Could not save the database credentials on this device.",
      cloud,
      backend: backendResult,
    };
  }

  notifyCloudKeysChanged();
  // Committed and activated — only now may sync run against the new profile.
  afterCredentialsSaved();
  return {
    ok: true,
    stage: "saved",
    detail: cloud?.schemaReady === false
      ? "Saved and connected. The POS tables are not provisioned in that project yet."
      : "Saved and connected.",
    cloud,
    backend: backendResult,
    profile,
  };
}
