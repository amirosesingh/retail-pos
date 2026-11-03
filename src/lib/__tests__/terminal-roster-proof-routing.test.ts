import { beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ proof: vi.fn(), fetch: vi.fn(), list: vi.fn() }));
vi.mock("../native-terminal-proof", () => ({ readNativeTerminalProof: h.proof }));
vi.mock("../staff-admin.functions", () => ({ listTerminalStaffAccounts: h.list, preparePinSignIn: vi.fn() }));
vi.mock("../staff-admin-client", () => ({ deleteStaffAccount: vi.fn(), migrateCashiersToAccounts: vi.fn(),
  saveStaffAccount: vi.fn(), setStaffAccountActive: vi.fn(), updateStaffAccount: vi.fn() }));
vi.mock("../pos-caller-auth", () => ({ getPosCallerAuth: vi.fn() }));
vi.mock("../server-origin", () => ({ serverOrigin: () => "https://backend.fixture",
  serverUnreachableOnDevice: () => false, posFetch: h.fetch }));
import { listTerminalStaff } from "../staff-admin";

beforeEach(() => {
  vi.clearAllMocks();
  h.proof.mockResolvedValue({ terminalToken: "terminal-a", deviceBindingProof: "a".repeat(64) });
  h.fetch.mockResolvedValue(Response.json({ staff: [] }));
});

it("does not misclassify mismatched native identity as a network outage", async () => {
  h.proof.mockRejectedValue(Object.assign(new Error("private fixture detail"), { code: "EACTIVATION_BINDING", status: 403 }));
  expect(await listTerminalStaff("branch-a")).toEqual({ staff: [], reason: "not-authorised" });
  expect(h.fetch).not.toHaveBeenCalled();
  expect(h.list).not.toHaveBeenCalled();
});

it("keeps unreadable native storage distinct from a registration rejection", async () => {
  h.proof.mockRejectedValue(Object.assign(new Error("private fixture detail"), { code: "EAUTH_UNAVAILABLE", status: 503 }));
  expect(await listTerminalStaff("branch-a")).toEqual({ staff: [], reason: "unreachable" });
  expect(h.fetch).not.toHaveBeenCalled();
});

it("sends the selected existing proof through the unchanged guarded roster request", async () => {
  expect(await listTerminalStaff("branch-a")).toEqual({ staff: [], reason: "empty" });
  const [path, request] = h.fetch.mock.calls[0];
  expect(path).toBe("/api/public/terminal-staff");
  expect(request.method).toBe("POST");
  expect(JSON.parse(request.body)).toEqual({ storeId: "branch-a", terminalToken: "terminal-a", deviceBindingProof: "a".repeat(64) });
});
