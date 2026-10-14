/**
 * Per-shift sign-in sessions.
 *
 * Every time a cashier signs in while a shift is open we record the exact
 * moment centrally, and stamp the sign-out time when they lock, sign out or
 * the shift is closed. The local copy is the offline cache; the database row
 * is the record of truth and is written through the usual outbox, so the till
 * keeps working without a connection.
 */
import { db } from "@/core/api/pos-db";
import type { ShiftSession } from "@/core/types/pos-types";
import { recordDiagnostic, reasonCode } from "./diagnostics";
import { readBusinessValue, writeBusinessValue } from "./business-storage";

const KEY = "pos-shift-sessions-v1";

function read(): ShiftSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = readBusinessValue(KEY);
    const list = raw ? (JSON.parse(raw) as ShiftSession[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list: ShiftSession[]) {
  if (typeof window === "undefined") return;
  try {
    // Keep the most recent 200 sessions on the terminal.
    writeBusinessValue(KEY, JSON.stringify(list.slice(-200)));
  } catch {
    /* storage full — the database row still carries the truth */
  }
}

export type SessionContext = {
  shiftId: string;
  storeId: string;
  terminalId?: string | null;
  terminalName?: string | null;
  staffId?: string | null;
  staffName: string;
  role?: string | null;
};

/** Open (or refresh) the current user's session on this shift. Idempotent. */
export function beginShiftSession(ctx: SessionContext): ShiftSession | null {
  if (!ctx.shiftId || !ctx.staffName) return null;
  const id = ctx.staffId || ctx.staffName;
  const list = read();
  const existing = list.find(
    (s) => s.shiftId === ctx.shiftId && (s.staffId || s.staffName) === id && !s.signedOutAt,
  );
  if (existing) return existing;

  const session: ShiftSession = {
    id: crypto.randomUUID(),
    shiftId: ctx.shiftId,
    storeId: ctx.storeId,
    terminalId: ctx.terminalId ?? null,
    terminalName: ctx.terminalName ?? null,
    staffId: ctx.staffId ?? null,
    staffName: ctx.staffName,
    role: ctx.role ?? null,
    signedInAt: new Date().toISOString(),
    signedOutAt: null,
  };
  write([...list, session]);
  db.upsertShiftSession(session);
  return session;
}

/**
 * Stamp the sign-out time on open sessions. Pass a shift id to close only that
 * shift's sessions (used when the shift itself is closed), or a staff id to
 * close just that person's.
 */
export async function endShiftSessions(opts: { shiftId?: string; staffId?: string; awaitWrites?: boolean; persist?: boolean } = {}) {
  const writes: Promise<unknown>[] = [];
  const list = read();
  const now = new Date().toISOString();
  let changed = false;
  const next = list.map((s) => {
    if (s.signedOutAt) return s;
    if (opts.shiftId && s.shiftId !== opts.shiftId) return s;
    if (opts.staffId && (s.staffId || s.staffName) !== opts.staffId) return s;
    changed = true;
    const closed = { ...s, signedOutAt: now };
    if (opts.persist !== false) {
      if (opts.awaitWrites) writes.push(db.commitShiftSession(closed).catch(error => {
        recordDiagnostic({kind: "soft_write_failed", entity: "shift_sessions", code: reasonCode(error)});
      }));
      else db.upsertShiftSession(closed);
    }
    return closed;
  });
  if (changed) write(next);
  await Promise.all(writes);
}

/** Locally cached sessions, newest first, optionally for one shift. */
export function localShiftSessions(shiftId?: string): ShiftSession[] {
  return read()
    .filter((s) => !shiftId || s.shiftId === shiftId)
    .sort((a, b) => b.signedInAt.localeCompare(a.signedInAt));
}

/** Merge database rows with the local cache, de-duplicated by id. */
export function mergeSessions(remote: ShiftSession[], local: ShiftSession[]): ShiftSession[] {
  const byId = new Map<string, ShiftSession>();
  for (const s of local) byId.set(s.id, s);
  for (const s of remote) byId.set(s.id, s);
  return [...byId.values()].sort((a, b) => b.signedInAt.localeCompare(a.signedInAt));
}
