/**
 * The one path a posted record takes when someone wants to change it.
 *
 *   ask → PIN (opens now) · request (record goes on hold) · refused
 *   held → approved (opens once) · still waiting · rejected (unlocks)
 *
 * Every screen that edits something already posted uses these four calls, so
 * the rules, the hold and the audit entry behave identically everywhere.
 */
import { toast } from "sonner";

import { clearDeviceSecret, getDeviceSecret, setDeviceSecret } from "@/lib/device-secrets";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import type { GateRequest, GateResult } from "@/lib/manager-gate";
import {
  logRecordEdit,
  resumeRecordEdit,
  whoAmI,
  withdrawRecordEdit,
} from "@/lib/record-edits.functions";

export type RecordKind = "stock_count" | "purchase_order" | "sale";

export type EditGrant = {
  grantToken: string | null;
  authorizedBy: string;
  modeUsed: "none" | "pin" | "request";
  requestId?: string;
};

export type RecordEditHistoryInput = {
  historyId?: string;
  kind: RecordKind;
  recordId: string;
  reference?: string;
  storeId?: string | null;
  actionKey: string;
  grant?: EditGrant | null;
  before: unknown;
  after: unknown;
  stockDeltas?: Record<string, number>;
  note?: string;
};

const PENDING_EDIT_HISTORY_KEY = "pending-record-edit-history";

/** Keep an unfinished history write sealed on this device until it is retried. */
export async function rememberPendingRecordEditHistory(
  input: RecordEditHistoryInput,
): Promise<boolean> {
  try {
    const pending =
      (await getDeviceSecret<Record<string, RecordEditHistoryInput>>(PENDING_EDIT_HISTORY_KEY)) ??
      {};
    pending[input.recordId] = input;
    await setDeviceSecret(PENDING_EDIT_HISTORY_KEY, pending);
    return true;
  } catch {
    return false;
  }
}

export async function loadPendingRecordEditHistory(
  recordId: string,
): Promise<RecordEditHistoryInput | null> {
  try {
    const pending = await getDeviceSecret<Record<string, RecordEditHistoryInput>>(
      PENDING_EDIT_HISTORY_KEY,
    );
    return pending?.[recordId] ?? null;
  } catch {
    return null;
  }
}

export async function clearPendingRecordEditHistory(recordId: string): Promise<void> {
  try {
    const pending = await getDeviceSecret<Record<string, RecordEditHistoryInput>>(
      PENDING_EDIT_HISTORY_KEY,
    );
    if (!pending?.[recordId]) return;
    delete pending[recordId];
    if (Object.keys(pending).length) await setDeviceSecret(PENDING_EDIT_HISTORY_KEY, pending);
    else clearDeviceSecret(PENDING_EDIT_HISTORY_KEY);
  } catch {
    // Best effort: a stale retry marker is safe because the central insert is
    // idempotent and the UI never repeats the financial reversal.
  }
}

export type BeginOutcome =
  { kind: "open"; grant: EditGrant } | { kind: "queued" } | { kind: "blocked" };

/** Ask for permission to edit a posted record. */
export async function beginPostedEdit(
  _authorize: (r: GateRequest) => Promise<GateResult>,
  opts: {
    action: "edit_posted_stock" | "edit_posted_purchase";
    recordKind: RecordKind;
    recordId: string;
    reference: string;
    title: string;
    storeId?: string | null;
    terminalId?: string | null;
    detail?: string;
  },
): Promise<BeginOutcome> {
  const auth = await getPosCallerAuth();
  const identity = await whoAmI({ data: auth });
  if (!identity.ok || identity.role.trim().toLowerCase() !== "admin") {
    toast.error("Only an administrator can correct a posted record.");
    return { kind: "blocked" };
  }
  return {
    kind: "open",
    grant: {
      grantToken: null,
      authorizedBy: identity.name || identity.id,
      modeUsed: "none",
    },
  };
}

