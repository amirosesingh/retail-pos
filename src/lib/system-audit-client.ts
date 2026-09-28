import { isTerminalApp } from "@/platform-config/platform";
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
  callHosted<Awaited<ReturnType<typeof listSystemAuditFn>>>(
    "list",
    input.data,
    listSystemAuditFn as DirectCall,
  );
