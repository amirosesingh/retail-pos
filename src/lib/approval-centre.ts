/**
 * The one place the till talks to the approvals queue.
 *
 * A live message from the database is only a notification: it tells the till
 * that a decision has arrived, never that the action is permitted. Permission
 * always comes from claiming the approval on the server, which checks the
 * owner, the ticket and that nobody has used it already. The 45-second poll
 * below is the safety net for a terminal that missed the live message.
 */
import { supabaseExternal } from "@/integrations/supabase/external-client";

import {
  claimAuthorizationRequest,
  listAuthorizationRequests,
} from "./authorization-client";
import { getPosCallerAuth } from "./pos-caller-auth";
import { markHeldReady } from "./held-orders";
import type { AuthorizationRequest } from "./authorization";

export const CENTRE_POLL_MS = 45_000;
let approvalChannelSequence = 0;

export type CentreView = {
  /** requests this person may decide */
  toDecide: AuthorizationRequest[];
  /** requests this person sent that are still waiting */
  waiting: AuthorizationRequest[];
  /** decided requests this person sent that have not been used yet */
  ready: AuthorizationRequest[];
  /** everything else they sent, already decided and finished with */
  history: AuthorizationRequest[];
  me: string;
};

const empty: CentreView = { toDecide: [], waiting: [], ready: [], history: [], me: "" };

/** Split the queue into what this person is waiting for and what they must decide. */
export function splitRequests(
  rows: AuthorizationRequest[],
  meId: string,
): Omit<CentreView, "me"> {
  const me = meId.toLowerCase();
  const mine = rows.filter((r) => r.requestedBy.toLowerCase() === me);
  const others = rows.filter((r) => r.requestedBy.toLowerCase() !== me);
  return {
    toDecide: others.filter((r) => r.status === "pending"),
    waiting: mine.filter((r) => r.status === "pending"),
    ready: mine.filter((r) => r.status === "approved" && !r.consumedAt),
    history: mine.filter(
      (r) => r.status !== "pending" && !(r.status === "approved" && !r.consumedAt),
    ),
  };
}

export async function loadApprovalCentre(storeId?: string | null): Promise<CentreView> {
  const auth = await getPosCallerAuth();
  const res = await listAuthorizationRequests({
    data: {
      ...auth,
      ...(storeId ? { storeId } : {}),
      allBranches: false,
      status: "all",
    },
  });
  if (!res.ok || !Array.isArray(res.requests)) return empty;
  const meId = res.me?.id ?? "";
  const view = splitRequests(res.requests as AuthorizationRequest[], meId);
  // A ticket parked for a decision becomes pickable again the moment one lands.
  for (const r of view.ready) if (r.heldOrderId) markHeldReady(r.heldOrderId);
  return { ...view, me: meId };
}

/**
 * Turn a granted request into permission for the ticket in hand. The hash is
 * the ticket as it is right now; the server refuses if it is not the ticket
 * the approver reviewed.
 */
export async function claimApproval(id: string, snapshotHash?: string) {
  const auth = await getPosCallerAuth();
  return claimAuthorizationRequest({
    data: { ...auth, id, ...(snapshotHash ? { snapshotHash } : {}) },
  });
}

/**
 * Live delivery of decisions and new requests. Falls back silently when the
 * database has no realtime — the poll still reconciles.
 */
export function subscribeApprovals(onChange: () => void): () => void {
  try {
    // ActivityBell and the approvals page can be mounted together. Distinct
    // topics keep one subscriber from replacing the other's channel.
    const channel = supabaseExternal.channel(
      `pos-approval-centre:${++approvalChannelSequence}`,
    );
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "authorization_requests" },
      () => onChange(),
    );
    channel.subscribe();
    return () => {
      void supabaseExternal.removeChannel(channel);
    };
  } catch {
    return () => undefined;
  }
}
