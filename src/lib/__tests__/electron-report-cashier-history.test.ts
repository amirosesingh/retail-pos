import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { auditReportFields } from "../audit-report-format";
import { receiptSequence, safeCreatedAt, safeReceiptNo } from "../report-data-safety";
import { verifiedPinLinkProof } from "../verified-pin-proof";

const read = (path: string) => readFileSync(path, "utf8");

describe("cashier secure-session handoff", () => {
  it("exchanges the one-use PIN proof with the current email verification type", () => {
    const auth = read("src/lib/pos-auth.tsx");
    const exchangeStart = auth.indexOf("if (verified?.authTokenHash)");
    const proofExchange = auth.slice(
      exchangeStart,
      auth.indexOf("bumpSessionEpoch()", exchangeStart),
    );

    expect(proofExchange).toContain('type: "email"');
    expect(proofExchange).not.toContain('type: "magiclink"');
  });

  it("keeps Electron's signed relay session when the optional direct Auth exchange fails", () => {
    const auth = read("src/lib/pos-auth.tsx");
    const sessionStart = auth.indexOf("let desktopRelaySessionReady = false");
    const sessionEnd = auth.indexOf("bumpSessionEpoch()", sessionStart);
    const handoff = auth.slice(sessionStart, sessionEnd);

    expect(handoff).toContain("desktopRelaySessionReady = Boolean(window.pos?.cashierLogin)");
    expect(handoff).toContain("if (!desktopRelaySessionReady)");
    expect(handoff.indexOf("recordDiagnostic({")).toBeLessThan(
      handoff.indexOf("if (!desktopRelaySessionReady)"),
    );
    expect(handoff.indexOf("clearStoredCredentials()")).toBeGreaterThan(
      handoff.indexOf("if (!desktopRelaySessionReady)"),
    );
  });

  it("accepts the raw GoTrue REST response and the transformed SDK response", () => {
    expect(verifiedPinLinkProof({ id: "auth-1", hashed_token: " raw-proof " }, "auth-1"))
      .toBe("raw-proof");
    expect(
      verifiedPinLinkProof(
        { user: { id: "auth-1" }, properties: { hashed_token: "sdk-proof" } },
        "auth-1",
      ),
    ).toBe("sdk-proof");
  });

  it("rejects a mismatched identity or an empty one-use proof", () => {
    expect(() => verifiedPinLinkProof({ id: "other", hashed_token: "proof" }, "auth-1"))
      .toThrow(/does not match/);
    expect(() => verifiedPinLinkProof({ id: "auth-1" }, "auth-1"))
      .toThrow(/could not be prepared/);
  });

  it("counts only wrong credentials as a failed PIN attempt", () => {
    const route = read("src/routes/api/public/cashier-login.ts");
    expect(route).toContain('result.code === "invalid_credentials"');
    expect(route).toContain('result.code === "session_prepare_failed"');
    expect(route).toContain("? 503");
  });
});

describe("legacy report data", () => {
  it("normalizes incomplete SQL rows without throwing", () => {
    expect(safeReceiptNo(undefined, "sale-1")).toBe("sale-1");
    expect(safeReceiptNo(undefined, undefined)).toBe("Unnumbered");
    expect(receiptSequence(undefined)).toBe(0);
    expect(receiptSequence("BILL-0042")).toBe(42);
    expect(safeCreatedAt(undefined)).toBe("1970-01-01T00:00:00.000Z");
  });

  it("loads bounded audit histories from SQL Server in terminal builds", () => {
    const activity = read("src/lib/audit-log.ts");
    const editHistory = read("src/lib/system-audit-client.ts");
    expect(activity).toContain("db.queryAuditLogs(2000)");
    expect(editHistory).toContain('routedQuery("system_audit_logs"');
    expect(editHistory).toContain('source: "local"');
  });

  it("pages database history for every sales-based report instead of stopping at the boot cache", () => {
    const reports = ["sales", "items", "payments", "business", "analytics", "coupons"];
    for (const report of reports) {
      expect(read(`src/routes/reports.${report}.tsx`), report).toContain("useReportSales(");
    }
    const loader = read("src/lib/use-report-sales.ts");
    expect(loader).toContain("loadSalesPage(storeId, cursor, 500)");
    expect(loader).toContain("Date.parse(oldest.createdAt) < start");
  });

  it("keeps every report route registered in the Reports navigation", () => {
    const nav = read("src/platforms/web/components/pos/nav-config.ts");
    for (const route of [
      "sales", "items", "stock", "payments", "voids", "history", "activity",
      "business", "catalog", "analytics", "notifications", "coupons",
    ]) {
      expect(nav, route).toContain(`to: "/reports/${route}"`);
    }
    expect(nav).toContain('to: "/alerts"');
  });
});

describe("approval report attribution", () => {
  it("shows who requested, who approved and the purpose", () => {
    expect(
      auditReportFields({
        action_type: "authorization.override.approved",
        actor_name: "Manager Mia",
        entity_id: "log-1",
        new_value: JSON.stringify({
          requested_by_name: "Cashier Kim",
          approved_by_name: "Manager Mia",
          purpose: "Price match for damaged packaging",
          rule_key: "sale.price_override",
          outcome: "approved",
          request_id: "request-1",
        }),
      }),
    ).toEqual({
      requestedBy: "Cashier Kim",
      approvedBy: "Manager Mia",
      purpose: "Price match for damaged packaging",
      action: "sale.price_override",
      outcome: "approved",
      reference: "request-1",
    });
  });

  it("uses the transactional RPC rather than a partial table insert", () => {
    const server = read("src/lib/authorization.server.ts");
    expect(server).toContain('rest("rpc/log_manager_override"');
    expect(server).not.toContain('rest("authorization_log"');
    expect(server).toContain("requested_by_name");
    expect(server).toContain("approved_by_name");
    expect(server).toContain("purpose:");
  });
});
