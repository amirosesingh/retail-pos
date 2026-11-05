/**
 * Governance trail when the line is down.
 *
 * Approvals, edits to posted records, member verifications and activity
 * events used to be written straight to the central database, so an action
 * taken with no connection left no record anywhere. These helpers park the
 * row in the till's own database instead; the sync worker pushes it with
 * everything else once the line is back.
 *
 * Every helper is best-effort and never throws: governance must never block
 * the person doing the work, and a till without a local database (web or
 * Android) simply reports that nothing could be parked.
 */
import { localDb } from "@/core/local-db/local-db";
import { commitOps } from "@/core/api/pos-db";
import type { SyncOp } from "./sync-outbox";

export type ParkResult = { parked: boolean; reason?: string };

/** Tables that carry the offline governance trail. */
export type GovernanceTable =
  | "activity_events"
  | "record_edits"
  | "authorization_requests"
  | "authorization_log"
  | "member_verifications"
  // Every state change of a tracked record, kept locally when the line is down.
  | "entity_status_history";

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

/**
 * Write one governance row to the till's database. Native writes are captured
 * by the transactional sync journal; authorization tables have no sync-flag
 * columns. The id is generated here so a later retry of the same action cannot
 * create a second copy centrally: the id is the key on both sides.
 */
export async function parkGovernanceRow(
  table: GovernanceTable,
  row: Record<string, unknown>,
): Promise<ParkResult> {
  const bridge = localDb();
  if (!bridge) return { parked: false, reason: "No local database on this device" };
  const payload = {
    id: row["id"] ?? newId(),
    created_at: row["created_at"] ?? new Date().toISOString(),
    ...row,
    ...(table === "authorization_log" || table === "authorization_requests"
      ? {}
      : { is_synced: 0, sync_status: "pending" }),
  };
  const op: SyncOp = { kind: "upsert", table, rows: [payload], onConflict: "id" };
  try {
    await commitOps(`Recording ${table.replace(/_/g, " ")}`, [op]);
    return { parked: true };
  } catch (error) {
    return { parked: false, reason: String((error as Error)?.message ?? error) };
  }
}

/**
 * Run a governance write against the cloud and, if that cannot be reached,
 * keep the same record locally so the trail survives the outage.
 *
 * `buildRow` shapes the central row; it is only called when the cloud attempt
 * failed, so the online path costs nothing extra.
 */
export async function withGovernanceFallback<T>(
  table: GovernanceTable,
  attempt: () => Promise<T>,
  buildRow: () => Record<string, unknown>,
): Promise<{ ok: boolean; result?: T; parked: boolean; error?: string }> {
  try {
    const result = await attempt();
    return { ok: true, result, parked: false };
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    const park = await parkGovernanceRow(table, buildRow());
    return { ok: park.parked, parked: park.parked, error: park.parked ? undefined : message };
  }
}

/**
 * Does this failure look like the line being down rather than a refusal?
 *
 * A refusal ("that PIN is not allowed") must never be parked as if it had
 * happened; only transport failures are. The check is deliberately generous —
 * a parked governance row is harmless, a lost one is not.
 */
export function looksOffline(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const message = String((error as Error)?.message ?? error ?? "").toLowerCase();
  return (
    message.includes("fetch") ||
    message.includes("network") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("offline") ||
    message.includes("unreachable") ||
    message.includes("econn") ||
    message.includes("failed to load") ||
    message.includes("service unavailable") ||
    message.includes("gateway")
  );
}
