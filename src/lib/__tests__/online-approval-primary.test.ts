/**
 * Approval requests and decisions are cloud-first online, then mirrored to
 * SQL Server without making the user wait. Offline retries keep one UUID.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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

  it("routes packaged-terminal approvals to the hosted backend", () => {
    const client = source("src/lib/authorization-client.ts");
    const route = source("src/routes/api/v1/pos/authorization.ts");
    expect(client).toContain('posFetch("/api/v1/pos/authorization"');
    expect(client).toContain("if (!isTerminalApp())");
    expect(route).toContain('z.enum(["authorize_pin", "submit", "list", "decide", "claim", "cancel"])');
    expect(route).toContain("512 * 1024");
  });
});
