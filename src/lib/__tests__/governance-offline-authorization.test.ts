import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GovernanceTable } from "../governance-offline";

const mocks = vi.hoisted(() => ({ native: true, commit: vi.fn() }));
vi.mock("@/core/local-db/local-db", () => ({ localDb: () => mocks.native ? {} : null }));
vi.mock("@/core/api/pos-db", () => ({ commitOps: mocks.commit }));
const require = createRequire(import.meta.url);
const { OperationsRepository } = require("../../../electron/db/repositories/operations.cjs");
const repository = new OperationsRepository({});
const id = "00000000-0000-4000-8000-000000000001";
const branch = "00000000-0000-4000-8000-000000000002";
const author = "00000000-0000-4000-8000-000000000003";
const created = "2026-11-05T12:00:00.000Z";

describe("offline authorization audit persistence", () => {
  beforeEach(() => {
    mocks.native = true;
    mocks.commit.mockReset().mockImplementation(async (_label, operations) => {
      repository.validate(operations);
      return { ok: true };
    });
  });

  it.each(["authorization_log", "authorization_requests"] as const)(
    "writes %s through the existing native column validator without invented sync columns", async table => {
      const { parkGovernanceRow } = await import("../governance-offline");
      const row = { id, created_at: created, action_key: "discount_over_limit", store_id: branch, requested_by: author };
      expect(await parkGovernanceRow(table, row)).toEqual({ parked: true });
      const [operation] = mocks.commit.mock.calls[0][1];
      expect(operation).toEqual({ kind: "upsert", table, rows: [row], onConflict: "id" });
      expect(row).not.toHaveProperty("is_synced");
      expect(row).not.toHaveProperty("sync_status");
    },
  );

  it("preserves the verified approver, outcome and exact saved audit details", async () => {
    const { parkGovernanceRow } = await import("../governance-offline");
    const row = { id, created_at: created, action_key: "discount_over_limit", mode_used: "offline_pin",
      requested_by: author, authorized_by: author, authorizer_role: "manager", store_id: branch,
      terminal_id: "TEST-TILL", outcome: "approved", detail: { percent: 20, note: "Manager approved" } };
    expect(await parkGovernanceRow("authorization_log", row)).toEqual({ parked: true });
    expect(mocks.commit.mock.calls[0][1][0].rows).toEqual([row]);
  });

  it.each(["unexpected_column", "is_synced", "sync_status"])(
    "does not silently strip caller-supplied unsupported %s", async field => {
      const { parkGovernanceRow } = await import("../governance-offline");
      const row = { id, created_at: created, action_key: "discount_over_limit", [field]: "caller supplied" };
      expect(await parkGovernanceRow("authorization_log", row)).toEqual({
        parked: false, reason: "Unsupported column for authorization_log.",
      });
      expect(mocks.commit.mock.calls[0][1][0].rows[0][field]).toBe("caller supplied");
    },
  );

  it.each(["activity_events", "record_edits", "member_verifications", "entity_status_history"] as GovernanceTable[])(
    "leaves the existing %s payload behavior unchanged", async table => {
      mocks.commit.mockResolvedValueOnce({ ok: true });
      const { parkGovernanceRow } = await import("../governance-offline");
      const row = { id, created_at: created, note: "Preserve existing caller" };
      expect(await parkGovernanceRow(table, row)).toEqual({ parked: true });
      expect(mocks.commit.mock.calls[0][1][0].rows).toEqual([{ ...row, is_synced: 0, sync_status: "pending" }]);
    },
  );

  it("does not claim an approval persisted when the native transaction fails", async () => {
    mocks.commit.mockRejectedValueOnce(new Error("Fixture transaction rolled back"));
    const { parkGovernanceRow } = await import("../governance-offline");
    expect(await parkGovernanceRow("authorization_log", { id })).toEqual({ parked: false, reason: "Fixture transaction rolled back" });
  });

  it("does not submit local writes on a device without a native database", async () => {
    mocks.native = false;
    const { parkGovernanceRow } = await import("../governance-offline");
    expect(await parkGovernanceRow("authorization_log", { id })).toEqual({ parked: false, reason: "No local database on this device" });
    expect(mocks.commit).not.toHaveBeenCalled();
  });
});
