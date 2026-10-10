/**
 * The one place that holds this device's proof of identity.
 *
 * Three credentials can exist at once:
 *  - `cashierToken` — signed session minted after a username + PIN sign-in
 *  - `terminalToken` — the activation token id of a registered till
 *  - `accessToken`  — the staff account's bearer token from the central database
 *
 * They are kept in the encrypted device store (AES-GCM, key generated once per
 * device) rather than `sessionStorage`, so a reload, an app update or a resume
 * from background does not lose the sign-in — and clearing it really clears it.
 * The desktop and Android shells mirror the same sealed value through their own
 * secure stores.
 */
import { clearDeviceSecret, getDeviceSecret, setDeviceSecret } from "./device-secrets";
import { readTerminalConfig } from "@/core/activation/terminal-tokens";

const SECRET = "cashier-session";
/** The raw session token minted at sign-in; only its hash reaches the database. */
const SESSION_SECRET = "pos-session-token";
/** Legacy location; read once so an existing sign-in survives the upgrade. */
export const TERMINAL_TOKEN_KEY = "pos-terminal-token-v1";

let cached: string | null = null;
let loaded = false;
let sessionCached: string | null = null;
let sessionLoaded = false;
let revision = 0;
let cashierLoad: Promise<string | null> | null = null;
let sessionLoad: Promise<string | null> | null = null;

function legacyToken(): string | null {
  try {
    return window.sessionStorage.getItem(TERMINAL_TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Read the cashier session token, hydrating the encrypted store on first use. */
export async function loadCashierToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (loaded) return cached;
  if (cashierLoad) return cashierLoad;
  const started = revision;
  cashierLoad = (async () => {
    const stored = await getDeviceSecret<string>(SECRET);
    if (started !== revision) return cached;
    const legacy = stored ? null : legacyToken();
    cached = stored ?? legacy;
    loaded = true;
    if (legacy) await setDeviceSecret(SECRET,legacy).catch(() => undefined);
    return cached;
  })().finally(() => { cashierLoad = null; });
  return cashierLoad;
}

/** Last known cashier token without waiting on the encrypted store. */
export function cashierTokenSync(): string | null {
  if (typeof window === "undefined") return null;
  return cached ?? legacyToken();
}

export async function saveCashierToken(token: string): Promise<void> {
  revision += 1;
  cached = token;
  loaded = true;
  try {
    window.sessionStorage.setItem(TERMINAL_TOKEN_KEY, token);
  } catch {
    /* session storage unavailable */
  }
  await setDeviceSecret(SECRET, token).catch(() => undefined);
}

/** Read the raw session token from the device's secure store. */
export async function loadSessionToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (sessionLoaded) return sessionCached;
  if (sessionLoad) return sessionLoad;
  const started = revision;
  sessionLoad = (async () => {
    const stored = await getDeviceSecret<string>(SESSION_SECRET);
    if (started === revision) { sessionCached = stored ?? null; sessionLoaded = true; }
    return sessionCached;
  })().finally(() => { sessionLoad = null; });
  return sessionLoad;
}

/** Last known session token without waiting on the encrypted store. */
export function sessionTokenSync(): string | null {
  return typeof window === "undefined" ? null : sessionCached;
}

export async function saveSessionToken(token: string): Promise<void> {
  revision += 1;
  sessionCached = token;
  sessionLoaded = true;
  await setDeviceSecret(SESSION_SECRET, token).catch(() => undefined);
}

/** Wipe every stored credential on this device. */
export function clearStoredCredentials(): void {
  revision += 1;
  cached = null;
  loaded = true;
  sessionCached = null;
  sessionLoaded = true;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(TERMINAL_TOKEN_KEY);
  } catch {
    /* ignore */
  }
  clearDeviceSecret(SECRET);
  clearDeviceSecret(SESSION_SECRET);
}

export type PosCredentials = {
  sessionToken?: string;
  cashierToken?: string;
  terminalToken?: string;
  accessToken?: string;
};

/** Everything this device can present, each under its correct name. */
export async function readCredentials(): Promise<PosCredentials> {
  if (typeof window === "undefined") return {};
  const cashierToken = (await loadCashierToken()) ?? undefined;
  const sessionToken = (await loadSessionToken()) ?? undefined;
  // AuthProvider must prove a cached Supabase session before this hot path
  // asks the client for it. Besides avoiding anonymous protected requests,
  // this prevents PIN-terminal operations from waiting behind Supabase's
  // auth-storage lock while an optional account session is being refreshed.
  const { centralAuthAccessToken } = await import("./session-presence");
  const accessToken = centralAuthAccessToken();
  let terminalToken: string | undefined;
  try {
    terminalToken = readTerminalConfig()?.tokenId ?? undefined;
  } catch {
    /* no till registered */
  }
  return {
    ...(sessionToken ? { sessionToken } : {}),
    ...(cashierToken ? { cashierToken } : {}),
    ...(terminalToken ? { terminalToken } : {}),
    ...(accessToken ? { accessToken } : {}),
  };
}

/** Headers for a call to our own server: the bearer travels with every request. */
export async function authHeaders(): Promise<Record<string, string>> {
  const { accessToken, sessionToken } = await readCredentials();
  // The raw session token is the primary bearer; the account token is the
  // fallback for browser admins who have no device session yet.
  const bearer = sessionToken ?? accessToken;
  return bearer ? { Authorization: `Bearer ${bearer}` } : {};
}
