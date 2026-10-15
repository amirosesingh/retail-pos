import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ scope: vi.fn(), rpc: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    validator: (validate: (input: unknown) => unknown) => ({
      handler: (handler: (input: unknown) => unknown) => (input: { data: unknown }) =>
        handler({ data: validate(input.data) }),
    }),
  }),
}));
vi.mock("../privileged-caller.server", () => ({ requireCallerScope: mocks.scope }));
vi.mock("../staff-admin.server", () => ({ serviceRpc: mocks.rpc }));
import { reserveCloudStockReference } from "../stock-ref.functions";
const data = { prefix: "SC-B1", minimum: 1, storeId: "B1", series: "stock" as const };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.scope.mockResolvedValue({ storeId: "B1" });
  mocks.rpc.mockResolvedValue(42);
});
it("requires stock permission and uses the verified branch for the database reservation", async () => {
  expect(await reserveCloudStockReference({ data })).toEqual({ ok: true, sequence: 42 });
  expect(mocks.scope).toHaveBeenCalledWith(data, { permission: "can_adjust_stock" });
  expect(mocks.rpc).toHaveBeenCalledWith("reserve_stock_document_number", {
    p_prefix: "SC-B1",
    p_minimum: 1,
    p_store_id: "B1",
  });
});
it("rejects another branch before calling the privileged database function", async () => {
  expect(await reserveCloudStockReference({ data: { ...data, storeId: "B2" } })).toMatchObject({
    ok: false,
  });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("preserves permission failures and never consumes a number", async () => {
  mocks.scope.mockRejectedValue(new Error("You do not have permission to use this feature."));
  expect(await reserveCloudStockReference({ data })).toMatchObject({
    ok: false,
    error: expect.stringContaining("permission"),
  });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("accepts UUID case variants while preserving the trusted database branch ID", async () => {
  const raw = "A1234567-1234-4234-8234-123456789ABC";
  mocks.scope.mockResolvedValue({ storeId: raw });
  expect(
    await reserveCloudStockReference({ data: { ...data, storeId: raw.toLowerCase() } }),
  ).toMatchObject({ ok: true });
  expect(mocks.rpc.mock.calls[0][1].p_store_id).toBe(raw);
});

it("keeps existing supervisor cross-branch access", async () => {
  mocks.scope.mockResolvedValue({ storeId: "B1", isSupervisor: true });
  expect(await reserveCloudStockReference({ data: { ...data, storeId: "B2" } })).toMatchObject({
    ok: true,
  });
  expect(mocks.rpc.mock.calls[0][1].p_store_id).toBe("B2");
});
it("rejects an ordinary account without a verified branch", async () => {
  mocks.scope.mockResolvedValue({ storeId: null, isSupervisor: false });
  expect(await reserveCloudStockReference({ data })).toMatchObject({ ok: false });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
