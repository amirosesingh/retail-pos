import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), snapshot: vi.fn(), query: vi.fn(), local: false }));
vi.mock("@/integrations/supabase/external-client", () => ({ supabaseExternal: {}, authenticatedExternalClientSnapshot: mocks.snapshot }));
vi.mock("@/core/local-db/db-mode", () => ({ effectiveDatabaseMode: () => mocks.local ? "local" : "online" }));
vi.mock("@/core/api/db-query", () => ({ routedQuery: mocks.query }));
import { loadShiftsByIds } from "@/core/api/pos-db";
beforeEach(() => {
  vi.clearAllMocks(); mocks.local = false;
  mocks.snapshot.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: [], error: null });
  mocks.query.mockResolvedValue([]);
});
it("uses the secure projection for every online ID batch without a direct table read", async () => {
  const ids = Array.from({ length: 501 }, (_, index) => `shift-${index}`);
  await expect(loadShiftsByIds(ids)).resolves.toEqual([]);
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
  expect(mocks.rpc).toHaveBeenNthCalledWith(1, "shift_rows_secure", { p_ids: ids.slice(0, 500) });
  expect(mocks.rpc).toHaveBeenNthCalledWith(2, "shift_rows_secure", { p_ids: ids.slice(500) });
  expect(mocks.query).not.toHaveBeenCalled();
});
it("retains Electron's local SQL path without requiring cloud authentication", async () => {
  mocks.local = true;
  await expect(loadShiftsByIds(["local-shift"])).resolves.toEqual([]);
  expect(mocks.snapshot).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.query).toHaveBeenCalledWith("shifts", expect.objectContaining({ in: { column: "id", values: ["local-shift"] } }));
});
it("does not turn a refused or unauthenticated refresh into a successful empty result", async () => {
  mocks.snapshot.mockResolvedValueOnce(null);
  await expect(loadShiftsByIds(["shift"])).rejects.toThrow("session");
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error("Permission denied") });
  await expect(loadShiftsByIds(["shift"])).rejects.toThrow("Permission denied");
});
