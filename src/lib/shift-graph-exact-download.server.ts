import {
  parseExactJson,
  stringifyExactJson,
  isExactNumber,
} from "../../electron/sync/shift-recovery-exact.mjs";
import { redactOwnedParsedSyncDownload } from "./sync-download-redaction";

const MAX_GRAPH_BYTES = 6 * 1024 * 1024;
const MAX_ENVELOPE_BYTES = 16 * 1024;
const MAX_BYTES = MAX_GRAPH_BYTES + MAX_ENVELOPE_BYTES;
const MAX_EXACT_BYTES = 32 * 1024;
const MAX_ROWS = 2000;
const MAX_DEPTH = 128;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Only privately parsed, bounded graph data crosses the existing privacy projection. */
function projectedShiftGraphJson(
  text: string,
  keepCommerce: boolean,
  preserveOrdinaryNumbers = false,
): { json: string; exact: boolean } {
  const parsed: unknown = parseExactJson(text, { maxBytes: MAX_BYTES, maxDepth: MAX_DEPTH });
  if (!record(parsed)) throw new Error("Invalid shift graph envelope");
  if (preserveOrdinaryNumbers && needsOrdinaryNumericCompatibility(parsed))
    return { json: ordinaryShiftGraphJson(text, keepCommerce), exact: false };
  let projected: unknown;
  if (Object.prototype.hasOwnProperty.call(parsed, "tables")) {
    if (!Array.isArray(parsed.tables)) throw new Error("Invalid shift graph tables");
    let rows = 0;
    for (const part of parsed.tables) {
      if (!record(part) || typeof part.table !== "string" || !Array.isArray(part.rows))
        throw new Error("Invalid shift graph table");
      rows += part.rows.length;
      if (rows > MAX_ROWS) throw new Error("Shift graph row limit exceeded");
    }
    const { tables, ...envelope } = parsed;
    // PostgreSQL bounds the table array, not its surrounding RPC metadata.
    // Keep both independently bounded without dropping any graph facts.
    stringifyExactJson(tables, { maxBytes: MAX_GRAPH_BYTES, maxDepth: MAX_DEPTH });
    stringifyExactJson(envelope, { maxBytes: MAX_ENVELOPE_BYTES, maxDepth: MAX_DEPTH });
    projected = {
      ...(redactOwnedParsedSyncDownload(envelope, "", keepCommerce) as Record<string, unknown>),
      tables: (tables as Record<string, unknown>[]).map((part) =>
        redactOwnedParsedSyncDownload(part, String(part.table), keepCommerce),
      ),
    };
  } else {
    // Preserve existing non-graph result envelopes; native strict validation still
    // decides whether a complete graph can be used. Never fabricate graph facts.
    projected = redactOwnedParsedSyncDownload(parsed, "", keepCommerce);
  }
  return {
    json: stringifyExactJson(projected, { maxBytes: MAX_BYTES, maxDepth: MAX_DEPTH }),
    exact:
      Array.isArray(parsed.tables) &&
      parsed.ok !== false &&
      !Object.prototype.hasOwnProperty.call(parsed, "error"),
  };
}

export function exactShiftGraphJson(text: string, keepCommerce: boolean): string {
  return projectedShiftGraphJson(text, keepCommerce).json;
}

function needsOrdinaryNumericCompatibility(value: unknown): boolean {
  if (isExactNumber(value)) {
    const number = Number((value as { raw: string }).raw);
    return !Number.isFinite(number) || Object.is(number, -0);
  }
  if (Array.isArray(value)) return value.some(needsOrdinaryNumericCompatibility);
  return record(value) && Object.values(value).some(needsOrdinaryNumericCompatibility);
}

/** Large graphs retain the prior ordinary download contract without claiming an
 * exact recovery witness. No rows are skipped and native strict validation stays. */
function ordinaryShiftGraphJson(text: string, keepCommerce: boolean): string {
  const parsed: unknown = JSON.parse(text);
  if (!record(parsed)) throw new Error("Invalid shift graph envelope");
  if (!Object.prototype.hasOwnProperty.call(parsed, "tables"))
    return JSON.stringify(redactOwnedParsedSyncDownload(parsed, "", keepCommerce));
  if (!Array.isArray(parsed.tables)) throw new Error("Invalid shift graph tables");
  let rows = 0;
  for (const part of parsed.tables) {
    if (!record(part) || typeof part.table !== "string" || !Array.isArray(part.rows))
      throw new Error("Invalid shift graph table");
    rows += part.rows.length;
    if (rows > MAX_ROWS) throw new Error("Shift graph row limit exceeded");
  }
  const { tables, ...envelope } = parsed;
  const encoder = new TextEncoder();
  if (
    encoder.encode(JSON.stringify(tables)).byteLength > MAX_GRAPH_BYTES ||
    encoder.encode(JSON.stringify(envelope)).byteLength > MAX_ENVELOPE_BYTES
  )
    throw new Error("Shift graph dimension limit exceeded");
  const projected = {
    ...(redactOwnedParsedSyncDownload(envelope, "", keepCommerce) as Record<string, unknown>),
    tables: (tables as Record<string, unknown>[]).map((part) =>
      redactOwnedParsedSyncDownload(part, String(part.table), keepCommerce),
    ),
  };
  return JSON.stringify(projected);
}

export async function exactShiftGraphDownload(
  response: Response,
  keepCommerce: boolean,
): Promise<Response> {
  const reader = response.body?.getReader();
  if (!reader) return invalid();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_BYTES) throw new Error("Shift graph byte limit exceeded");
      chunks.push(part.value);
    }
    const joined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(joined);
    // Exact comparison is optional. A large ordinary download must not incur
    // new precision-proof CPU cost or accidentally advertise rounded evidence.
    if (bytes > MAX_EXACT_BYTES) {
      return new Response(ordinaryShiftGraphJson(text, keepCommerce), {
        headers: { "content-type": "application/json" },
      });
    }
    const projected = projectedShiftGraphJson(text, keepCommerce, true);
    // This advertises lossless serialization only. Native strict graph validation
    // remains mandatory before any recovery comparison can trust these facts.
    return new Response(projected.json, {
      headers: {
        "content-type": "application/json",
        ...(projected.exact ? { "X-POS-Shift-Graph-Exact": "1" } : {}),
      },
    });
  } catch {
    try {
      await reader.cancel();
    } catch {
      /* Failed upstream bodies stay failed. */
    }
    return invalid();
  } finally {
    reader.releaseLock();
  }
}
function invalid() {
  return Response.json(
    {
      ok: false,
      code: "ESHIFT_GRAPH_PROTOCOL",
      error: "The shift graph response could not be verified.",
    },
    { status: 502 },
  );
}
