import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ commit: vi.fn(), stored: "" }));
vi.mock("../business-storage", () => ({ readBusinessValue: () => mocks.stored, writeBusinessValue: (_: string, value: string) => { mocks.stored = value; } }));
vi.mock("@/core/api/pos-db", () => ({ commitOps: mocks.commit }));
vi.mock("@/core/api/db-query", () => ({ routedQuery: vi.fn() }));
import { cachedSuppliers, deleteSupplier } from "../suppliers";
beforeEach(() => { vi.stubGlobal("window", {}); mocks.commit.mockReset(); mocks.stored = JSON.stringify([{ id: "supplier", name: "Supplier", active: true }]); });
afterEach(() => vi.unstubAllGlobals());
it("retains a supplier in cache when the durable deletion fails", async () => {
  mocks.commit.mockRejectedValue(new Error("Database unavailable"));
  await expect(deleteSupplier("supplier")).rejects.toThrow("Database unavailable");
  expect(cachedSuppliers()).toHaveLength(1);
});
it("removes the cached supplier after the database confirms deletion", async () => {
  mocks.commit.mockResolvedValue("local");
  await deleteSupplier("supplier");
  expect(cachedSuppliers()).toEqual([]);
});
