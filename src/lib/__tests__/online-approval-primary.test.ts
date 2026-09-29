/**
 * Approval requests and decisions are cloud-first online, then mirrored to
 * SQL Server without making the user wait. Offline retries keep one UUID.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { handleAuthorizationRequest } from "@/lib/authorization-endpoint.server";

const source = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("online approval primary database", () => {
  it("reuses one request UUID across the cloud attempt and offline fallback", () => {
    const dialog = source("src/platforms/web/components/pos/AuthorizationDialog.tsx");
    const server = source("src/lib/authorization.server.ts");

    expect(dialog).toContain("const requestId = newId()");
    expect(dialog).toContain("requestId,");
    expect(dialog).toContain("parkRequest(requestId");
    expect(server).toContain("authorization_requests?on_conflict=id");
    expect(server).toContain("resolution=ignore-duplicates");
    expect(source("src/lib/authorization.functions.ts")).toContain("if (created.created)");
  });

  it("keeps the complete request locally only as an offline fallback", () => {
    const dialog = source("src/platforms/web/components/pos/AuthorizationDialog.tsx");

    for (const field of [
      "requested_amount",
      "requester_direct_limit",
      "bill_snapshot",
      "snapshot_hash",
      "held_order_id",
      "updated_at",
    ]) {
      expect(dialog).toContain(field);
    }
    expect(dialog).toContain("void syncNow(`approval-request:");
  });

  it("enforces the configured method and binds the request to the parked ticket", () => {
    const fn = source("src/lib/authorization.functions.ts");
    const gate = source("src/lib/manager-gate.tsx");
    const register = source("src/routes/index.tsx");
    const held = source("src/lib/register/use-held-orders.ts");

    expect(fn).toContain('rule.mode !== "pin" && rule.mode !== "either"');
    expect(fn).toContain("rule.approvalTimeoutMinutes / 60");
    expect(gate).not.toContain("authorizeAsAdmin");
    expect(gate).toContain(
      "Every person, including an administrator, follows the configured method",
    );
    expect(register).toContain("...(heldOrderId ? { heldOrderId } : {})");
    expect(register).toContain("snapshotFingerprint(snapshot)");
    expect(register).toContain("authorizationRules[action]?.mode");
    expect(register).toContain("requirePermission: requireCartPermission");
    expect(held).toContain("order.approvalSnapshotHash ?? undefined");
  });

  it("refreshes approval screens through Realtime and mirrors decisions in the background", () => {
    const route = source("src/routes/approvals.tsx");
    const engine = source("src/lib/sync-engine.ts");
    const centre = source("src/lib/approval-centre.ts");

    expect(route).toContain("subscribeApprovals(() => void load())");
    expect(route).toContain("void syncNow(`approval-decision:");
    expect(engine).toMatch(/LIVE_TABLES[\s\S]*"authorization_requests"/);
    expect(centre).toContain("++approvalChannelSequence");
  });

  it("never lets an offline replay replace a cloud request or duplicate its audit row", () => {
    const generator = source("scripts/generate-supabase-sync-contract.cjs");
    const migration = source(
      "supabase/migrations/20260928074557_online_approval_cloud_primary.sql",
    );

    expect(generator).toContain('"authorization_requests", "authorization_log"');
    expect(migration.match(/ON CONFLICT \(id\) DO NOTHING/g)).toHaveLength(2);
  });

  it("does not couple approval submission or decisions to printing", () => {
    const approvalSources = [
      source("src/platforms/web/components/pos/AuthorizationDialog.tsx"),
      source("src/routes/approvals.tsx"),
      source("src/lib/authorization.functions.ts"),
    ].join("\n");

    expect(approvalSources).not.toMatch(/printSaleReceipt|window\.print|receiptPrinter/);
  });

  it("covers price override, completed-sale refund and stock-transfer rules", () => {
    const register = source("src/routes/index.tsx");
    const receipts = source("src/routes/receipts.tsx");
    const shifts = source("src/routes/shifts.tsx");
    const transfers = source("src/routes/transfers.new.tsx");

    expect(register).toContain('action: "price_override"');
    expect(register).toContain("priceOverridden: true");
    expect(receipts).toContain('action: "refund"');
    expect(shifts).toContain('action: "refund"');
    expect(transfers).toContain("authorizationRules.stock_transfer?.mode");
    expect(transfers).toContain('action: "stock_transfer"');
  });

  it("shows only action keys that are wired to real POS mutations", () => {
    const settings = source(
      "src/platforms/web/components/pos/settings/AuthorizationRulesPanel.tsx",
    );
    for (const action of [
      "refund",
      "void_cart",
      "void_line",
      "reduce_qty",
      "discount_over_limit",
      "price_override",
      "shift_close",
      "stock_transfer",
    ]) {
      expect(settings).toContain(`"${action}"`);
    }
    expect(settings).not.toContain('"reduce_line_qty"');
  });

  it("persists and audits expired requests and supports configured escalation", () => {
    const server = source("src/lib/authorization.server.ts");
    const fn = source("src/lib/authorization.functions.ts");
    const settings = source(
      "src/platforms/web/components/pos/settings/AuthorizationRulesPanel.tsx",
    );

    expect(server).toContain("expirePendingRequests");
    expect(server).toContain('status: "expired"');
    expect(fn).toContain('outcome: "expired"');
    expect(fn).toContain('event_type: "approval_expired"');
    expect(settings).toContain("approvalTimeoutMinutes");
    expect(settings).toContain("escalationAfterMinutes");
    expect(settings).toContain("escalationRoles");
  });

  it("snapshots named approver routing and permits only explicit cross-branch access", () => {
    const fn = source("src/lib/authorization.functions.ts");
    const server = source("src/lib/authorization.server.ts");
    const panel = source("src/platforms/web/components/pos/settings/AuthorizationRulesPanel.tsx");
    const approvals = source("src/routes/approvals.tsx");

    expect(server).toContain("approval_route: input.approvalRoute");
    expect(fn).toContain("primaryApprovers");
    expect(fn).toContain("approval_route: request.approvalRoute");
    expect(fn).toContain("explicitCrossBranch");
    expect(fn).toContain('error: "This request was not routed to you"');
    expect(panel).toContain("PeopleMultiSelect");
    expect(panel).toContain("Search by name, staff ID, role or branch");
    expect(approvals).toContain("Routed approvers");
  });

  it("keeps authorization categories compact and moves detailed settings into one dialog", () => {
    const panel = source("src/platforms/web/components/pos/settings/AuthorizationRulesPanel.tsx");

    expect(panel).toContain("<SettingsSections");
    expect(panel).toContain("<RuleConfigurationDialog");
    expect(panel).toContain("Status / configuration summary");
    expect(panel).toContain("SELECTABLE_AUTH_MODES");
    expect(panel).toContain('mode.value !== "either"');
    expect(panel).toContain("Complete the highlighted settings before saving");
    expect(panel).toContain("Approval Request settings will become inactive, not deleted");
    expect(panel).toContain('placeholder="Search by name, staff ID, role or branch"');
  });

  it("uses the transactional saved-rules snapshot without a fragile second read", () => {
    const server = source("src/lib/pos-rules.server.ts");
    const provider = source("src/lib/pos-rules.tsx");
    const settings = source("src/routes/settings.rules.tsx");
    const migration = source(
      "supabase/migrations/20260929001126_approval_route_audit_snapshot.sql",
    );

    const save = server.slice(server.indexOf("export async function saveRules"));
    expect(save).toContain("RulesSnapshotRow");
    expect(save).not.toContain("loadRulesResult(storeId)");
    expect(provider).toContain("fetchRulesResilient");
    expect(provider).toContain("confirmSaved");
    expect(settings).toContain("await confirmSaved(res.snapshot)");
    expect(settings).not.toContain("void refresh()");
    expect(migration).toContain("RETURN public.pos_rules_snapshot(sid)");
    expect(migration).toContain("has_perm('can_access_pos_settings')");
  });

  it("routes packaged-terminal approvals to the hosted backend", () => {
    const client = source("src/lib/authorization-client.ts");
    const panel = source("src/platforms/web/components/pos/settings/AuthorizationRulesPanel.tsx");
    const gate = source("src/lib/manager-gate.tsx");
    const electron = source("electron/main.cjs");
    const route = source("src/routes/api/v1/pos/authorization.ts");
    const syncRoute = source("src/routes/api/v1/pos/sync.ts");
    const endpoint = source("src/lib/authorization-endpoint.server.ts");
    expect(client).toContain('posFetch("/api/v1/pos/sync?operation=authorization"');
    expect(client).toContain("if (!isTerminalApp())");
    expect(syncRoute).toContain('searchParams.get("operation") === "authorization"');
    for (const action of [
      "authorize_pin",
      "submit",
      "list",
      "decide",
      "claim",
      "cancel",
      "rules",
      "people",
      "save_rule",
      "set_pin",
      "verify_mutation",
    ]) {
      expect(endpoint).toContain(`"${action}"`);
    }
    expect(client).toContain("getAuthorizationRulesFn");
    expect(client).toContain("saveAuthorizationRuleFn");
    expect(client).toContain("listAuthorizationPeopleFn");
    expect(client).toContain("verifyBusinessAuthorizationFn");
    expect(client).toContain("setStaffAuthorizationPinFn");
    expect(panel).toContain('from "@/lib/authorization-client"');
    expect(gate).toContain('from "@/lib/authorization-client"');
    expect(electron).toContain("const cloud = cloudCredentials.read()");
    expect(electron).toContain("SUPABASE_URL: cloud.url");
    expect(electron).toContain("SUPABASE_ANON_KEY: cloud.key");
    expect(electron).toContain("scheduleCloudServerRestart()");
    expect(endpoint).toContain("512 * 1024");
    expect(route).toContain("handleAuthorizationRequest(request)");
  });

  it("does not remount the workspace for repeated events from the same cloud session", () => {
    const auth = source("src/lib/pos-auth.tsx");
    expect(auth).toContain("nextIdentity === centralIdentityRef.current");
    expect(auth).toContain('event === "TOKEN_REFRESHED" || event === "SIGNED_IN"');
    const continuing = auth.slice(
      auth.indexOf("if (continuingSession)"),
      auth.indexOf("// A refreshed token"),
    );
    expect(continuing).toContain("setSession(next)");
    expect(continuing).not.toContain("setRolesReady(false)");
    expect(continuing).not.toContain("setProfileReady(false)");
  });

  it("rejects malformed hosted approval payloads without dispatching them", async () => {
    const response = await handleAuthorizationRequest(
      new Request("https://pos.example/api/v1/pos/sync?operation=authorization", {
        method: "POST",
        body: "not-json",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });

  it("rejects oversized hosted approval payloads", async () => {
    const response = await handleAuthorizationRequest(
      new Request("https://pos.example/api/v1/pos/sync?operation=authorization", {
        method: "POST",
        body: "x".repeat(512 * 1024 + 1),
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Approval request is too large",
    });
  });
});
