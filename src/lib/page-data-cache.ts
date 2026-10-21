import { sessionEpoch } from "./session-epoch";
import { effectiveDatabaseMode } from "@/core/local-db/db-mode";
import { supabaseConfig } from "./external-supabase-config";

/** Memory-only report cache. Authorization checks must not use this policy. */
export const PAGE_DATA_CACHE = {
  staleTime: 300_000,
  gcTime: 300_000,
  // Change hints invalidate inactive reports too; reopening must then re-read.
  refetchOnMount: true,
} as const;

export function pageDataScope(user: {
  staffId?: string; role?: string; permissions?: unknown;
} | null | undefined): readonly unknown[] {
  let database: string | null = null;
  try { database = supabaseConfig().url; } catch { /* Unconfigured native setup. */ }
  return [sessionEpoch(), effectiveDatabaseMode(), database, user?.staffId ?? null,
    user?.role ?? null, JSON.stringify(user?.permissions ?? {})];
}
