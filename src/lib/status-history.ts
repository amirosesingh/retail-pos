/**
 * Status history — the record of how something got to where it is.
 *
 * Until now the till kept only the *current* state of a booking, job, shift or
 * transfer: the previous one was overwritten by the next. This records each
 * move instead — what it was, what it became, who moved it, why, when, at
 * which branch and terminal — so the sequence can be read back later.
 *
 * Recording is fire-and-forget and must never block or slow the person doing
 * the work. When the line is down the transition is parked in the till's own
 * database and pushed on the next successful sync, so a change made offline
 * still has a permanent history entry.
 */
import { recordStatusHistory } from "./status-history.functions";
import { parkGovernanceRow } from "./governance-offline";
import { readCredentials } from "./pos-credentials";

/** The kinds of record whose state changes are worth keeping. */
export type HistoryEntity =
  | "booking"
  | "job_card"
  | "sale"
  | "shift"
  | "stock_transfer"
  | "stock_request"
  | "purchase_order"
  | "stock_count"
  | "member"
  | "product"
  | "terminal";

export type StatusTransition = {
  entity: HistoryEntity;
  entityId: string;
  /** Which state machine moved — a booking has both `status` and `job_status`. */
  kind?: string;
  from?: string | null;
  to: string;
  reason?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  storeId?: string | null;
  branchId?: string | null;
  terminalId?: string | null;
  relatedEntity?: string | null;
  relatedEntityId?: string | null;
  metadata?: Record<string, unknown>;
};

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

/**
 * Record one state change.
 *
 * Never throws and never returns an error to the caller: a transition that
 * cannot be recorded must not stop the booking being collected or the shift
 * being closed. It is parked locally instead.
 */
export async function recordTransition(t: StatusTransition): Promise<void> {
  // A change that did not change anything is not history.
  if (t.from != null && t.from === t.to) return;

  const occurredAt = new Date().toISOString();
  const clientEventId = `${t.entity}:${t.entityId}:${t.kind ?? "status"}:${t.to}:${occurredAt}`;
  const id = newId();

  try {
    const creds = await readCredentials();
    const res = await recordStatusHistory({
      data: {
        transitions: [
          {
            entityType: t.entity,
            entityId: t.entityId,
            statusKind: t.kind ?? "status",
            previousStatus: t.from ?? null,
            newStatus: t.to,
            reason: t.reason ?? null,
            actorId: t.actorId ?? null,
            actorName: t.actorName ?? null,
            actorRole: t.actorRole ?? null,
            storeId: t.storeId ?? null,
            branchId: t.branchId ?? null,
            terminalId: t.terminalId ?? null,
            relatedEntityType: t.relatedEntity ?? null,
            relatedEntityId: t.relatedEntityId ?? null,
            metadata: t.metadata ?? {},
            clientEventId,
            occurredAt,
          },
        ],
        ...(creds?.sessionToken ? { sessionToken: creds.sessionToken } : {}),
        ...(creds?.cashierToken ? { cashierToken: creds.cashierToken } : {}),
        ...(creds?.terminalToken ? { terminalToken: creds.terminalToken } : {}),
        ...(creds?.accessToken ? { accessToken: creds.accessToken } : {}),
      },
    });
    if (res?.ok) return;
  } catch {
    // fall through to parking
  }

  await parkGovernanceRow("entity_status_history", {
    id,
    entity_type: t.entity,
    entity_id: t.entityId,
    status_kind: t.kind ?? "status",
    previous_status: t.from ?? null,
    new_status: t.to,
    reason: t.reason ?? null,
    actor_id: t.actorId ?? null,
    actor_name: t.actorName ?? null,
    actor_role: t.actorRole ?? null,
    store_id: t.storeId ?? null,
    branch_id: t.branchId ?? null,
    terminal_id: t.terminalId ?? null,
    related_entity_type: t.relatedEntity ?? null,
    related_entity_id: t.relatedEntityId ?? null,
    metadata: JSON.stringify(t.metadata ?? {}),
    client_event_id: clientEventId,
    occurred_at: occurredAt,
    created_at: occurredAt,
  });
}

/** Non-throwing form; callers may await local/cloud persistence when required. */
export function trackTransition(t: StatusTransition): Promise<void> {
  return recordTransition(t).catch(() => undefined);
}
