/**
 * Where a terminal app sends its app-server calls.
 *
 * Android and the Windows till are live clients of a hosted backend: cashier
 * sign-in, the sync relay and every other privileged operation are answered
 * there, so no privileged credential ever has to sit on the device. The only
 * thing the device needs is the backend's address, which is not a secret.
 *
 * It is stored per device:
 *   - Windows (Electron): the sealed configuration store, via the main process
 *   - Android (APK): device storage
 * and it is applied to `window.__POS_SERVER_URL__`, which `server-origin.ts`
 * reads. The web build ignores all of this and keeps using relative URLs.
 */
import { isTerminalApp } from "@/platform-config/platform";
import { isWindowsShell, isMobileShell } from "@/platform-config/features";

/**
 * Android keeps the address in the same secure store as the cloud pair, so a
 * start-up purge of `localStorage` can never take it away. Legacy plain copies are migrated into the secure store, then removed.
 * The live address is kept in memory, not duplicated in Preferences.
 */
export const BACKEND_STORAGE_KEY = "pos.backend.url";
const STORAGE_KEY = BACKEND_STORAGE_KEY;

type SecureStore = {
  get(options: { key: string }): Promise<{ value: string }>;
  set(options: { key: string; value: string }): Promise<{ value: boolean }>;
  remove(options: { key: string }): Promise<{ value: boolean }>;
};

/** Wrapped, because a Capacitor plugin proxy answers `then` with a native call. */
async function secureStore(): Promise<{ value: SecureStore } | null> {
  try {
    const mod = await import("capacitor-secure-storage-plugin");
    const plugin = mod.SecureStoragePlugin as unknown as SecureStore | undefined;
    if (!plugin || typeof plugin.get !== "function") return null;
    return { value: plugin };
  } catch {
    return null;
  }
}


const clean = (value: unknown): string =>
  typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";

/**
 * Accept what an operator would naturally type. A bare host gets `https://`,
 * a trailing slash goes, and a pasted endpoint path (`.../api/public/...`) is
 * trimmed back to the site root — the address is the site, not an endpoint.
 */
export function normaliseBackendUrl(value: string): string {
  let url = clean(value);
  if (!url) return "";
  // A terminal sends staff sessions and its activation token to this origin.
  // Never persist or use a clear-text HTTP endpoint. A bare hostname is safe
  // to helpfully complete, but an explicitly typed http:// address is rejected
  // so a typo cannot silently weaken an existing configuration.
  if (/^http:\/\//i.test(url)) return "";
  if (!/^https:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/\/api(\/.*)?$/i, "");
  return url.replace(/\/+$/, "");
}


type Bridge = {
  backendUrl?: () => Promise<{ ok: boolean; url?: string }>;
  setBackendUrl?: (value: string) => Promise<{ ok: boolean; url?: string; error?: string }>;
};

function bridge(): Bridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { pos?: Bridge }).pos;
}

/** Push the value into the global the fetch helpers read. */
function apply(url: string): void {
  if (typeof window === "undefined") return;
  (window as unknown as { __POS_SERVER_URL__?: string }).__POS_SERVER_URL__ = url;
}

/**
 * There is no build-time default on purpose. A shipped APK or installer must
 * carry no address belonging to another deployment, so when the device has
 * nothing saved the address stays empty and the operator is asked for it.
 */

/** The address this device is configured to use, "" when it has none. */
export async function backendUrl(): Promise<string> {
  if (typeof window === "undefined") return "";
  if (isWindowsShell()) {
    const res = await bridge()?.backendUrl?.();
    if (!res?.ok) throw new Error("Could not restore the saved backend address.");
    const saved = clean(res?.url);
    return saved;
  } else if (isMobileShell()) {
    // Secure storage is authoritative; a legacy plain copy is migrated below.
    const loaded = await secureStore();
    if (!loaded) throw new Error("Secure connection storage is temporarily unavailable.");
    if (loaded) {
      const value = await loaded.value
        .get({ key: STORAGE_KEY })
        .then((r) => clean(r.value))
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          if (/^(Item with given key does not exist|not found)$/i.test(message)) return "";
          throw new Error("Could not read the saved backend address.");
        });
      if (value) {
        try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* Legacy cleanup is best effort. */ }
        return value;
      }
    }
    let legacy = "";
    try { legacy = clean(window.localStorage.getItem(STORAGE_KEY)); } catch { /* No legacy copy. */ }
    if (legacy) {
      const result = await loaded.value.set({ key: STORAGE_KEY, value: legacy });
      const verified = clean((await loaded.value.get({ key: STORAGE_KEY })).value);
      if (result.value === false || verified !== legacy) throw new Error("Could not secure the saved backend address.");
      try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* Keep the verified secure copy. */ }
      return legacy;
    }
  } else if (isTerminalApp()) {
    try {
      const saved = clean(window.localStorage.getItem(STORAGE_KEY));
      if (saved) return saved;
    } catch {
      /* storage unavailable — the device has no address */
    }
  }
  return "";
}

