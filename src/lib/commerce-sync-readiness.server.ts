import { serviceRest } from "@/core/api/pos-relay.server";
let cached: { until: number; enabled: boolean } | null = null;
let pending: Promise<boolean> | null = null;
/** Keep old synchronization intact until the database-side preservation guard is installed. */
export async function commerceSyncIsolationReady(): Promise<boolean> {
  if (cached && cached.until > Date.now()) return cached.enabled;
  if (pending) return pending;
  pending = (async () => {
    let enabled = false;
    try {
      const response = await serviceRest("public_flags?key=eq.management_commerce_isolation_ready&select=enabled&limit=1");
      if (response.ok) { const rows = await response.json(); enabled = Array.isArray(rows) && rows[0]?.enabled === true; }
    } catch { /* A missing migration must not break existing till synchronization. */ }
    cached = { enabled, until: Date.now() + 30_000 };
    return enabled;
  })();
  try { return await pending; } finally { pending = null; }
}
