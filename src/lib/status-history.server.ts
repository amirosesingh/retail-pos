/**
 * Server side of the status history trail.
 *
 * Every state change of a tracked record — a booking moving to collected, a
 * job moving to ready, a shift closing, a transfer being received — is written
 * here with the state it came from and the state it went to. The table refuses
 * updates and deletes, so history can be added to but never rewritten.
 *
 * Writes go through the internal service key so a till cannot forge or
 * suppress a transition.
 */
import { serviceRest } from "@/core/api/pos-relay.server";

/** Anything that survives a JSON round trip, so history can cross the wire. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type StatusHistoryRecord = {
  entity_type: string;
  entity_id: string;
  status_kind: string;
  previous_status: string | null;
  new_status: string;
  reason: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  store_id: string | null;
  branch_id: string | null;
  terminal_id: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  metadata: Record<string, Json>;
  client_event_id: string | null;
  occurred_at: string;
};

/**
 * Append one transition. Duplicate protection is the `client_event_id`
 * unique index, so a retry after a dropped connection records the same
 * change once rather than twice.
 */
export async function writeStatusHistory(
  rows: StatusHistoryRecord[],
): Promise<{ ok: boolean; error?: string }> {
  if (rows.length === 0) return { ok: true };
  const res = await serviceRest("entity_status_history", {
    method: "POST",
    headers: { Prefer: "return=minimal,resolution=ignore-duplicates" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) return { ok: false, error: (await res.text()).slice(0, 300) };
  return { ok: true };
}

/** Read the transitions of one record, newest first. */
export async function readStatusHistory(
  entityType: string,
  entityId: string,
  limit = 200,
  storeId: string | null = null,
): Promise<StatusHistoryRecord[]> {
  const query = new URLSearchParams({
    entity_type: `eq.${entityType}`,
    entity_id: `eq.${entityId}`,
    order: "occurred_at.desc",
    limit: String(Math.min(Math.max(limit, 1), 500)),
  });
  if (storeId) query.set("store_id", `eq.${storeId}`);
  const res = await serviceRest(`entity_status_history?${query.toString()}`);
  if (!res.ok) return [];
  return (await res.json()) as StatusHistoryRecord[];
}
