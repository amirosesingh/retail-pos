import { isTerminalApp } from "@/platform-config/platform";
import { routedQuery } from "@/core/api/db-query";
import { posFetch } from "./server-origin";
import {
  listSystemAudit as listSystemAuditFn,
  recordSystemAudit as recordSystemAuditFn,
} from "./system-audit.functions";

type DirectCall = (input: never) => Promise<unknown>;

async function callHosted<T>(action: "record" | "list", data: unknown, direct: DirectCall) {
  if (!isTerminalApp()) return direct({ data } as never) as Promise<T>;
  const response = await posFetch("/api/v1/pos/sync?operation=system_audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, data }),
  });
  const result = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok && !(result && typeof result === "object" && "error" in result)) {
    throw new Error(`Audit service failed (${response.status})`);
  }
  return result;
}

export const recordSystemAudit = (input: NonNullable<Parameters<typeof recordSystemAuditFn>[0]>) =>
  callHosted<Awaited<ReturnType<typeof recordSystemAuditFn>>>(
    "record",
    input.data,
    recordSystemAuditFn as DirectCall,
  );

export const listSystemAudit = (input: NonNullable<Parameters<typeof listSystemAuditFn>[0]>) =>
  (async () => {
    const data = input.data as { accessToken: string; limit?: number };
    if (isTerminalApp()) {
      try {
        const rows = await routedQuery("system_audit_logs", {
          orderBy: { column: "created_at", ascending: false },
          limit: Math.min(data.limit ?? 200, 1000),
        });
        const text = (value: unknown) =>
          value === null || value === undefined
            ? null
            : typeof value === "string"
              ? value
              : JSON.stringify(value);
        return {
          ok: true as const,
          rows: rows.map((row) => ({
            ...row,
            old_value: text(row.old_value),
            new_value: text(row.new_value),
          })),
          source: "local" as const,
        };
      } catch {
        // A terminal with no local SQL connection can still use the hosted
        // audit service while online. The caller's access token is checked
        // there before any history is returned.
      }
    }
    return callHosted<Awaited<ReturnType<typeof listSystemAuditFn>>>(
      "list",
      data,
      listSystemAuditFn as DirectCall,
    );
  })();
