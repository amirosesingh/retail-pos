import { serviceRest } from "@/core/api/pos-relay.server";
import { supabaseConfig } from "./external-supabase-config";

const HARD_BYTES = 5 * 1024 * 1024;
const PAGE_BYTES = 2 * 1024 * 1024;
const LEGACY_ROWS = 10;
const BATCH_ROWS = 50;
const unavailableUntil = new Map<string, number>();
const batchedUnavailableUntil = new Map<string, number>();

function rememberUnavailable(cache: Map<string, number>, project: string) {
  const now = Date.now();
  for (const [key, until] of cache) if (until <= now) cache.delete(key);
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(project, now + 30_000);
}

async function unsupported(response: Response, batched = false): Promise<boolean> {
  if (batched && response.status !== 404) return false;
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
    if (batched) return value?.code === "PGRST202" && typeof value.message === "string"
      && /^Could not find (?:the function )?public\.pos_sync_feed_page_v3(?:\(|\s|$)/.test(value.message);
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
  keepCommerce: boolean; signal?: AbortSignal; scopedTransport?: true; limit?: number;
}): Promise<Response | null> {
  const project = supabaseConfig().url.replace(/\/+$/, "");
  if (!args.scopedTransport && (unavailableUntil.get(project) ?? 0) > Date.now()) return null;
  const read = (rpc: string, limit?: number) => serviceRest("rpc/" + rpc, {
    method: "POST", headers: { "Accept-Encoding": "identity" },
    ...(args.signal ? { signal: args.signal } : {}),
    body: JSON.stringify({ p_organization_id: args.organizationId, p_branch_id: args.branchId,
      p_terminal_id: args.terminalId, p_after_cursor: args.cursor, p_keep_commerce: args.keepCommerce,
      p_max_bytes: PAGE_BYTES, ...(limit === undefined ? {} : { p_limit: limit }) }),
  });
  const batched = args.scopedTransport === true && (batchedUnavailableUntil.get(project) ?? 0) <= Date.now();
  let rowLimit = batched ? Math.max(LEGACY_ROWS, Math.min(BATCH_ROWS, args.limit ?? BATCH_ROWS)) : LEGACY_ROWS;
  let response = batched ? await read("pos_sync_feed_page_v3", rowLimit)
    : await read(args.scopedTransport ? "pos_sync_feed_page_v2" : "pos_sync_feed_page_v1");
  // Only an explicitly missing capability may retry the same authorized cursor.
  // Authority, transport, source guards and malformed pages preserve failure.
  const identityEncoding = (input: Response) =>
    [null, "identity"].includes(input.headers.get("Content-Encoding")?.toLowerCase() ?? null);
  if (!identityEncoding(response)) return invalid(response);
  if (batched && response.status === 404 && await unsupported(response.clone(), true)) {
    rememberUnavailable(batchedUnavailableUntil, project);
    try { await response.body?.cancel(); } catch { /* No local state changed. */ }
    rowLimit = LEGACY_ROWS;
    response = await read("pos_sync_feed_page_v2");
    if (!identityEncoding(response)) return invalid(response);
  }
  if (!response.ok) {
    if (!args.scopedTransport && await unsupported(response.clone())) {
      rememberUnavailable(unavailableUntil, project);
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
    || !/^[1-9]\d*$/.test(bytesText) || !Number.isSafeInteger(bytes) || bytes < 2 || bytes > HARD_BYTES
    || !/^(?:0|[1-9]\d*)$/.test(rowsText) || rows > rowLimit || (rows === 0 && (bytes !== 2 || continuation !== "0"))
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
