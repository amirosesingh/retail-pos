import { serviceRest } from "@/core/api/pos-relay.server";
import { boundedText } from "../../electron/sync/shift-recovery-exact.mjs";
import type { ScopedHistoryRead } from "./sync-endpoint.server";

type Context = { terminalId: string; keepCommerce: boolean; signal?: AbortSignal };
const unavailable = () => Response.json({
  ok: false, code: "SERVICE_UNAVAILABLE", error: "The central scoped history service did not answer; recovery will retry.",
}, { status: 503 });
const invalidCounts = () => Response.json({
  ok: false, code: "EHISTORY_INDEX_PROTOCOL", error: "The scoped table counts could not be verified; recovery remains pending.",
}, { status: 502 });

async function scopedCounts(read: Extract<ScopedHistoryRead, { action: "counts" }>, context: Context) {
  const response = await serviceRest("rpc/pos_sync_counts_history_v2", {
    method: "POST",
    headers: { "Accept-Encoding": "identity" },
    ...(context.signal ? { signal: context.signal } : {}),
    body: JSON.stringify({
      p_organization_id: read.organizationId, p_branch_id: read.branchId,
      p_terminal_id: context.terminalId, p_history_days: read.historyDays,
    }),
  });
  const contentType = response.headers.get("content-type") ?? "application/json";
  if (!response.ok) return new Response(response.body, { status: response.status, headers: { "content-type": contentType } });
  if (response.status !== 200 || !/^application\/json(?:\s*;|$)/i.test(contentType) ||
      ![null, "identity"].includes(response.headers.get("content-encoding"))) {
    await response.body?.cancel().catch(() => undefined);
    return invalidCounts();
  }
  try {
    const raw = await boundedText(response, 128 * 1024);
    if (!Array.isArray(JSON.parse(raw))) return invalidCounts();
    return new Response(raw, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch {
    return invalidCounts();
  }
}

/** Relay authorization and privacy selection are complete before entering this transport. */
export async function scopedHistoryTransport({ read, ...context }: Context & { read: ScopedHistoryRead }) {
  let response: Response | null;
  try {
    switch (read.action) {
      case "bootstrap": {
        const { protectedHistoryDownload } = await import("./protected-history-download.server");
        response = await protectedHistoryDownload({ ...context, ...read, scopedTransport: true });
        break;
      }
      case "feed": {
        const { protectedFeedDownload } = await import("./protected-feed-download.server");
        response = await protectedFeedDownload({ ...context, ...read, scopedTransport: true });
        break;
      }
      case "counts":
        response = await scopedCounts(read, context);
        break;
      default: {
        const { protectedHistoryReconciliation } = await import("./protected-history-reconciliation.server");
        response = await protectedHistoryReconciliation({
          ...context, read: { ...read, accessPolicy: "branch-history-v1" }, scopedTransport: true,
        });
      }
    }
  } catch {
    return unavailable();
  }
  if (!response) return unavailable();
  if (!response.ok) return response;
  const headers = new Headers(response.headers);
  headers.set("X-POS-Scoped-History-Transport", "1");
  return new Response(response.body, { status: response.status, headers });
}