/** Come back to a record that was sent for approval. */
export async function continuePostedEdit(
  kind: RecordKind,
  recordId: string,
): Promise<{ open: boolean; grant?: EditGrant }> {
  const auth = await getPosCallerAuth();
  const res = await resumeRecordEdit({ data: { ...auth, kind, recordId } });
  if (!res.ok) {
    toast.error(res.error ?? "Could not check that request");
    return { open: false };
  }
  if (res.status === "approved") {
    toast.success(`Approved by ${res.approvedBy || "a supervisor"}`);
    return {
      open: true,
      grant: {
        grantToken: res.grantToken,
        authorizedBy: res.approvedBy ?? "",
        modeUsed: "request",
        ...(res.requestId ? { requestId: res.requestId } : {}),
      },
    };
  }
  if (res.status === "pending") {
    toast.info("Still waiting for approval");
    return { open: false };
  }
  if (res.status === "rejected") {
    toast.error("The edit was rejected", {
      description: res.note || "The record stays exactly as it was posted.",
    });
    return { open: false };
  }
  toast.info(`That request is ${res.status}. The record is unlocked again.`);
  return { open: false };
}

/** Take back a request nobody has decided yet. */
export async function withdrawPostedEdit(kind: RecordKind, recordId: string): Promise<boolean> {
  const auth = await getPosCallerAuth();
  const res = await withdrawRecordEdit({ data: { ...auth, kind, recordId } });
  if (!res.ok) {
    toast.error(res.error ?? "Could not withdraw the request");
    return false;
  }
  toast.success("Request withdrawn — the record is unchanged.");
  return true;
}

/** Write what actually changed, old values beside new ones. */
export async function saveRecordEditHistory(input: RecordEditHistoryInput): Promise<boolean> {
  try {
    const auth = await getPosCallerAuth();
    const res = await logRecordEdit({
      data: {
        ...auth,
        ...(input.historyId ? { historyId: input.historyId } : {}),
        kind: input.kind,
        recordId: input.recordId,
        ...(input.reference ? { reference: input.reference } : {}),
        ...(input.storeId ? { storeId: input.storeId } : {}),
        actionKey: input.actionKey,
        ...(input.grant?.requestId ? { requestId: input.grant.requestId } : {}),
        ...(input.grant?.authorizedBy ? { authorizedBy: input.grant.authorizedBy } : {}),
        ...(input.grant?.modeUsed ? { modeUsed: input.grant.modeUsed } : {}),
        before: input.before,
        after: input.after,
        stockDeltas: input.stockDeltas ?? {},
        ...(input.note ? { note: input.note } : {}),
      },
    });
    if (res.ok) return true;
  } catch {
    /* falls through to the local trail below */
  }
  // The central database could not take it: keep the entry on this till so
  // the change is never invisible, and let the sync worker push it later.
  if (await parkRecordEdit(input)) {
    toast.info("Saved. Its history entry will reach head office when the line is back.");
    return true;
  }
  toast.warning("The history entry could not be written.");
  return false;
}

/** Store one edit history entry in the till's own database. */
async function parkRecordEdit(input: RecordEditHistoryInput): Promise<boolean> {
  try {
    const { parkGovernanceRow } = await import("@/lib/governance-offline");
    const res = await parkGovernanceRow("record_edits", {
      ...(input.historyId ? { id: input.historyId } : {}),
      record_type: input.kind,
      record_id: input.recordId,
      reference: input.reference ?? null,
      store_id: input.storeId ?? "",
      action_key: input.actionKey,
      request_id: input.grant?.requestId ?? null,
      authorized_by: input.grant?.authorizedBy ?? null,
      mode_used: input.grant?.modeUsed ?? null,
      before_value: input.before ?? {},
      after_value: input.after ?? {},
      stock_deltas: input.stockDeltas ?? {},
      note: input.note ?? null,
    });
    return res.parked;
  } catch {
    return false;
  }
}

/** The id the server knows this person by, so "your" pending edits show up. */
export async function myServerId(): Promise<string> {
  try {
    const auth = await getPosCallerAuth();
    const res = await whoAmI({ data: auth });
    return res.ok ? res.id : "";
  } catch {
    return "";
  }
}
