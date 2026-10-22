import type { ScanArea, ScanResult } from "./health-scan";

/** A failed check cannot prove an earlier finding was resolved. */
export function reconcileHealthScan(previous: ScanResult | null, next: ScanResult): ScanResult {
  if (!previous) return next;
  const unverified = new Set<ScanArea>();
  if (!next.db) unverified.add("readwrite");
  if (!next.relations || next.relations.error) unverified.add("relations");
  if (!next.schema || next.schema.error) unverified.add("schema");
  const ids = new Set(next.findings.map(finding => finding.id));
  const retained = previous.findings.filter(finding => unverified.has(finding.area) && !ids.has(finding.id));
  const findings = [...next.findings, ...retained];
  const counts = { critical: 0, warning: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return { ...next, findings, counts, notes: retained.length
    ? [...next.notes, "Earlier findings from checks that failed to run remain unverified until a successful scan."]
    : next.notes };
}
