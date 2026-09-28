/**
 * The single source of truth for which Supabase project this POS talks to.
 *
 * There are no defaults and no fallbacks: if the deployment does not say where
 * the database lives, the app fails loudly instead of quietly connecting
 * somewhere else. The publishable (anon) key is safe in client code; the
 * service key is server-only and lives in `pos-relay.server.ts`.
 */

import { isTerminalApp } from "@/platform-config/platform";

type Source = { url: string; key: string };

/**
 * No tenant is baked into the build. A shipped APK, installer or web bundle
 * carries no project address and no key: the web deployment supplies them
 * through its own environment, and a terminal gets them from its activation
 * or from Settings → Database & Cloud Connection on that device.
 */


const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function fromEnv(bag: Record<string, unknown> | undefined, urlName: string, keyNames: string[]): Source {
  return { url: clean(bag?.[urlName]), key: firstOf(bag, keyNames) };
}


/**
 * Cloudflare hands the Worker its variables and secrets per request, not
 * through `process.env` at module load, so the server entry pushes them here.
 */
let runtimeEnv: Record<string, unknown> | undefined;

export function setRuntimeEnv(env: unknown): void {
  if (!env || typeof env !== "object") return;
  runtimeEnv = env as Record<string, unknown>;
  cached = undefined;
}

/**
 * A registered till carries its tenant's address inside its activation, so the
 * machine needs no environment variables at all. This override always wins.
 */
let terminalOverride: Source | undefined;

export function setTerminalSupabaseOverride(url: string, key: string): boolean {
  const next = { url: clean(url), key: clean(key) };
  if (!next.url || !next.key) return false;
  if (terminalOverride?.url === next.url && terminalOverride?.key === next.key) return false;
  terminalOverride = next;
  cached = undefined;
  return true;
}

export function clearTerminalSupabaseOverride(): boolean {
  if (!terminalOverride) return false;
  terminalOverride = undefined;
  cached = undefined;
  return true;
}

export const hasTerminalSupabaseOverride = () => !!terminalOverride;

/** A single value from the hosting runtime's own environment, if it has one. */
export function runtimeEnvValue(name: string): string | undefined {
  const value = clean(runtimeEnv?.[name]);
  return value || undefined;
}

/** Public values the server printed into the page for the browser to read. */
function injectedBag(): Record<string, unknown> | undefined {
  const g = globalThis as unknown as { __POS_CONFIG__?: Record<string, unknown> };
  const bag = g.__POS_CONFIG__;
  return bag && typeof bag === "object" ? bag : undefined;
}

/** Browser build-time values, plus server runtime values where available. */
function bags(): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const injected = injectedBag();
  if (injected) out.push(injected);
  // Vite only inlines STATIC `import.meta.env.VITE_*` reads. In a production
  // build `import.meta.env` itself is a small object without the VITE_ names,
  // so a dynamic lookup finds nothing — these static reads are the only way
  // the browser bundle can carry build-time values. Only the POS-specific
  // pair exists here: a hosting platform can inject its own SUPABASE_*
  // values, and the shop's own project must win.
  out.push({
    VITE_POS_SUPABASE_URL: import.meta.env.VITE_POS_SUPABASE_URL,
    VITE_POS_SUPABASE_ANON_KEY: import.meta.env.VITE_POS_SUPABASE_ANON_KEY,
    VITE_POS_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_POS_SUPABASE_PUBLISHABLE_KEY,
  });


  try {
    if (import.meta.env) out.push(import.meta.env as unknown as Record<string, unknown>);
  } catch {
    /* no import.meta.env in this runtime */
  }
  // Hosting runtime (Cloudflare vars/secrets) — the only source on a deployed
  // worker, where nothing was baked in at build time.
  if (runtimeEnv) out.push(runtimeEnv);
  if (typeof process !== "undefined" && process.env) out.push(process.env as Record<string, unknown>);
  return out;
}

/**
 * Accepted name pairs, tried in order. Both halves must come from the SAME
 * source, so an address from one project can never be paired with a key from
 * another. The managed-platform `VITE_SUPABASE_*` names are deliberately not
 * accepted: the shop's own project is the only database this POS talks to.
 */
const PAIRS: [string, string[]][] = [
  // The shop's own project, named explicitly so a hosting platform's injected
  // SUPABASE_* values can never take over during local development.
  ["VITE_POS_SUPABASE_URL", ["VITE_POS_SUPABASE_ANON_KEY", "VITE_POS_SUPABASE_PUBLISHABLE_KEY"]],
  // Canonical: Cloudflare variables, and what the server prints into the page.
  ["SUPABASE_URL", ["SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY"]],
];

/** First non-empty value among the accepted names for one setting. */
function firstOf(bag: Record<string, unknown> | undefined, names: string[]): string {
  for (const name of names) {
    const value = clean(bag?.[name]);
    if (value) return value;
  }
  return "";
}



export class SupabaseConfigError extends Error {
  constructor() {
    super(
      isTerminalApp()
        ? "Cloud sync is not set up on this device. Open Settings → Database & Cloud Connection " +
            "and enter the central database URL and API key. Local trading is unaffected."
        : "Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in the " +
            "hosting variables (Cloudflare: Workers → Settings → Variables & Secrets) " +
            "to your own Supabase project before starting the app.",
    );
    this.name = "SupabaseConfigError";
  }
}

let cached: Source | undefined;

/** Resolved connection details, or a hard error when nothing is configured. */
export function supabaseConfig(): Source {
  if (cached) return cached;
  if (terminalOverride) {
    cached = terminalOverride;
    return cached;
  }
  // On a till or phone the tenant comes only from the sealed per-device store
  // (applied above as the terminal override). Bundle-baked and environment
  // values belong to the web deployment and are deliberately invisible here.
  if (isTerminalApp()) throw new SupabaseConfigError();
  for (const bag of bags()) {
    for (const [urlName, keyNames] of PAIRS) {
      const found = fromEnv(bag, urlName, keyNames);
      if (found.url && found.key) {
        cached = found;
        return cached;
      }
    }
  }
  throw new SupabaseConfigError();
}

/** True when both halves are present — for health checks that must not throw. */
export function hasSupabaseConfig(): boolean {
  try {
    supabaseConfig();
    return true;
  } catch {
    return false;
  }
}

/** Where the resolved values came from — for the health probe, never throws. */
export function supabaseConfigSource(): "injected" | "runtime" | "build" | "missing" {
  const check = (bag: Record<string, unknown> | undefined) =>
    PAIRS.some(([urlName, keyNames]) => {
      const found = fromEnv(bag, urlName, keyNames);
      return !!found.url && !!found.key;
    });

  if (check(injectedBag())) return "injected";
  if (check(runtimeEnv)) return "runtime";
  return hasSupabaseConfig() ? "build" : "missing";
}

/** Only the public half — safe to print into the page for the browser. */
export function publicSupabaseConfig(): { url: string; key: string } | undefined {
  try {
    const { url, key } = supabaseConfig();
    return { url, key };
  } catch {
    return undefined;
  }
}

export const EXTERNAL_SUPABASE_URL_NAME = "SUPABASE_URL";

/**
 * Kept as named exports because call sites read them directly. They are getters
 * on a frozen object so the error surfaces at use, not at import time.
 */
export const externalSupabase = Object.freeze({
  get url() {
    return supabaseConfig().url;
  },
  get key() {
    return supabaseConfig().key;
  },
});
