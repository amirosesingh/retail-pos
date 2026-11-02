import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), list: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock("@/core/api/pos-relay.server", () => ({ verifyRelayCaller: mocks.verify }));
vi.mock("@/lib/staff-admin.server", () => ({ listTerminalStaff: mocks.list }));

import { Route } from "@/routes/api/public/terminal-staff";

type TestRoute = {
  options: { server: { handlers: {
    POST: (input: { request: Request }) => Promise<Response>;
    OPTIONS: (input: { request: Request }) => Promise<Response>;
  } } };
};
const handlers = (Route as unknown as TestRoute).options.server.handlers;
const proof = "a".repeat(64);
const request = (extra: Record<string, unknown> = {}) => new Request("https://pos.test/api/public/terminal-staff", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "capacitor://localhost" },
  body: JSON.stringify({ terminalToken: "terminal-a", deviceBindingProof: proof, ...extra }),
});
const post = (extra?: Record<string, unknown>) => handlers.POST({ request: request(extra) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.verify.mockResolvedValue({ kind: "terminal", label: "Till A", storeId: "branch-a" });
  mocks.list.mockResolvedValue([]);
});

describe("terminal staff route error classification", () => {
  it("reports a roster SQL failure after valid registration as unavailable, without leaking its error", async () => {
    mocks.list.mockRejectedValue(new Error("SQL statement failed; credential=fixture-secret"));
    const response = await post();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false, error: "The staff list is temporarily unavailable. Please try again.", staff: [],
    });
    expect(mocks.verify).toHaveBeenCalledWith({ terminalToken: "terminal-a", deviceBindingProof: proof });
    expect(mocks.list).toHaveBeenCalledWith("branch-a");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("capacitor://localhost");
  });

  it.each([
    { cause: "invalid proof", status: 401 },
    { cause: "revoked registration", status: 401 },
    { cause: "mismatched device", status: 401 },
    { cause: "forbidden registration", status: 403 },
  ])("retains $cause denial without reading staff", async ({ cause, status }) => {
    mocks.verify.mockRejectedValue(Object.assign(new Error(`fixture-private-${cause}`), { status }));
    const response = await post();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      ok: false, error: "This terminal's registration could not be verified.", staff: [],
    });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("keeps an untyped authentication refusal denied", async () => {
    mocks.verify.mockRejectedValue(new Error("fixture-private-authentication-detail"));
    const response = await post();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false, error: "This terminal's registration could not be verified.", staff: [],
    });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("keeps a terminal registry outage distinct from an invalid registration", async () => {
    mocks.verify.mockRejectedValue(Object.assign(new Error("fixture-private-registry-error"), { status: 503 }));
    const response = await post();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false, error: "Terminal verification is temporarily unavailable. Please try again.", staff: [],
    });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("refuses a missing terminal token before verification or staff access", async () => {
    const response = await post({ terminalToken: " " });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, staff: [] });
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("passes a missing device proof to registration verification and preserves its refusal", async () => {
    mocks.verify.mockRejectedValue(Object.assign(new Error("Device proof required"), { status: 401 }));
    const response = await post({ deviceBindingProof: undefined });
    expect(response.status).toBe(401);
    expect(mocks.verify).toHaveBeenCalledWith({ terminalToken: "terminal-a", deviceBindingProof: undefined });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("rejects malformed proof before any registration or staff lookup", async () => {
    const response = await post({ deviceBindingProof: "invalid-proof" });
    expect(response.status).toBe(400);
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("refuses a non-terminal caller before reading staff", async () => {
    mocks.verify.mockResolvedValue({ kind: "staff", label: "Staff A", storeId: "branch-a" });
    expect((await post()).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("returns a genuine empty roster as success", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, staff: [] });
  });

  it("uses the registered Operations branch instead of a renderer-supplied branch", async () => {
    const staff = [{ username: "cashier-a", fullName: "Cashier A", roleSlug: "cashier", storeId: "branch-a", pinLength: 0 }];
    mocks.list.mockResolvedValue(staff);
    const response = await post({ storeId: "branch-b" });
    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith("branch-a");
    expect(await response.json()).toEqual({ ok: true, staff });
  });

  it.each(["branch-a", null])("preserves existing Management roster selection for %s", async storeId => {
    mocks.verify.mockResolvedValue({ kind: "terminal", label: "Management", storeId: null, managementDevice: true });
    const response = await post({ storeId });
    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith(storeId);
  });

  it("keeps the native cross-origin preflight available", async () => {
    const response = await handlers.OPTIONS({ request: request() });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("capacitor://localhost");
  });
});
