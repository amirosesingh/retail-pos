type AuditDisplayRow = {
  action_type?: string | null;
  entity_affected?: string | null;
  entity_id?: string | null;
  actor_name?: string | null;
  actor_id?: string | null;
  note?: string | null;
  new_value?: string | null;
};

function objectValue(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** Human-readable fields shared by the table, search and CSV export. */
export function auditReportFields(row: AuditDisplayRow) {
  const detail = objectValue(row.new_value);
  if (row.action_type === "CLIENT_REPORT_UNVERIFIED") {
    const report = detail.unverified_report;
    const claims = report && typeof report === "object" && !Array.isArray(report)
      ? report as Record<string, unknown>
      : {};
    return {
      requestedBy: "",
      approvedBy: `${row.actor_name || row.actor_id || "Unknown"} (reporter)`,
      purpose: text(claims.note) || row.note || "Client-reported event",
      action: `Client report: ${text(claims.actionType) || "Unknown action"}`,
      outcome: "Unverified",
      reference: text(claims.entityId) || text(claims.entityAffected) || "—",
    };
  }
  return {
    requestedBy: text(detail.requested_by_name) || text(detail.requested_by),
    approvedBy:
      text(detail.approved_by_name) ||
      row.actor_name ||
      row.actor_id ||
      "Unknown",
    purpose:
      text(detail.purpose) ||
      text(detail.reason) ||
      row.note ||
      "—",
    action: text(detail.action_key) || text(detail.rule_key) || row.action_type || "Recorded action",
    outcome: text(detail.outcome),
    reference:
      text(detail.request_id) || row.entity_id || row.entity_affected || "—",
  };
}
