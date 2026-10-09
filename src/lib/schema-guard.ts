/**
 * Defensive schema handling.
 *
 * Terminals can be pointed at a database that has not had the latest repair
 * script applied yet. When that happens the answer must be an empty screen
 * with a plain explanation, never a crash in the middle of trading.
 */

/** PostgREST / Postgres codes that mean "this table or column isn't there". */
const MISSING_CODES = new Set(["42P01", "42703", "PGRST106", "PGRST205", "PGRST204"]);

export function isMissingSchema(error: unknown): boolean {
  if (!error) return false;
  const e = error as { code?: string; message?: string };
  if (e.code && MISSING_CODES.has(e.code)) return true;
  const msg = (e.message ?? String(error)).toLowerCase();
  return (
    msg.includes("does not exist") ||
    msg.includes("could not find the table") ||
    msg.includes("schema cache")
  );
}

export const MISSING_SCHEMA_HINT =
  "This area needs a database update. For a Windows till, open Settings → Database & Cloud Connection and apply or download the latest database update SQL. For an existing Supabase database, apply the pending POS migrations following docs/database-upgrade.md; the full schema installer is for a fresh project.";

/**
 * Run a read that depends on an optional table. A missing table yields the
 * fallback plus a hint instead of throwing; every other error still throws.
 */
export async function readOptional<T>(
  run: () => Promise<T>,
  fallback: T,
): Promise<{ data: T; missing: boolean; hint?: string }> {
  try {
    return { data: await run(), missing: false };
  } catch (error) {
    if (isMissingSchema(error)) return { data: fallback, missing: true, hint: MISSING_SCHEMA_HINT };
    throw error;
  }
}
