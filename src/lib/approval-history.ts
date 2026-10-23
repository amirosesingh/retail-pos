import { auditDetails } from "./audit-row-normalization";
export function approvalHistorySummary(row: Record<string, unknown>) {
  const detail = auditDetails(row.detail);
  const context = auditDetails(detail.context);
  const name = String(detail.approved_by_name || row.authorized_by || "Unknown approver");
  const method =
    detail.credential_method === "totp"
      ? "soft token"
      : row.mode_used === "request"
        ? "approval request"
        : row.mode_used === "admin_auto"
          ? "administrator authority"
          : "approval PIN";
  return {
    name,
    method,
    reference: String(
      detail.ticket_reference ||
        detail.bill_no ||
        detail.reference ||
        context.bill_no ||
        context.transaction ||
        "—",
    ),
    label: `Approved by ${name} using ${method}`,
    offline: detail.offline === true || row.mode_used === "offline_pin",
  };
}
