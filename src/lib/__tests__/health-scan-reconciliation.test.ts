import { describe, expect, it } from "vitest";
import { reconcileHealthScan } from "../reconcile-health-scan";
import type { ScanResult } from "../health-scan";

const clean = (): ScanResult => ({ at: "2026-10-22", findings: [], counts: { critical: 0, warning: 0, info: 0 }, notes: [],
  db: {} as NonNullable<ScanResult["db"]>, relations: {} as NonNullable<ScanResult["relations"]>, schema: {} as NonNullable<ScanResult["schema"]> });
const failed = (): ScanResult => ({ ...clean(), findings: [{ id: "read", area: "readwrite", severity: "critical", title: "Cannot read", detail: "Denied", where: "products", fix: "Review access" }], counts: { critical: 1, warning: 0, info: 0 } });
describe("health scan replacement", () => {
  it("removes resolved findings after successful checks", () => {
    expect(reconcileHealthScan(failed(), clean()).findings).toEqual([]);
  });
  it("shows newly detected findings", () => {
    expect(reconcileHealthScan(clean(), failed()).counts.critical).toBe(1);
  });
  it("retains unverified findings if the next check cannot run", () => {
    const result = reconcileHealthScan(failed(), { ...clean(), db: null, notes: ["Offline"] });
    expect(result.findings).toHaveLength(1);
    expect(result.counts.critical).toBe(1);
    expect(result.notes.join(" ")).toContain("unverified");
  });
  it("does not duplicate findings across repeated failures", () => {
    const next = { ...failed(), db: null };
    expect(reconcileHealthScan(failed(), next).findings).toHaveLength(1);
  });
});
