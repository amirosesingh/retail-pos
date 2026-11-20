import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadStockHistoryMovements } from "../stock-history-movements-client";

const transport = vi.hoisted(() => ({
  mode: vi.fn(), management: vi.fn(), epoch: vi.fn(), bridge: vi.fn(), native: vi.fn(), hosted: vi.fn(), auth: vi.fn(),
}));
vi.mock("@/core/local-db/local-db", () => ({ localDb: transport.bridge }));
vi.mock("@/core/local-db/db-mode", () => ({ effectiveDatabaseMode: transport.mode }));
vi.mock("../management-device", () => ({ isManagementDevice: transport.management }));
vi.mock("../session-epoch", () => ({ sessionEpoch: transport.epoch }));
vi.mock("../pos-caller-auth", () => ({ getPosCallerAuth: transport.auth }));
vi.mock("../hosted-function-client", () => ({ hostedFunction: (name: string) => {
  if (name !== "stock-history.movements") throw new Error("Wrong hosted action");
  return transport.hosted;
} }));
vi.mock("../stock-history.functions", () => ({ loadStockHistoryMovementsDirect: vi.fn() }));

const request = {
  branchId: "branch-a", productId: "10000000-0000-4000-8000-000000000001", cutoff: "2026-11-06T00:00:00.1234567Z",
  timeZone: "Asia/Brunei", sourceRevision: "revision-7",
};
const page = { ...request, status: "complete", reasons: [], baselineAt: "2026-11-01T16:00:00.0000000Z", rows: [], next: null };

describe("stock movement client dispatch", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    transport.mode.mockReturnValue("local"); transport.management.mockReturnValue(false); transport.epoch.mockReturnValue(1);
    transport.bridge.mockReturnValue({ stockHistoryMovements: transport.native });
    transport.native.mockResolvedValue({ ok: true, page }); transport.hosted.mockResolvedValue(page);
    transport.auth.mockResolvedValue({ accessToken: "owned-fixture" });
  });

  it("uses the local authorized bridge for local tills", async () => {
    await expect(loadStockHistoryMovements(request)).resolves.toEqual(page);
    expect(transport.native).toHaveBeenCalledWith(request);
    expect(transport.auth).not.toHaveBeenCalled();
    expect(transport.hosted).not.toHaveBeenCalled();
  });

  it.each(["online", "management"])("uses the hosted action for %s scope", async route => {
    if (route === "management") transport.management.mockReturnValue(true);
    else transport.mode.mockReturnValue("online");
    await expect(loadStockHistoryMovements(request)).resolves.toEqual(page);
    expect(transport.hosted).toHaveBeenCalledWith({ data: { accessToken: "owned-fixture", request } });
    expect(transport.native).not.toHaveBeenCalled();
  });

  it("does not retry a denied local read against the hosted branch", async () => {
    transport.native.mockResolvedValue({ ok: false, code: "PERMISSION_DENIED" });
    await expect(loadStockHistoryMovements(request)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(transport.hosted).not.toHaveBeenCalled();
  });

  it("ignores late responses after a local database mode change", async () => {
    transport.native.mockImplementation(async () => {
      transport.mode.mockReturnValue("online");
      return { ok: true, page };
    });
    await expect(loadStockHistoryMovements(request)).rejects.toMatchObject({ code: "ESTOCK_HISTORY_CONTEXT_CHANGED" });
    expect(transport.hosted).not.toHaveBeenCalled();
  });

  it("keeps hosted requests and responses bound to the current operator", async () => {
    transport.mode.mockReturnValue("online");
    transport.auth.mockImplementation(async () => {
      transport.epoch.mockReturnValue(2);
      return { accessToken: "obsolete-fixture" };
    });
    await expect(loadStockHistoryMovements(request)).rejects.toMatchObject({ code: "ESTOCK_HISTORY_CONTEXT_CHANGED" });
    expect(transport.hosted).not.toHaveBeenCalled();
  });
});
