/**
 * This POS talks to the operator's own database only.
 *
 * Every read and write must go through `supabaseExternal` (their Supabase) or
 * the server relay that uses their service key. Legacy generated clients must
 * stay absent so they can never quietly become the store of record again.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "src");
const GENERATED = join(ROOT, "integrations", "supabase");
/**
 * The one file allowed to name the operator's project: it is the single
 * resolver every other module goes through, and the operator pinned their
 * project there deliberately. Only its public half may appear.
 */
const CONFIG_OWNER = join(ROOT, "lib", "external-supabase-config.ts");

const FORBIDDEN = [
  /from\s+["']@\/integrations\/supabase\/client["']/,
  /from\s+["']@\/integrations\/supabase\/client\.server["']/,
  /from\s+["']@\/integrations\/supabase\/auth-middleware["']/,
  // A generated bearer attacher would instantiate the wrong client on every
  // server-fn call, which is what produced "Missing Supabase environment
  // variable(s)" on tills and APKs. Only the external attacher may be used.
  /from\s+["']@\/integrations\/supabase\/auth-attacher["']/,
  /from\s+["'](\.\.?\/)+integrations\/supabase\/client(\.server)?["']/,
  // Deferred imports count too: `await import("...client.server")` was how the
  // comparison page quietly read the managed database instead of the operator's.
  /import\s*\(\s*["']@?[\w./-]*integrations\/supabase\/client(\.server)?["']\s*\)/,
];


function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (full.startsWith(GENERATED)) return [];
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const HARDCODED = [
  // A project endpoint or publishable key must never be baked into source.
  // Project refs are exactly 20 lowercase letters, so form placeholders such
  // as "https://your-project.supabase.co" are not flagged.
  /https:\/\/[a-z]{20}\.supabase\.co/,
  /sb_publishable_[A-Za-z0-9_-]{10,}/,
  /sb_secret_[A-Za-z0-9_-]{10,}/,
];

describe("database ownership", () => {
  it("no application file imports a legacy generated database client", () => {
    const offenders = walk(ROOT).filter((file) => {
      const source = readFileSync(file, "utf8");
      return FORBIDDEN.some((pattern) => pattern.test(source));
    });
    expect(offenders).toEqual([]);
  });

  it("no source file hardcodes a Supabase project URL or key", () => {
    const offenders = walk(ROOT).filter((file) => {
      if (file === CONFIG_OWNER) return false;
      const source = readFileSync(file, "utf8");
      return HARDCODED.some((pattern) => pattern.test(source));
    });
    expect(offenders).toEqual([]);
  });

  it("the config owner never carries a secret key", () => {
    const source = readFileSync(CONFIG_OWNER, "utf8");
    expect(/sb_secret_[A-Za-z0-9_-]{10,}/.test(source)).toBe(false);
    expect(/SERVICE_ROLE_KEY\s*[:=]\s*["']/.test(source)).toBe(false);
  });
});
