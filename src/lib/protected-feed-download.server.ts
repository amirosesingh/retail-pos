import { serviceRest } from "@/core/api/pos-relay.server";
import { supabaseConfig } from "./external-supabase-config";

const HARD_BYTES = 5 * 1024 * 1024;
const PAGE_BYTES = 2 * 1024 * 1024;
const unavailableUntil = new Map<string, number>();

async function unsupported(response: Response): Promise<boolean> {
  if (response.status !== 404 && response.status !== 400) return false;
  const reader = response.body?.getReader();
  if (!reader) return false;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
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
    return (response.status === 404 && value?.code === "PGRST202" && typeof value.message === "string"
      && /\bpublic\.pos_sync_feed_page_v1\b/.test(value.message))
      || (response.status === 400 && value?.code === "P0001" && value.message === "POS_FEED_STREAM_UNSUPPORTED_SOURCE");
  } catch { return false; }
  finally { reader.releaseLock(); }
}

async function invalid(response: Response): Promise<Response> {
  try { await response.body?.cancel(); } catch { /* Already closed. */ }
  return Response.json({ error: "The protected feed response could not be verified.", code: "EFEED_PROTOCOL" }, { status: 502 });
}

/** Only admit the service RPC's complete, privacy-projected, byte-bounded page. */
export async function protectedFeedDownload(args: {
  organizationId: string; branchId: string; terminalId: string; cursor: number;
  keepCommerce: boolean; signal?: AbortSignal;
}): Promise<Response | null> {
  const project = supabaseConfig().url.replace(/\/+$/, "");
  if ((unavailableUntil.get(project) ?? 0) > Date.now()) return null;
  const response = await serviceRest("rpc/pos_sync_feed_page_v1", {
    method: "POST", headers: { "Accept-Encoding": "identity" },
    ...(args.signal ? { signal: args.signal } : {}),
    body: JSON.stringify({ p_organization_id: args.organizationId, p_branch_id: args.branchId,
      p_terminal_id: args.terminalId, p_after_cursor: args.cursor,
      p_keep_commerce: args.keepCommerce, p_max_bytes: PAGE_BYTES }),
  });
  const encoding = response.headers.get("Content-Encoding");
  if (encoding !== null && encoding.toLowerCase() !== "identity") return invalid(response);
  if (!response.ok) {
    if (await unsupported(response.clone())) {
      for (const [key, until] of unavailableUntil) if (until <= Date.now()) unavailableUntil.delete(key);
      if (unavailableUntil.size >= 64) unavailableUntil.delete(unavailableUntil.keys().next().value!);
      unavailableUntil.set(project, Date.now() + 30_000);
      try { await response.body?.cancel(); } catch { /* No local state changed. */ }
      return null;
    }
    return new Response(response.body, { status: response.status, headers: { "content-type": "application/json" } });
  }
  const bytesText = response.headers.get("X-POS-Feed-Bytes") ?? "";
  const rowsText = response.headers.get("X-POS-Feed-Rows") ?? "";
  const continuation = response.headers.get("X-POS-Feed-Continue");
  const length = response.headers.get("Content-Length");
  const bytes = Number(bytesText), rows = Number(rowsText);
  if (response.status !== 200 || !response.body || response.headers.get("X-POS-Feed-Projection") !== "1"
    || (continuation !== "0" && continuation !== "1")
    || (encoding !== null && encoding.toLowerCase() !== "identity")
    || !/^[1-9]\d*$/.test(bytesText) || !Number.isSafeInteger(bytes) || bytes < 2 || bytes > HARD_BYTES
    || !/^(?:[0-9]|10)$/.test(rowsText) || (rows === 0 && (bytes !== 2 || continuation !== "0"))
    || (bytes > PAGE_BYTES && rows !== 1)
    || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("Content-Type") ?? "")
    || (length !== null && (!/^\d+$/.test(length) || Number(length) !== bytes))) return invalid(response);
  const NativeFixedLengthStream = (globalThis as typeof globalThis & {
    FixedLengthStream?: new (length: number) => ReadableWritablePair<Uint8Array, Uint8Array>;
  }).FixedLengthStream;
  try {
    let buffer: ArrayBuffer;
    if (typeof NativeFixedLengthStream === "function") {
      const bounded = new NativeFixedLengthStream(bytes);
      [buffer] = await Promise.all([new Response(bounded.readable).arrayBuffer(), response.body.pipeTo(bounded.writable)]);
    } else {
      let received = 0;
      const bounded = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          received += chunk.byteLength;
          if (received > bytes || received > HARD_BYTES) throw new Error("EFEED_PROTOCOL");
          controller.enqueue(chunk);
        },
        flush() { if (received !== bytes) throw new Error("EFEED_PROTOCOL"); },
      }));
      buffer = await new Response(bounded).arrayBuffer();
    }
    return new Response(buffer, { headers: { "content-type": "application/json", "cache-control": "no-store",
      "X-POS-Feed-Projection": "1", "X-POS-Feed-Continue": continuation } });
  } catch { return invalid(response); }
}
