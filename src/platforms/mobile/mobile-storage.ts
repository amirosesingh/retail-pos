/**
 * Device storage for the Android build.
 *
 * Android runs live-only: business records (catalogue, members, sales, stock,
 * shifts, coupons) are never kept on the phone. Only a short allow-list of
 * interface preferences is mirrored into Capacitor Preferences so the app
 * remembers its look and its terminal identity between launches. Anything left
 * behind by an older offline build is purged on start-up.
 *
 * Web and Electron are untouched: `hydrateNativeStorage()` returns immediately
 * when the app is not running inside Capacitor.
 */
import { isNative } from "@/platform-config/platform";
import { isPersistentKey } from "@/lib/live-mode";
import { INTERFACE_PREFERENCES_RESTORED } from "@/lib/theme-storage";

const PREFIX = "pos.";

type Prefs = {
  get: (o: { key: string }) => Promise<{ value: string | null }>;
  set: (o: { key: string; value: string }) => Promise<void>;
  remove: (o: { key: string }) => Promise<void>;
  keys: () => Promise<{ keys: string[] }>;
};

let prefs: { value: Prefs } | null = null;
let installed = false;
let hydrated = false;
let hydration: Promise<void> | null = null;
const pendingWrites = new Set<Promise<void>>();
const pendingRemovals = new Set<string>();
function trackWrite(work: Promise<void>) {
  const settled = work.catch(() => {}).finally(() => pendingWrites.delete(settled));
  pendingWrites.add(settled);
}

/**
 * The plugin handle is kept inside a wrapper object: a Capacitor plugin Proxy
 * answers every property — `then` included — with a native call, so returning
 * one from an `async` function makes the runtime call `Preferences.then(...)`
 * and the bridge fails with "not implemented".
 */
async function loadPrefs(): Promise<{ value: Prefs } | null> {
  if (prefs) return prefs;
  try {
    const mod = await import("@capacitor/preferences");
    const plugin = mod.Preferences as unknown as Prefs | undefined;
    if (!plugin || typeof plugin.get !== "function") return null;
    prefs = { value: plugin };
    return prefs;
  } catch {
    return null;
  }
}

/** Write-through for preference keys only; business keys are never persisted. */
function install(store: Prefs) {
  if (installed) return;
  installed = true;
  const ls = window.localStorage;
  const setItem = ls.setItem.bind(ls);
  const removeItem = ls.removeItem.bind(ls);
  const clear = ls.clear.bind(ls);

  ls.setItem = (key: string, value: string) => {
    setItem(key, value);
    if (isPersistentKey(key)) { pendingRemovals.delete(key); trackWrite(store.set({ key, value })); }
  };
  ls.removeItem = (key: string) => {
    removeItem(key);
    if (isPersistentKey(key)) { pendingRemovals.add(key); trackWrite(store.remove({ key })); }
  };
  ls.clear = () => {
    const keys = Object.keys(ls).filter((k) => k.startsWith(PREFIX));
    clear();
    for (const key of keys) { pendingRemovals.add(key); trackWrite(store.remove({ key })); }
  };
}

/** An OTA reload must not race the asynchronous native identity/preferences writes. */
export async function flushNativeStorage(): Promise<void> {
  if (typeof window === "undefined" || !isNative()) return;
  await hydrateNativeStorage();
  await Promise.all([...pendingWrites]);
  const loaded = await loadPrefs();
  if (!loaded) throw new Error("Cannot preserve saved device settings. Retry the update.");
  // A reload after unpairing must not restore a deleted registration from
  // Preferences if its asynchronous write-through removal failed.
  for (const key of [...pendingRemovals]) {
    if (window.localStorage.getItem(key) !== null) continue;
    await loaded.value.remove({ key });
    if ((await loaded.value.get({ key })).value !== null)
      throw new Error("Could not remove saved device settings. Please retry.");
    pendingRemovals.delete(key);
  }
  for (const key of Object.keys(window.localStorage).filter(isPersistentKey)) {
    const value = window.localStorage.getItem(key);
    if (value === null) continue;
    await loaded.value.set({ key, value });
    if ((await loaded.value.get({ key })).value !== value)
      throw new Error("Could not verify saved device settings. Update postponed.");
  }
}

/**
 * Restore saved preferences, drop every business key an older offline build
 * may have written, and start mirroring. Must finish before the app renders.
 */
export function hydrateNativeStorage(): Promise<void> {
  if (typeof window === "undefined" || !isNative() || hydrated) return Promise.resolve();
  if (!hydration) hydration = restoreNativeStorage().then(() => { hydrated = true; }).finally(() => { hydration = null; });
  return hydration;
}

async function restoreNativeStorage(): Promise<void> {
  // Business data must never survive on the phone, whether or not the
  // Preferences plugin is available this session.
  purgeBusinessKeys();
  const loaded = await loadPrefs();
  if (!loaded) throw new Error("Saved device settings are temporarily unavailable.");
  const store = loaded.value;
  const { keys } = await store.keys();
  // Read the complete identity before publishing any part of it. A partial
  // restore can pair an activation ciphertext with the wrong device key.
  const restored = await Promise.all(keys.filter(isPersistentKey).map(async key => {
    const { value } = await store.get({ key });
    return { key, value };
  }));
  for (const { key, value } of restored) {
    if (value !== null) window.localStorage.setItem(key, value);
  }
  for (const key of keys) {
    if (key.startsWith(PREFIX) && !isPersistentKey(key)) {
      // Left over from the previous offline-first build.
      await store.remove({ key }).catch(() => {});
    }
  }
  for (const key of Object.keys(window.localStorage)) {
    if (!isPersistentKey(key) || keys.includes(key)) continue;
    const value = window.localStorage.getItem(key);
    if (value !== null) await store.set({ key, value });
  }
  install(store);
  window.dispatchEvent(new Event(INTERFACE_PREFERENCES_RESTORED));
}

/** Remove every non-preference key the app may have cached on this device. */
export function purgeBusinessKeys() {
  if (typeof window === "undefined") return;
  try {
    const ls = window.localStorage;
    for (const key of Object.keys(ls)) {
      if (isPersistentKey(key)) continue;
      if (key.startsWith(PREFIX) || key === "pos-state-v2") ls.removeItem(key);
    }
  } catch {
    /* nothing else we can do */
  }
}
