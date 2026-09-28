/**
 * Offline sign-in cache.
 *
 * After every successful online PIN check the terminal stores a PBKDF2
 * verifier for that employee (never the PIN itself) together with the profile
 * the register needs. When the branch loses its connection the same PIN can be
 * checked locally, so the till keeps working. Entries expire so an employee
 * removed in head office cannot sign in forever.
 */
import { readBusinessValue, writeBusinessValue } from "./business-storage";

export type CachedCredential = {
  username: string;
  cashierId: string;
  fullName: string;
  storeId: string;
  permissions: Record<string, boolean>;
  /** Last server-verified role, restored when this terminal signs in offline. */
  roleSlug?: string;
  salt: string;
  verifier: string;
  cachedAt: string;
};

const KEY = "pos.offline.credentials.v1";
export const DEFAULT_MAX_AGE_DAYS = 30;
export const MAX_CACHED_CREDENTIALS = 8;

const isBrowser = () => typeof window !== "undefined";

const toHex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

export async function derive(pin: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = Uint8Array.from(saltHex.match(/.{2}/g) ?? [], (h) => parseInt(h, 16));
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    key,
    256,
  );
  return toHex(bits);
}

function read(): CachedCredential[] {
  if (!isBrowser()) return [];
  try {
    const rows = JSON.parse(readBusinessValue(KEY) ?? "[]") as CachedCredential[];
    return rows
      .filter((row) => row && !isExpired(row))
      .sort((a, b) => Date.parse(b.cachedAt) - Date.parse(a.cachedAt))
      .slice(0, MAX_CACHED_CREDENTIALS);
  } catch {
    return [];
  }
}

function write(rows: CachedCredential[]) {
  if (!isBrowser()) return;
  try {
    writeBusinessValue(
      KEY,
      JSON.stringify(
        rows
          .sort((a, b) => Date.parse(b.cachedAt) - Date.parse(a.cachedAt))
          .slice(0, MAX_CACHED_CREDENTIALS),
      ),
    );
  } catch {
    /* storage full */
  }
}

export function listCachedCredentials(): CachedCredential[] {
  return read();
}

export async function cacheCredential(
  pin: string,
  profile: Omit<CachedCredential, "salt" | "verifier" | "cachedAt">,
) {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const verifier = await derive(pin, salt);
  const rows = read().filter((r) => r.username !== profile.username);
  rows.push({ ...profile, salt, verifier, cachedAt: new Date().toISOString() });
  write(rows);
}

export function forgetCredential(username: string) {
  write(read().filter((r) => r.username !== username));
}

export function isExpired(row: CachedCredential, maxAgeDays = DEFAULT_MAX_AGE_DAYS, now = Date.now()) {
  return now - Date.parse(row.cachedAt) > maxAgeDays * 24 * 60 * 60 * 1000;
}

/** Verify a PIN against the local cache. Returns null when it cannot be used. */
export async function verifyCachedPin(
  username: string,
  pin: string,
  maxAgeDays = DEFAULT_MAX_AGE_DAYS,
): Promise<CachedCredential | null> {
  const row = read().find((r) => r.username === username.trim().toLowerCase());
  if (!row) return null;
  if (isExpired(row, maxAgeDays)) return null;
  const candidate = await derive(pin, row.salt);
  // Constant-time-ish comparison.
  if (candidate.length !== row.verifier.length) return null;
  let diff = 0;
  for (let i = 0; i < candidate.length; i += 1) diff |= candidate.charCodeAt(i) ^ row.verifier.charCodeAt(i);
  return diff === 0 ? row : null;
}
