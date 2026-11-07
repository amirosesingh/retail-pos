import { serviceRest } from "@/core/api/pos-relay.server";
import { boundedText } from "../../electron/sync/shift-recovery-exact.mjs";

type HeldSaleRead = {
  organizationId: "default";
  branchId: string;
  ticketId: string;
  billNo: string;
  shiftId: string;
};

const MAX_GRAPH_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 2 * MAX_GRAPH_BYTES + 4096;
const headers = { "content-type": "application/json", "cache-control": "no-store" };
const fail = (code: string, status: number) => Response.json({ ok: false, code,
  error: "The saved bill could not be verified for review. Existing records remain intact." }, { status, headers });

/** The relay has already verified the current Administrator and paired PC. */
export async function reviewedHeldSale(args: { read: HeldSaleRead; terminalId: string; actorId: string; keepCommerce: boolean; signal?: AbortSignal }) {
  const { read, terminalId, actorId } = args;
  let response: Response;
  try {
    response = await serviceRest("rpc/pos_sync_held_sale_review_v1", {
      method: "POST", headers: { "Accept-Encoding": "identity" }, signal: args.signal,
      body: JSON.stringify({ p_organization_id: read.organizationId, p_branch_id: read.branchId,
        p_terminal_id: terminalId, p_actor_id: actorId, p_ticket_id: read.ticketId,
        p_bill_no: read.billNo, p_shift_id: read.shiftId, p_keep_commerce: args.keepCommerce }),
    });
  } catch {
    return fail("SERVICE_UNAVAILABLE", 503);
  }
  if (!response.ok) {
    try {
      const error = JSON.parse(await boundedText(response, 4096));
      if (error?.code === "23514" && error?.message === "HELD_SALE_REVIEW_CONFLICT") return fail("EHELD_SALE_REVIEW_CONFLICT", 409);
      if (error?.code === "42501") return fail("PERMISSION_DENIED", 403);
      if (response.status === 404 && error?.code === "PGRST202") return fail("EHELD_SALE_REVIEW_CLOUD_SCHEMA", 404);
    } catch { /* Do not expose raw database errors or accept partial output. */ }
    return fail(response.status >= 500 ? "SERVICE_UNAVAILABLE" : "EHELD_SALE_REVIEW_PROTOCOL", response.status >= 500 ? 503 : 502);
  }

  try {
    if (response.status !== 200 || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? ""))
      throw new Error("Invalid review response type");
    const text = await boundedText(response, MAX_RESPONSE_BYTES);
    const envelope = JSON.parse(text);
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || Object.keys(envelope).length !== 11 ||
        envelope.ok !== true || envelope.version !== 1 || envelope.organizationId !== read.organizationId ||
        envelope.branchId !== read.branchId || envelope.terminalId !== terminalId || envelope.actorId !== actorId ||
        envelope.ticketId !== read.ticketId || envelope.billNo !== read.billNo || envelope.shiftId !== read.shiftId ||
        !((envelope.proof === null && envelope.graphJson === null) ||
          (["cleaned_hold", "completed_hold"].includes(envelope.proof) && typeof envelope.graphJson === "string" &&
            envelope.graphJson.length > 0 && new TextEncoder().encode(envelope.graphJson).length <= MAX_GRAPH_BYTES)))
      throw new Error("Invalid review response scope");
    // Keep the exact sale graph as JSON text for Main's lossless validator.
    return new Response(text, { headers });
  } catch {
    try { await response.body?.cancel(); } catch { /* No result was admitted. */ }
    return fail("EHELD_SALE_REVIEW_PROTOCOL", 502);
  }
}
