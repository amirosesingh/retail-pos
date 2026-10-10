import { flushTicketDrafts } from "./session-draft";
/**
 * Client side of the controlled shift-closing workflow.
 *
 * Every step is a call into a database routine: the till never decides what
 * the drawer should hold, never works out the over/short and never writes a
 * closing state itself. All this module does is ask the server to move the
 * shift along and report the state it came back in.
 */
import { supabaseExternal as supabase } from "@/integrations/supabase/external-client";
import type { ShiftState } from "@/core/types/pos-types";
import { routedQuery } from "@/core/api/db-query";
import { localDb } from "@/core/local-db/local-db";

export type ShiftCloseStep =
  | { ok: true; state: ShiftState }
  | { ok: false; error: string; queued?: boolean };

export type ShiftCloseSyncResult =
  | { ok: true; offline?: boolean; pending?: number; pushed?: number; merged?: number }
  | { ok: false; error: string; code?: string };

const fail = (e: unknown, fallback: string): ShiftCloseStep => ({
  ok: false,
  error:
    (typeof e === "object" && e && "message" in e && String((e as { message: string }).message)) ||
    fallback,
});

async function localShift(shiftId: string): Promise<Record<string, unknown>> {
  const rows = await routedQuery("shifts", { match: { id: shiftId }, limit: 1 });
  if (!rows[0]) throw new Error("That shift no longer exists on this terminal.");
  return rows[0];
}

const stateOf = (row: Record<string, unknown>) =>
  String(row.state ?? (row.closed_at ? "CLOSED" : "ACTIVE")) as ShiftState;

/**
 * Electron's final, mutex-protected push/pull barrier. Browser clients already
 * execute each closing step against the central database, so they have no
 * local journal to drain here.
 */
export async function synchronizeShiftClose(shiftId: string): Promise<ShiftCloseSyncResult> {
  const finalize = localDb()?.sync?.finalizeShiftClose;
  if (!finalize) return { ok: true };
  try {
    const result = await finalize(shiftId);
    if (!result.ok)
      return {
        ok: false,
        code: result.code,
        error: result.error ?? "The central database did not acknowledge the shift transactions.",
      };
    return {
      ok: true,
      offline: result.offline,
      pending: result.pending,
      pushed: result.pushed,
      merged: result.merged,
    };
  } catch (e) {
    return fail(e, "Shift synchronization failed.") as ShiftCloseSyncResult;
  }
}

async function callState(fn: string, args: Record<string, unknown>): Promise<ShiftCloseStep> {
  try {
    const res = await supabase.rpc(fn as never, args as never);
    if (res.error) return fail(res.error, "The closing step was refused.");
    const value = Array.isArray(res.data) ? res.data[0] : res.data;
    const state = (typeof value === "string" ? value : (value as { state?: string })?.state) as
      ShiftState | undefined;
    if (!state) return { ok: false, error: "The server did not confirm the closing step." };
    return { ok: true, state };
  } catch (e) {
    const detail = e instanceof Error ? e.message : "The central database could not be reached.";
    throw new Error(`Central database unavailable: ${detail}`, { cause: e });
  }
}

/** Step 1 — declare the intent to close, with a mandatory reason. */
export async function startShiftClose(
  shiftId: string,
  reason: string,
  terminalId?: string | null,
): Promise<ShiftCloseStep> {
  try { await flushTicketDrafts(); }
  catch (error) { return fail(error, "Save or cancel the unfinished bill before closing this shift."); }
  const bridge = localDb();
  const shiftCloseStart = bridge?.shiftCloseStart;
  if (shiftCloseStart) return (async () => {
    try {
      const clean = reason.trim();
      if (!clean) return { ok: false, error: "A reason for closing this shift is required." };
      const result = await shiftCloseStart({ shiftId, reason: clean, terminalId: terminalId ?? null });
      if (!result.ok || !result.state)
        return { ok: false, error: result.error ?? "The local shift could not start closing." };
      return { ok: true, state: result.state };
    } catch (e) { return fail(e, "The local shift could not start closing."); }
  })();
  return callState("shift_close_start", {
    p_shift: shiftId,
    p_reason: reason,
    p_terminal: terminalId ?? null,
  });
}

/**
 * Step 2 — the blind count. The reply is a state only: the cashier is never
 * told the expected figure or the variance.
 */
