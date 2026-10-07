/**
 * Security alert feed. Findings are raised by deployment scans (posted to
 * /api/public/security-alerts) and by the nightly database self-check, and are
 * readable by admins only.
 */
import { authenticatedExternalClientSnapshot } from "@/integrations/supabase/external-client";
import { hasCentralAuthSession } from "@/lib/session-presence";

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";
export type FindingStatus = "open" | "acknowledged" | "resolved";

export type SecurityFinding = {
  id: string;
  fingerprint: string;
  source: "ci" | "selfcheck" | "manual";
  severity: FindingSeverity;
  title: string;
  detail: string;
  deploymentRef: string;
  status: FindingStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  acknowledgedBy: string;
  acknowledgedAt: string | null;
};

export const SEVERITY_ORDER: FindingSeverity[] = ["critical", "high", "medium", "low", "info"];

export const SEVERITY_TONE: Record<FindingSeverity, string> = {
  critical: "border-destructive/40 bg-destructive/10 text-destructive",
  high: "border-destructive/30 bg-destructive/5 text-destructive",
  medium: "border-warning/40 bg-warning/10 text-warning",
  low: "border-border bg-surface-2 text-muted-foreground",
  info: "border-border bg-surface-2 text-muted-foreground",
};

export const SOURCE_LABEL: Record<SecurityFinding["source"], string> = {
  ci: "Deployment scan",
  selfcheck: "Nightly self-check",
  manual: "Reported by hand",
};

type Row = Record<string, unknown>;

function map(row: Row): SecurityFinding {
  return {
    id: String(row["id"] ?? ""),
    fingerprint: String(row["fingerprint"] ?? ""),
    source: (row["source"] as SecurityFinding["source"]) ?? "manual",
    severity: (row["severity"] as FindingSeverity) ?? "medium",
    title: String(row["title"] ?? ""),
    detail: String(row["detail"] ?? ""),
    deploymentRef: String(row["deployment_ref"] ?? ""),
    status: (row["status"] as FindingStatus) ?? "open",
    firstSeenAt: String(row["first_seen_at"] ?? ""),
    lastSeenAt: String(row["last_seen_at"] ?? ""),
    acknowledgedBy: String(row["acknowledged_by"] ?? ""),
    acknowledgedAt: (row["acknowledged_at"] as string | null) ?? null,
  };
}

/** Newest findings first. Returns [] when the caller is not an admin. */
export async function listSecurityFindings(includeResolved = false): Promise<SecurityFinding[]> {
  if (!hasCentralAuthSession()) return [];
  const client = await authenticatedExternalClientSnapshot();
  if (!client) return [];
  let q = client
    .from("security_findings")
    .select("*")
    .order("last_seen_at", { ascending: false })
    .limit(200);
  if (!includeResolved) q = q.neq("status", "resolved");
  const { data, error } = await q;
  if (error) return [];
  return ((data ?? []) as Row[]).map(map);
}

/** Count of findings still needing attention — drives the header bell. */
export async function countOpenFindings(): Promise<number> {
  if (!hasCentralAuthSession()) return 0;
  const client = await authenticatedExternalClientSnapshot();
  if (!client) return 0;
  const { count, error } = await client
    .from("security_findings")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");
  if (error) return 0;
  return count ?? 0;
}

export async function setFindingStatus(id: string, status: FindingStatus, by: string) {
  if (!hasCentralAuthSession()) throw new Error("A verified administrator session is required.");
  const client = await authenticatedExternalClientSnapshot();
  if (!client) throw new Error("The administrator session is still being restored.");
  const { error } = await client.rpc("security_set_finding_status", {
    _id: id,
    _status: status,
    _by: by,
  });
  if (error) throw new Error(error.message);
}

/** Run the database posture audit immediately (admins only). */
export async function runSecuritySelfCheck(): Promise<{ new: number; resolved: number }> {
  if (!hasCentralAuthSession()) throw new Error("A verified administrator session is required.");
  const client = await authenticatedExternalClientSnapshot();
  if (!client) throw new Error("The administrator session is still being restored.");
  const { data, error } = await client.rpc("security_selfcheck");
  if (error) throw new Error(error.message);
  const out = (data ?? {}) as Record<string, number>;
  return { new: Number(out["new"] ?? 0), resolved: Number(out["resolved"] ?? 0) };
}

/**
 * Live view of the posture: re-runs the diagnostic first, so anything that no
 * longer holds is closed automatically and only active issues come back.
 */
export async function assessSecurityFindings(
  includeResolved = false,
): Promise<{ findings: SecurityFinding[]; checkedAt: string; retested: boolean }> {
  let retested = true;
  try {
    await runSecuritySelfCheck();
  } catch {
    retested = false;
  }
  return {
    findings: await listSecurityFindings(includeResolved),
    checkedAt: new Date().toISOString(),
    retested,
  };
}
