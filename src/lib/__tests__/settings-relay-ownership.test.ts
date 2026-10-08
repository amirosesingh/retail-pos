import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rest: vi.fn() }));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: mocks.rest }));
import { authorizeSettingsMutation, type RelayScope } from "@/core/api/relay-policy.server";
const staff: RelayScope = { kind: "cashier", label: "person", role: "staff", roleSlug: "cashier", storeId: "branch-a", staffUserId: "person", isSupervisor: false, permissions: { can_access_pos_settings: true } };
const operation = { kind: "upsert" as const, table: "settings_overrides", rows: [{ scope: "BRANCH", scope_id: "branch-a", section: "tax", patch: { tax: { rate: 5 } } }] };
beforeEach(() => mocks.rest.mockReset().mockResolvedValue(new Response("[]", { status: 200 })));
describe("relay settings ownership", () => {
  it("allows an unlocked own-branch override", async () => {
    expect((await authorizeSettingsMutation(operation, staff)).ok).toBe(true);
  });
  it.each(["GLOBAL", "CLUSTER", "TERMINAL"])("refuses staff %s settings even with access permission", async (scope) => {
    expect((await authorizeSettingsMutation({ ...operation, rows: [{ ...operation.rows[0], scope }] }, staff)).ok).toBe(false);
    expect(mocks.rest).not.toHaveBeenCalled();
  });
  it("does not treat a supervisor as a settings administrator", async () => {
    expect((await authorizeSettingsMutation({ ...operation, rows: [{ ...operation.rows[0], scope: "CLUSTER" }] }, { ...staff, role: "manager", roleSlug: "supervisor", isSupervisor: true })).ok).toBe(false);
  });
  it("fails closed when a lock cannot be verified", async () => {
    mocks.rest.mockResolvedValue(new Response("unavailable", { status: 503 }));
    expect((await authorizeSettingsMutation(operation, staff)).ok).toBe(false);
  });
  it("enforces locked sections on cloud writes", async () => {
    mocks.rest.mockResolvedValue(new Response('[{"locked":true}]', { status: 200 }));
    expect((await authorizeSettingsMutation(operation, staff)).ok).toBe(false);
  });
  it("allows admins to write cluster values and global locks", async () => {
    const admin = { ...staff, role: "admin", roleSlug: "admin", isSupervisor: true };
    expect((await authorizeSettingsMutation({ ...operation, rows: [{ ...operation.rows[0], scope: "CLUSTER", scope_id: "cluster-a" }] }, admin)).ok).toBe(true);
    expect((await authorizeSettingsMutation({ kind: "upsert", table: "settings_locks", rows: [{ section: "tax", locked: true }] }, admin)).ok).toBe(true);
  });
  it("refuses stale and device-only identities", async () => {
    expect((await authorizeSettingsMutation(operation, { ...staff, stale: true })).ok).toBe(false);
    expect((await authorizeSettingsMutation(operation, { ...staff, kind: "terminal" })).ok).toBe(false);
  });
});