export async function submitCashCount(
  shiftId: string,
  counted: { cash: number; card: number | null; digital: number | null },
  opts: { clientKey?: string; terminalId?: string | null } = {},
): Promise<ShiftCloseStep> {
  const bridge = localDb();
  if (bridge?.shiftCloseCount) {
    try {
      if (!Number.isFinite(counted.cash) || counted.cash < 0)
        return { ok: false, error: "Enter the cash counted in the drawer." };
      if (counted.card != null && (!Number.isFinite(counted.card) || counted.card < 0))
        return { ok: false, error: "The card total counted cannot be negative." };
      if (counted.digital != null && (!Number.isFinite(counted.digital) || counted.digital < 0))
        return { ok: false, error: "The digital total counted cannot be negative." };
      const result = await bridge.shiftCloseCount({
        shiftId,
        cash: counted.cash,
        card: counted.card,
        digital: counted.digital,
        clientKey: opts.clientKey ?? `${shiftId}:original`,
        terminalId: opts.terminalId ?? null,
      });
      if (!result.ok || !result.state)
        return { ok: false, error: result.error ?? "The cash count could not be saved locally." };
      return { ok: true, state: result.state };
    } catch (e) { return fail(e, "The cash count could not be saved locally."); }
  }
  const args = {
    p_shift: shiftId,
    p_cash: counted.cash,
    p_card: counted.card,
    p_digital: counted.digital,
    p_client_key: opts.clientKey ?? `${shiftId}:original`,
    p_terminal: opts.terminalId ?? null,
  };
  return callState("shift_cash_count_submit", args);
}

/** An authorised recount — always kept alongside the original count. */
export function submitRecount(
  shiftId: string,
  counted: { cash: number; card: number | null; digital: number | null },
  reason: string,
  terminalId?: string | null,
): Promise<ShiftCloseStep> {
  const bridge = localDb();
  const shiftRecount = bridge?.shiftRecount;
  if (shiftRecount) return (async () => {
    try {
      const clean = reason.trim();
      if (!clean) return { ok: false, error: "A reason for the recount is required." };
      const result = await shiftRecount({
        shiftId, cash: counted.cash, card: counted.card, digital: counted.digital,
        reason: clean, terminalId: terminalId ?? null,
      });
      if (!result.ok || !result.state)
        return { ok: false, error: result.error ?? "The recount could not be saved locally." };
      return { ok: true, state: result.state };
    } catch (e) { return fail(e, "The recount could not be saved locally."); }
  })();
  return callState("shift_recount_submit", {
    p_shift: shiftId,
    p_cash: counted.cash,
    p_reason: reason,
    p_card: counted.card,
    p_digital: counted.digital,
    p_terminal: terminalId ?? null,
  });
}

/** A supervisor accepts the difference and the shift finally closes. */
export function approveVariance(shiftId: string, note?: string): Promise<ShiftCloseStep> {
  const bridge = localDb();
  const shiftVarianceApprove = bridge?.shiftVarianceApprove;
  if (shiftVarianceApprove) return (async () => {
    try {
      const result = await shiftVarianceApprove({ shiftId, note: note ?? null });
      if (!result.ok || !result.state)
        return { ok: false, error: result.error ?? "The variance approval could not be saved locally." };
      return { ok: true, state: result.state };
    } catch (e) { return fail(e, "The variance approval could not be saved locally."); }
  })();
  return callState("shift_variance_approve", { p_shift: shiftId, p_note: note ?? null });
}

/** Where the server thinks this shift is right now. */
export async function readShiftState(shiftId: string): Promise<ShiftState | null> {
  try {
    if (localDb()?.query) return stateOf(await localShift(shiftId));
    const res = await supabase.rpc("shift_state" as never, { p_shift: shiftId } as never);
    if (res.error) return null;
    const value = Array.isArray(res.data) ? res.data[0] : res.data;
    return (value as ShiftState) ?? null;
  } catch {
    return null;
  }
}

export type ShiftReconciliation = {
  expectedCash: number;
  expectedCard: number;
  expectedDigital: number;
  countedCash: number | null;
  countedCard: number | null;
  countedDigital: number | null;
  varianceCash: number | null;
  varianceCard: number | null;
  varianceDigital: number | null;
  varianceTotal: number | null;
  varianceStatus: string;
  createdAt: string;
};

/**
 * The manager view of a closure. Access is enforced in the database — a
 * cashier's request simply comes back empty.
 */
