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

import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import type { GateRequest, GateResult } from "@/lib/manager-gate";
import {
  holdRecordForEdit,
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

export type BeginOutcome =
  { kind: "open"; grant: EditGrant } | { kind: "queued" } | { kind: "blocked" };

/** Ask for permission to edit a posted record. */
export async function beginPostedEdit(
  authorize: (r: GateRequest) => Promise<GateResult>,
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
  const res = await authorize({
    action: opts.action,
    title: opts.title,
    reason: `Reopen ${opts.reference || opts.recordId}`,
    ...(opts.storeId ? { storeId: opts.storeId } : {}),
    ...(opts.terminalId ? { terminalId: opts.terminalId } : {}),
    ...(opts.detail ? { detail: opts.detail } : {}),
    payload: {
      recordKind: opts.recordKind,
      recordId: opts.recordId,
      reference: opts.reference,
      summary: opts.detail ?? "",
    },
  });

  if (res.ok) {
    return {
      kind: "open",
      grant: {
        grantToken: res.grantToken,
        authorizedBy: "",
        modeUsed: res.grantToken ? "pin" : "none",
      },
    };
  }

  if (res.pendingRequestId) {
    const auth = await getPosCallerAuth();
    const held = await holdRecordForEdit({
      data: {
        ...auth,
        kind: opts.recordKind,
        recordId: opts.recordId,
        requestId: res.pendingRequestId,
      },
    });
    if (!held.ok) {
      toast.error(held.error ?? "Could not hold this record");
      return { kind: "blocked" };
    }
    toast.success("Sent for approval", {
      description: "The record stays as posted until the request is approved.",
    });
    return { kind: "queued" };
  }

  return { kind: "blocked" };
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
export async function saveRecordEditHistory(input: {
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
}): Promise<void> {
  try {
    const auth = await getPosCallerAuth();
    const res = await logRecordEdit({
      data: {
        ...auth,
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
    if (res.ok) return;
  } catch {
    /* falls through to the local trail below */
  }
  // The central database could not take it: keep the entry on this till so
  // the change is never invisible, and let the sync worker push it later.
  if (await parkRecordEdit(input)) {
    toast.info("Saved. Its history entry will reach head office when the line is back.");
    return;
  }
  toast.warning("The change was saved, but its history entry could not be written.");
}

/** Store one edit history entry in the till's own database. */
async function parkRecordEdit(input: {
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
}): Promise<boolean> {
  try {
    const { parkGovernanceRow } = await import("@/lib/governance-offline");
    const res = await parkGovernanceRow("record_edits", {
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