/** Read the saved address and make it the one every app-server call uses. */
export async function hydrateBackendUrl(): Promise<string> {
  const url = await backendUrl();
  apply(url);
  return url;
}

export type BackendSaveResult = { ok: boolean; error?: string; url?: string };

/** Save (or clear, with an empty value) the address for this device. */
export async function saveBackendUrl(value: string): Promise<BackendSaveResult> {
  const next = normaliseBackendUrl(value);
  if (value.trim() && !next)
    return { ok: false, error: "Enter the web address of your POS site, e.g. https://pos.example.com" };
  if (isWindowsShell()) {
    const res = await bridge()
      ?.setBackendUrl?.(next)
      .catch((e: unknown) => ({ ok: false, error: (e as Error).message }));
    if (!res?.ok) return { ok: false, error: res?.error ?? "Could not save the backend address securely." };
  } else {
    if (isMobileShell()) {
      const loaded = await secureStore();
      if (!loaded) return { ok: false, error: "Secure storage is unavailable on this device." };
      try {
        if (next) {
          const result = await loaded.value.set({ key: STORAGE_KEY, value: next });
          const verified = clean((await loaded.value.get({ key: STORAGE_KEY })).value);
          if (result.value === false || verified !== next) throw new Error("Could not verify the saved backend address.");
        } else await loaded.value.remove({ key: STORAGE_KEY }).catch(() => ({ value: true }));
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    }
    try {
      if (isMobileShell() || !next) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
    } catch (e) {
      // On the phone the sealed copy is already written, so this is only the
      // read-through cache failing: not a reason to report a failed save.
      if (!isMobileShell()) return { ok: false, error: (e as Error).message };
    }
  }

  apply(next);
  return { ok: true, url: next };
}

export type BackendTestResult = {
  ok: boolean;
  /** true when the address answered but still needs an administrator */
  warn?: boolean;
  detail: string;
  /** the address that was actually tried, after tidying up what was typed */
  url?: string;
};

/**
 * Ask the address whether it is this POS backend, using the open presence
 * probe — no credential, no cloud account. The answer distinguishes the four
 * mistakes an operator actually makes: the database address, a plain website,
 * a POS server missing its central key, and a dead line.
 */
export async function testBackendUrl(value: string): Promise<BackendTestResult> {
  const url = normaliseBackendUrl(value);
  if (!url) return { ok: false, detail: "Enter the backend address first." };
  let res: Response;
  try {
    res = await fetch(`${url}/api/public/sync-health`, { method: "GET", cache: "no-store" });
  } catch (e) {
    return {
      ok: false,
      url,
      detail: `No answer from ${url} — check the address, its certificate and this device's connection (${(e as Error).message}).`,
    };
  }

  const text = await res.text().catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          if (/^(Item with given key does not exist|not found)$/i.test(message)) return "";
          throw new Error("Could not read the saved backend address.");
        });
  let body: unknown = null;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    /* not JSON — handled below */
  }
  const data = (body ?? {}) as {
    serviceKey?: boolean;
    posUrl?: boolean;
    membershipService?: boolean;
    message?: string;
    hint?: string;
    code?: string;
  };

  // The central database answers its own error shape and never these flags.
  if (typeof data.serviceKey !== "boolean") {
    if (data.message || data.hint || data.code || /supabase\.co/i.test(url))
      return {
        ok: false,
        url,
        detail:
          "That is the central database address, not your POS website. Enter the web address you open the POS on, e.g. https://pos.example.com.",
      };
    if (/<html/i.test(text))
      return {
        ok: false,
        url,
        detail: `${url} serves a website, but not this POS backend. Check the address is the POS deployment.`,
      };
    return {
      ok: false,
      url,
      detail: `${url} answered ${res.status} but not as a POS backend. Check the address.`,
    };
  }

  if (!data.serviceKey)
    return {
      ok: false,
      warn: true,
      url,
      detail:
        "This is the POS backend, but it has no central database key. An administrator must set SUPABASE_URL, SUPABASE_ANON_KEY and the service key on the hosting environment.",
    };

  if (!data.membershipService)
    return {
      ok: false,
      warn: true,
      url,
      detail:
        "The POS backend handshake succeeded, but its membership gateway is not configured. Add the membership project variables only on the hosted backend; do not put them on this till.",
    };

  return {
    ok: true,
    url,
    detail: `${url} verified the POS database and membership gateway — sign-in, sync and member lookup will work.`,
  };
}

