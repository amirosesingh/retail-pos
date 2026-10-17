import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
const mocks = vi.hoisted(() => ({ native: true, fetch: vi.fn(), scope: vi.fn(), list: vi.fn() }));
vi.mock("@/platform-config/platform", () => ({ isTerminalApp: () => mocks.native }));
vi.mock("../server-origin", () => ({ posFetch: mocks.fetch }));
vi.mock("../store-groups.functions", () => ({ loadStoreGroupsForCaller: mocks.list }));
import { hostedFunction } from "../hosted-function-client";
import { handleHostedFunctionRequest } from "../hosted-function-endpoint.server";
beforeEach(() => { vi.clearAllMocks(); mocks.native = true; });
it("preserves native proof, payload and cancellation without running the local handler", async () => {
  const direct = vi.fn(async (input: { data: { sessionToken: string }; signal?: AbortSignal }) => input.data);
  mocks.fetch.mockResolvedValue(Response.json({ result: "hosted" }));
  const signal = new AbortController().signal;
  const data = { sessionToken: "person" };
  const call = hostedFunction("session-permissions.readSessionPermissions", direct);
  await call({ data, signal });
  expect(direct).not.toHaveBeenCalled();
  expect(mocks.fetch).toHaveBeenCalledWith("/api/v1/pos/sync?operation=app_function", expect.objectContaining({ signal }));
  expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({ action: "session-permissions.readSessionPermissions", data });
});
it("preserves the original website function and its response", async () => {
  mocks.native = false;
  const direct = vi.fn(async (_input: { data: { accessToken: string } }) => ({ ok: true }));
  const input = { data: { accessToken: "staff" } };
  expect(await hostedFunction("store-groups.loadStoreGroupsForCaller", direct)(input)).toEqual({ ok: true });
  expect(direct).toHaveBeenCalledWith(input);
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it("does not turn an HTML 404 into successful empty data or retry a write", async () => {
  mocks.fetch.mockResolvedValue(new Response("missing", { status: 404 }));
  await expect(hostedFunction("sku.reserveSkuLease", vi.fn())({ data: {} } as never)).rejects.toThrow("404");
  expect(mocks.fetch).toHaveBeenCalledOnce();
  mocks.fetch.mockResolvedValue(new Response("<html>app shell</html>"));
  await expect(hostedFunction("sku.reserveSkuLease", vi.fn())({ data: {} } as never)).rejects.toThrow("invalid response");
});
const request = (action: string, data: unknown = {}) => new Request("https://pos.example", {
  method: "POST", body: JSON.stringify({ action, data }),
});
it("denies arbitrary imports, prototype names and malformed input before dispatch", async () => {
  for (const action of ["__proto__", "constructor", "../secure-settings.server", "unknown.operation"]) {
    expect((await handleHostedFunctionRequest(request(action))).status).toBe(400);
  }
  expect((await handleHostedFunctionRequest(request("store-groups.loadStoreGroupsForCaller", null))).status).toBe(400);
  expect(mocks.list).not.toHaveBeenCalled();
});
it("runs the unchanged guarded operation and preserves its refusal", async () => {
  mocks.list.mockResolvedValue({ ok: false, error: "Staff identity required", rows: [] });
  const response = await handleHostedFunctionRequest(request("store-groups.loadStoreGroupsForCaller", { terminalToken: "machine" }));
  expect(await response.json()).toEqual({ ok: false, error: "Staff identity required", rows: [] });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.list).toHaveBeenCalledWith({ data: { terminalToken: "machine" } });
});
it("covers every stable client action with an explicit server allowlist entry", () => {
  const server = readFileSync("src/lib/hosted-function-endpoint.server.ts", "utf8");
  for (const file of readdirSync("src/lib").filter(f => f.endsWith("-client.ts"))) {
    const client = readFileSync(`src/lib/${file}`, "utf8");
    for (const [, action] of client.matchAll(/hostedFunction\("([^"]+)"/g))
      expect(server).toContain(`"${action}":`);
  }
});
