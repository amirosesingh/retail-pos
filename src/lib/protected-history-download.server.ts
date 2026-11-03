import { serviceRest } from "@/core/api/pos-relay.server";
import { supabaseConfig } from "./external-supabase-config";

const RPC = "pos_sync_history_page_v1";
const HARD_BYTES = 5 * 1024 * 1024;
const unavailableUntil = new Map<string, number>();
const TTL = 30_000;
const MAX_PROJECTS = 64;

function unavailable(project: string) {
  const now = Date.now();
  for (const [key, until] of unavailableUntil) if (until <= now) unavailableUntil.delete(key);
  if (unavailableUntil.size >= MAX_PROJECTS) unavailableUntil.delete(unavailableUntil.keys().next().value!);
  unavailableUntil.set(project, now + TTL);
}

async function recognizedUnsupported(response: Response): Promise<boolean> {
  // Only small, explicit capability errors may activate legacy redaction.
  // Authentication, permissions, timeouts and malformed responses never do.
  const reader = response.body?.getReader();
  if (!reader) return false;
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 16_384) { void reader.cancel().catch(() => {}); return false; }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const value = JSON.parse(new TextDecoder().decode(bytes));
    return (response.status === 404 && value?.code === "PGRST202"
      && typeof value.message === "string" && /\bpublic\.pos_sync_history_page_v1\b/.test(value.message))
      || (response.status === 400 && value?.code === "P0001" && value.message === "POS_HISTORY_STREAM_UNSUPPORTED_SOURCE");
  } catch { return false; }
  finally { reader.releaseLock(); }
}

async function invalid(response: Response): Promise<Response> {
  try { await response.body?.cancel(); } catch { /* An already closed body needs no cleanup. */ }
  return Response.json({ error: "The protected history response could not be verified.", code: "EHISTORY_PROTOCOL" }, { status: 502 });
}

export async function protectedHistoryDownload(args: {
  organizationId: string; branchId: string; terminalId: string;
  cursor: string | null; historyDays: number; keepCommerce: boolean;
}): Promise<Response | null> {
  const project = supabaseConfig().url.replace(/\/+$/, "");
  if ((unavailableUntil.get(project) ?? 0) > Date.now()) return null;
  const response = await serviceRest(`rpc/${RPC}`, {
    method: "POST", headers: { "Accept-Encoding": "identity" },
    body: JSON.stringify({ p_organization_id: args.organizationId, p_branch_id: args.branchId,
      p_terminal_id: args.terminalId, p_after_cursor: args.cursor, p_history_days: args.historyDays,
      p_keep_commerce: args.keepCommerce, p_max_bytes: 2 * 1024 * 1024 }),
  });
  const encoding = response.headers.get("Content-Encoding");
  if (encoding !== null && encoding.toLowerCase() !== "identity") return invalid(response);
  if (!response.ok) {
    // Inspect a clone: unrecognized failures retain their original response.
    if (await recognizedUnsupported(response.clone())) {
      unavailable(project);
      try { await response.body?.cancel(); } catch { /* No business state is changed. */ }
      return null;
    }
    return new Response(response.body, { status: response.status, headers: { "content-type": "application/json" } });
  }
  const bytesText = response.headers.get("X-POS-History-Bytes") ?? "";
  const rowsText = response.headers.get("X-POS-History-Rows") ?? "";
  const bytes = Number(bytesText), rows = Number(rowsText);
  const length = response.headers.get("Content-Length");
  if (response.status !== 200 || !response.body || response.headers.get("X-POS-History-Projection") !== "1"
    || !/^[1-9]\d*$/.test(bytesText) || !Number.isSafeInteger(bytes) || bytes < 25 || bytes > HARD_BYTES
    || !/^(?:[0-9]|10)$/.test(rowsText) || rows > 10
    || (bytes > 2 * 1024 * 1024 && rows !== 1)
    || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("Content-Type") ?? "")
    || (length !== null && (!/^\d+$/.test(length) || Number(length) !== bytes))) return invalid(response);
  let received = 0;
  const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > bytes || received > HARD_BYTES) throw new Error("EHISTORY_PROTOCOL");
      controller.enqueue(chunk);
    },
    flush() { if (received !== bytes) throw new Error("EHISTORY_PROTOCOL"); },
  }));
  // Never forward compression or Content-Length across the streamed boundary.
  return new Response(body, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