export async function loadReconciliations(shiftId: string): Promise<ShiftReconciliation[]> {
  try {
    const bridge = localDb();
    if (bridge?.shiftReconciliationView) {
      const result = await bridge.shiftReconciliationView(shiftId);
      if (!result.ok) return [];
      return (result.rows ?? []).map(mapReconciliation);
    }
    const res = await supabase.rpc("shift_reconciliation_view" as never, {
      p_shift: shiftId,
    } as never);
    if (res.error) return [];
    return ((res.data as Record<string, unknown>[] | null) ?? []).map(mapReconciliation);
  } catch {
    return [];
  }
}

const mapReconciliation = (r: Record<string, unknown>): ShiftReconciliation => ({
  expectedCash: Number(r["expected_cash"] ?? 0), expectedCard: Number(r["expected_card"] ?? 0),
  expectedDigital: Number(r["expected_digital"] ?? 0),
  countedCash: r["counted_cash"] == null ? null : Number(r["counted_cash"]),
  countedCard: r["counted_card"] == null ? null : Number(r["counted_card"]),
  countedDigital: r["counted_digital"] == null ? null : Number(r["counted_digital"]),
  varianceCash: r["variance_cash"] == null ? null : Number(r["variance_cash"]),
  varianceCard: r["variance_card"] == null ? null : Number(r["variance_card"]),
  varianceDigital: r["variance_digital"] == null ? null : Number(r["variance_digital"]),
  varianceTotal: r["variance_total"] == null ? null : Number(r["variance_total"]),
  varianceStatus: String(r["variance_status"] ?? ""), createdAt: String(r["created_at"] ?? ""),
});

export type ShiftCashCount = {
  id: string;
  kind: "ORIGINAL" | "RECOUNT";
  countedCash: number;
  countedCard: number | null;
  countedDigital: number | null;
  reason: string | null;
  countedByName: string | null;
  createdAt: string;
};

/** Every count ever taken on a shift, oldest first — nothing is overwritten. */
export async function loadCashCounts(shiftId: string): Promise<ShiftCashCount[]> {
  try {
    if (localDb()?.query) {
      const rows = await routedQuery("shift_cash_counts", {
        match: { shift_id: shiftId }, orderBy: { column: "created_at", ascending: true }, limit: 500,
      });
      return rows.map(mapCashCount);
    }
    const res = await supabase
      .from("shift_cash_counts" as never)
      .select("*")
      .eq("shift_id", shiftId)
      .order("created_at", { ascending: true });
    if (res.error) return [];
    return ((res.data as Record<string, unknown>[] | null) ?? []).map(mapCashCount);
  } catch {
    return [];
  }
}

const mapCashCount = (r: Record<string, unknown>): ShiftCashCount => ({
  id: String(r["id"]), kind: (r["kind"] as "ORIGINAL" | "RECOUNT") ?? "ORIGINAL",
  countedCash: Number(r["counted_cash"] ?? 0),
  countedCard: r["counted_card"] == null ? null : Number(r["counted_card"]),
  countedDigital: r["counted_digital"] == null ? null : Number(r["counted_digital"]),
  reason: (r["reason"] as string) ?? null, countedByName: (r["counted_by_name"] as string) ?? null,
  createdAt: String(r["created_at"] ?? ""),
});

export type ShiftCloseEvent = {
  id: string;
  event: string;
  fromState: string | null;
  toState: string | null;
  actorName: string | null;
  createdAt: string;
};

/** The append-only closing trail for one shift. */
export async function loadCloseEvents(shiftId: string): Promise<ShiftCloseEvent[]> {
  try {
    if (localDb()?.query) {
      const rows = await routedQuery("shift_close_events", {
        match: { shift_id: shiftId }, orderBy: { column: "created_at", ascending: true }, limit: 1000,
      });
      return rows.map(mapCloseEvent);
    }
    const res = await supabase
      .from("shift_close_events" as never)
      .select("*")
      .eq("shift_id", shiftId)
      .order("created_at", { ascending: true });
    if (res.error) return [];
    return ((res.data as Record<string, unknown>[] | null) ?? []).map(mapCloseEvent);
  } catch {
    return [];
  }
}

const mapCloseEvent = (r: Record<string, unknown>): ShiftCloseEvent => ({
  id: String(r["id"]), event: String(r["event"] ?? ""),
  fromState: (r["from_state"] as string) ?? null, toState: (r["to_state"] as string) ?? null,
  actorName: (r["actor_name"] as string) ?? null, createdAt: String(r["created_at"] ?? ""),
});
