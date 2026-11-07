import { serviceRest } from "@/core/api/pos-relay.server";

export type HeldStatusRead = {
  organizationId: string;
  branchId: string;
  tickets: Array<{ id: string; billNo: string | null; shiftId: string | null }>;
};
const PREFIX = "X-POS-Held-Status-";
const MAX_BYTES = 2 * 1024 * 1024;

async function invalid(response: Response) {
  try { await response.body?.cancel(); } catch { /* No local proof was accepted. */ }
  return Response.json({ ok: false, code: "EHELD_STATUS_PROTOCOL", error: "The held-ticket status response could not be verified. Saved work remains intact." }, { status: 502 });
}

/** Operations device/branch proof is already admitted by the shared relay. */
export async function protectedHeldStatus(args: { read: HeldStatusRead; terminalId: string; keepCommerce: boolean; signal?: AbortSignal }): Promise<Response> {
  let response: Response;
  try {
    response = await serviceRest("rpc/pos_sync_held_status_v1", {
      method: "POST", headers: { "Accept-Encoding": "identity" },
      body: JSON.stringify({ p_organization_id: args.read.organizationId, p_branch_id: args.read.branchId, p_terminal_id: args.terminalId,
        p_tickets: args.read.tickets, p_keep_commerce: args.keepCommerce, p_max_bytes: MAX_BYTES }),
      ...(args.signal ? { signal: args.signal } : {}),
    });
  } catch {
    return Response.json({ ok: false, code: "SERVICE_UNAVAILABLE", error: "The central held-ticket service did not answer. Saved work remains intact." }, { status: 503 });
  }
  // Never fall back to a broad ticket/sales download or infer completion from
  // absence, an HTTP success, counts or a newer clock.
  if (!response.ok) return new Response(response.body, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json" } });
  const bytesText = response.headers.get(PREFIX + "Bytes") ?? "", rowsText = response.headers.get(PREFIX + "Rows") ?? "";
  const bytes = Number(bytesText), rows = Number(rowsText), length = response.headers.get("content-length");
  if (response.status !== 200 || !response.body || response.headers.get(PREFIX + "Version") !== "1"
    || !/^[1-9][0-9]*$/.test(bytesText) || !Number.isSafeInteger(bytes) || bytes > MAX_BYTES
    || !/^(?:0|[1-9][0-9]*)$/.test(rowsText) || !Number.isSafeInteger(rows) || rows > args.read.tickets.length
    || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")
    || ![null, "identity"].includes(response.headers.get("content-encoding"))
    || length !== null && (!/^[0-9]+$/.test(length) || Number(length) !== bytes)) return invalid(response);
  try {
    const NativeFixedLengthStream = (globalThis as typeof globalThis & { FixedLengthStream?: new (length: number) => ReadableWritablePair<Uint8Array, Uint8Array> }).FixedLengthStream;
    let buffer: ArrayBuffer;
    if (typeof NativeFixedLengthStream === "function") {
      const bounded = new NativeFixedLengthStream(bytes);
      [buffer] = await Promise.all([new Response(bounded.readable).arrayBuffer(), response.body.pipeTo(bounded.writable)]);
    } else {
      let received = 0;
      const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) { received += chunk.byteLength; if (received > bytes || received > MAX_BYTES) throw new Error("EHELD_STATUS_PROTOCOL"); controller.enqueue(chunk); },
        flush() { if (received !== bytes) throw new Error("EHELD_STATUS_PROTOCOL"); },
      }));
      buffer = await new Response(body).arrayBuffer();
    }
    return new Response(buffer, { headers: { "content-type": "application/json", "cache-control": "no-store",
      [PREFIX + "Version"]: "1", [PREFIX + "Bytes"]: String(bytes), [PREFIX + "Rows"]: String(rows) } });
  } catch { return invalid(response); }
}
