import { beforeEach, describe, expect, it, vi } from "vitest";
const { rest, verify } = vi.hoisted(() => ({ rest: vi.fn(), verify: vi.fn() }));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: rest, verifyRelayCaller: verify }));
import { readSessionPermissionsServer } from "../session-permissions.server";
import { resolveRelayScope } from "@/core/api/relay-policy.server";
import { createPermissionRefresh } from "../permission-refresh";

const row = { user_id: "cashier-a", full_name: "Cashier", email: "cashier@example.invalid", role: "staff", role_slug: "cashier", store_id: "branch-a", is_active: true, permissions: { can_process_sale: true, "page:inventory": false } };
beforeEach(() => {
  vi.resetAllMocks();
  verify.mockResolvedValue({ kind: "cashier", staffUserId: row.user_id, storeId: "BRANCH-A" });
  rest.mockImplementation(async () => ({ ok: true, json: async () => [{ ...row, permissions: { ...row.permissions } }] }));
});

describe("live permission authority", () => {
  it("reads only the verified person and returns explicit denials", async () => {
    expect(await readSessionPermissionsServer({ cashierToken: "proof" })).toEqual({ status: "ok", profile: row });
    expect(rest.mock.calls[0][0]).toContain("user_id=eq.cashier-a");
  });
  it("uses the verified Auth subject rather than another staff identifier", async () => {
    verify.mockResolvedValue({ kind: "staff", authUserId: "auth-a", staffUserId: "other-user" });
    await readSessionPermissionsServer({ accessToken: "proof" });
    expect(rest.mock.calls[0][0]).toContain("auth_user_id=eq.auth-a");
    expect(rest.mock.calls[0][0]).not.toContain("other-user");
  });
  it("does not let a machine-only token refresh a person's permissions", async () => {
    verify.mockResolvedValue({ kind: "terminal", staffUserId: row.user_id });
    expect(await readSessionPermissionsServer({ terminalToken: "proof" })).toEqual({ status: "unavailable" });
    expect(rest).not.toHaveBeenCalled();
  });
  it("ends a deactivated or reassigned session without substituting another branch", async () => {
    rest.mockResolvedValueOnce({ ok: true, json: async () => [{ ...row, is_active: false }] });
    expect(await readSessionPermissionsServer({ cashierToken: "proof" })).toEqual({ status: "revoked" });
    rest.mockResolvedValueOnce({ ok: true, json: async () => [{ ...row, store_id: "branch-b" }] });
    expect(await readSessionPermissionsServer({ cashierToken: "proof" })).toEqual({ status: "branch_changed" });
  });
  it("keeps an offline or unprovisioned session on an unavailable read", async () => {
    rest.mockRejectedValueOnce(new Error("offline"));
    expect(await readSessionPermissionsServer({ cashierToken: "proof" })).toEqual({ status: "unavailable" });
    rest.mockResolvedValueOnce({ ok: true, json: async () => [] });
    expect(await readSessionPermissionsServer({ cashierToken: "proof" })).toEqual({ status: "unavailable" });
  });
  it("rechecks a revoked grant on the next protected request without a timed cache", async () => {
    const caller = { kind: "cashier" as const, label: "cashier-a", staffUserId: row.user_id, storeId: "branch-a" };
    expect((await resolveRelayScope(caller)).permissions.can_process_sale).toBe(true);
    rest.mockResolvedValueOnce({ ok: true, json: async () => [{ ...row, permissions: { can_process_sale: false } }] });
    expect((await resolveRelayScope(caller)).permissions.can_process_sale).toBe(false);
  });
  it("still shares simultaneous authority lookups for the same user", async () => {
    let complete!: (response: unknown) => void;
    rest.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const caller = { kind: "cashier" as const, label: "cashier-a", staffUserId: row.user_id, storeId: "branch-a" };
    const first = resolveRelayScope(caller);
    const second = resolveRelayScope(caller);
    expect(rest).toHaveBeenCalledTimes(1);
    complete({ ok: true, json: async () => [row] });
    expect((await first).permissions.can_process_sale).toBe(true);
    expect((await second).permissions.can_process_sale).toBe(true);
  });
});

describe("permission refresh scheduling", () => {
  it("coalesces bursts and follows an in-flight read with the newest state", async () => {
    let complete!: (v: string) => void;
    const read = vi.fn().mockImplementationOnce(() => new Promise<string>((resolve) => { complete = resolve; })).mockResolvedValue("new");
    const apply = vi.fn();
    const refresher = createPermissionRefresh({ read, apply, current: () => true });
    const pending = refresher.refresh();
    await refresher.refresh(); await refresher.refresh();
    complete("old"); await pending;
    expect(read).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls.map(([v]) => v)).toEqual(["old", "new"]);
  });
  it.each(["logout", "unmount"])("discards a delayed result after %s", async (reason) => {
    let complete!: (v: string) => void;
    let current = true;
    const apply = vi.fn();
    const refresher = createPermissionRefresh({ read: () => new Promise<string>((resolve) => { complete = resolve; }), apply, current: () => current });
    const pending = refresher.refresh();
    if (reason === "logout") current = false; else refresher.stop();
    complete("old-account"); await pending;
    expect(apply).not.toHaveBeenCalled();
  });
  it("can refresh again after a network failure", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue("reconnected");
    const apply = vi.fn();
    const refresher = createPermissionRefresh({ read, apply, current: () => true });
    await refresher.refresh(); await refresher.refresh();
    expect(apply).toHaveBeenCalledExactlyOnceWith("reconnected");
  });
});
