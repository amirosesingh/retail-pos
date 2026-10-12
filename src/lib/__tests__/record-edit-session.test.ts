import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), scope: vi.fn(), write: vi.fn(), clear: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => ({ validator: (parse: (data: unknown) => unknown) => ({ handler: (handle: (input: { data: unknown }) => unknown) => (input: { data: unknown }) => handle({ data: parse(input.data) }) }) }) }));
vi.mock("@/core/api/pos-relay.server", () => ({ verifyRelayCaller: mocks.verify }));
vi.mock("@/core/api/relay-policy.server", () => ({ resolveRelayScope: mocks.scope }));
vi.mock("../record-edits.server", () => ({ writeRecordEdit: mocks.write, clearPendingEdit: mocks.clear }));
import { logRecordEdit } from "../record-edits.functions";
const input = { sessionToken: "verified-pos-session-token", kind: "sale", recordId: "sale-a", storeId: "branch-a", actionKey: "PAYMENT_CORRECTED", before: { paymentMethod: "card" }, after: { paymentMethod: "cash" }, note: "Correct tender" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.verify.mockResolvedValue({ authUserId: "admin-a" });
  mocks.scope.mockResolvedValue({ role: "admin", roleSlug: "admin", staffUserId: "admin-a", label: "Admin", isSupervisor: true });
  mocks.write.mockResolvedValue({ ok: true });
  mocks.clear.mockResolvedValue(undefined);
});
describe("payment correction audit session", () => {
  it("preserves the POS session for verification and records the proven administrator", async () => {
    await expect(logRecordEdit({ data: input })).resolves.toEqual({ ok: true });
    expect(mocks.verify).toHaveBeenCalledWith(expect.objectContaining({ sessionToken: input.sessionToken }));
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ editedBy: "admin-a", actionKey: "PAYMENT_CORRECTED" }));
  });
  it("does not authorize non-admin staff using the preserved session", async () => {
    mocks.scope.mockResolvedValue({ role: "staff", roleSlug: "cashier", staffUserId: "staff-a" });
    await expect(logRecordEdit({ data: input })).resolves.toMatchObject({ ok: false });
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
