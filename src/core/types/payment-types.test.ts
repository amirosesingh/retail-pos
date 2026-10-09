import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), commit: vi.fn() }));
vi.mock("@/core/api/db-query", () => ({ routedQuery: mocks.query }));
vi.mock("@/core/api/pos-db", () => ({ commitOps: mocks.commit }));
vi.mock("@/lib/notify", () => ({ describeError: () => "Save failed" }));
import { FALLBACK_PAYMENT_TYPES, loadEditablePaymentTypes, savePaymentTypes } from "./payment-types";
beforeEach(() => { vi.clearAllMocks(); mocks.commit.mockResolvedValue("local"); });
it("gives empty-database defaults valid IDs and saves all methods in one batch", async () => {
  mocks.query.mockResolvedValue([]);
  const rows = await loadEditablePaymentTypes();
  expect(rows).toHaveLength(5);
  expect(rows.every(row => !row.id.startsWith("seed-"))).toBe(true);
  expect(new Set(rows.map(row => row.id)).size).toBe(5);
  expect(await savePaymentTypes(rows)).toEqual({ success: true });
  expect(mocks.commit).toHaveBeenCalledTimes(1);
  expect(mocks.commit.mock.calls[0][1][0].rows).toHaveLength(5);
});
it("does not disguise a failed settings load with editable cached defaults", async () => {
  mocks.query.mockRejectedValue(new Error("Connection unavailable"));
  await expect(loadEditablePaymentTypes()).rejects.toThrow("Connection unavailable");
});
it("preserves existing IDs when loading settings", async () => {
  const id = crypto.randomUUID();
  mocks.query.mockResolvedValue([{id, name:"Cash",type_code:"cash",sort_order:10}]);
  expect((await loadEditablePaymentTypes())[0].id).toBe(id);
});
it("rejects temporary IDs without issuing a write", async () => {
  expect((await savePaymentTypes(FALLBACK_PAYMENT_TYPES)).success).toBe(false);
  expect(mocks.commit).not.toHaveBeenCalled();
});
it("validates the entire list before writing duplicate codes or fractional order", async () => {
  const row = { ...FALLBACK_PAYMENT_TYPES[0], id:crypto.randomUUID() };
  expect((await savePaymentTypes([row, {...row,id:crypto.randomUUID(),code:"CASH"}])).error).toContain("Duplicate");
  expect((await savePaymentTypes([{...row,sort:1.5}])).error).toContain("whole number");
  expect(mocks.commit).not.toHaveBeenCalled();
});
it("reports rejected writes without claiming success", async () => {
  mocks.commit.mockRejectedValue(new Error("Denied"));
  expect(await savePaymentTypes([{...FALLBACK_PAYMENT_TYPES[0],id:crypto.randomUUID()}])).toEqual({success:false,error:"Save failed"});
});
