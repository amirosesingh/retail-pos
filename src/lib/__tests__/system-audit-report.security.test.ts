import { beforeEach, describe, expect, it, vi } from "vitest";

const { serviceRest, verifyRelayCaller, resolveRelayScope } = vi.hoisted(() => ({
  serviceRest: vi.fn(),
  verifyRelayCaller: vi.fn(),
  resolveRelayScope: vi.fn(),
}));

// Exercise the server handler and its validator without the transport compiler.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    validator: (parse: (input: unknown) => unknown) => ({
      handler: (handle: (input: { data: unknown }) => unknown) =>
        (input: { data: unknown }) => handle({ data: parse(input.data) }),
    }),
  }),
}));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest, verifyRelayCaller }));
vi.mock("@/core/api/relay-policy.server", () => ({ resolveRelayScope }));

import { recordSystemAudit } from "../system-audit.functions";
import { handleSystemAuditRequest } from "../system-audit-endpoint.server";
import { writeSystemAudit } from "../system-audit.server";
import { auditReportFields } from "../audit-report-format";

const report = {
  actionType: "staff.account_deleted",
  entityAffected: "app_users",
  entityId: "victim",
  actorId: "forged-admin",
  actorName: "Forged Admin",
  actorRole: "admin",
  storeId: "other-store",
  terminalId: "other-terminal",
  oldValue: { active: true },
  newValue: {
    active: false,
    action_key: "authorization.override.approved",
    approved_by_name: "Forged Approver",
    outcome: "approved",
  },
  note: "Claimed deletion",
  accessToken: "test-access-token",
  sessionToken: "test-session-token",
  cashierToken: "test-cashier-token",
  terminalToken: "test-terminal-token",
};

beforeEach(() => {
  vi.resetAllMocks();
  serviceRest.mockResolvedValue(new Response(null, { status: 201 }));
  verifyRelayCaller.mockResolvedValue({ kind: "staff", label: "reporter" });
  resolveRelayScope.mockResolvedValue({
    staffUserId: "reporter-id",
    actorName: "Reporter",
    role: "staff",
    roleSlug: "cashier",
    storeId: "own-store",
    isSupervisor: false,
  });
});

function storedRow() {
  expect(serviceRest).toHaveBeenCalledTimes(1);
  const [table, request] = serviceRest.mock.calls[0];
  expect(table).toBe("system_audit_logs");
  expect(request.method).toBe("POST");
  return JSON.parse(request.body);
}

describe("client audit report trust boundary", () => {
  it.each([false, true])("stores only unverified claims (supervisor: %s)", async (isSupervisor) => {
    resolveRelayScope.mockResolvedValue({
      staffUserId: "reporter-id", actorName: "Reporter", role: "staff",
      roleSlug: "cashier", storeId: "own-store", isSupervisor,
    });
    await expect(recordSystemAudit({ data: report })).resolves.toEqual({ ok: true });
    expect(verifyRelayCaller).toHaveBeenCalledWith({
      accessToken: report.accessToken, sessionToken: report.sessionToken,
      cashierToken: report.cashierToken, terminalToken: report.terminalToken,
    });
    const row = storedRow();
    expect(row).toMatchObject({
      actor_id: "reporter-id", actor_name: "Reporter", actor_role: "cashier",
      action_type: "CLIENT_REPORT_UNVERIFIED", store_id: "own-store",
      entity_affected: null, entity_id: null, old_value: null, terminal_id: null,
      new_value: { unverified_report: {
        actionType: report.actionType, entityAffected: report.entityAffected,
        entityId: report.entityId, oldValue: report.oldValue, newValue: report.newValue,
        terminalId: report.terminalId, storeId: report.storeId, note: report.note,
      } },
    });
    for (const secret of [report.accessToken, report.sessionToken, report.cashierToken, report.terminalToken]) {
      expect(JSON.stringify(row)).not.toContain(secret);
    }
    expect(JSON.stringify(row)).not.toContain("Forged Admin");
    expect(auditReportFields({ ...row, new_value: JSON.stringify(row.new_value) })).toEqual({
      requestedBy: "", approvedBy: "Reporter (reporter)",
      action: "Client report: staff.account_deleted", outcome: "Unverified",
      purpose: "Claimed deletion", reference: "victim",
    });
  });

  it("applies the same envelope through the hosted terminal endpoint", async () => {
    const response = await handleSystemAuditRequest(new Request("https://pos.example/api/v1/pos/sync?operation=system_audit", {
      method: "POST", body: JSON.stringify({ action: "record", data: report }),
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(storedRow().action_type).toBe("CLIENT_REPORT_UNVERIFIED");
  });

  it.each(["identity", "scope"])("rejects failed %s verification without inserting", async (failure) => {
    (failure === "identity" ? verifyRelayCaller : resolveRelayScope).mockRejectedValue(new Error("Invalid proof"));
    await expect(recordSystemAudit({ data: report })).resolves.toEqual({ ok: false, error: "Not signed in" });
    expect(serviceRest).not.toHaveBeenCalled();
  });

  it("preserves authoritative entries from server operations", async () => {
    await writeSystemAudit({
      actorId: "server-actor", actionType: "staff.account_updated",
      entityAffected: "app_users", entityId: "staff-id",
      oldValue: { active: false }, newValue: { active: true },
    });
    expect(storedRow()).toMatchObject({
      actor_id: "server-actor", action_type: "staff.account_updated",
      entity_affected: "app_users", entity_id: "staff-id",
      old_value: { active: false }, new_value: { active: true },
    });
  });

  it("keeps malformed client report payloads visibly unverified", () => {
    expect(auditReportFields({
      action_type: "CLIENT_REPORT_UNVERIFIED",
      new_value: JSON.stringify({ action_key: "forged", approved_by_name: "Admin", outcome: "approved" }),
    })).toMatchObject({ action: "Client report: Unknown action", outcome: "Unverified", approvedBy: "Unknown (reporter)" });
  });
});
