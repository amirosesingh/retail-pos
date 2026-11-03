import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  framework: vi.fn(), login: vi.fn(), env: vi.fn(), entryLoads: 0, endpointLoads: 0,
}));
vi.mock("../error-capture", () => ({ consumeLastCapturedError: () => undefined }));
vi.mock("../external-supabase-config", () => ({
  setRuntimeEnv: h.env, supabaseConfig: () => ({ url: "https://database.test" }),
}));

const path = "/api/public/cashier-login";
const request = (method = "POST", route = path, headers: Record<string, string> = {}) =>
  new Request(`https://pos.test${route}`, { method, headers: { origin: "capacitor://localhost", ...headers } });
const worker = async () => (await import("../../server")).default;
const secured = (response: Response) => {
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("content-security-policy")).toContain("https://database.test");
  expect(response.headers.get("content-security-policy")).toContain("wss://database.test");
};

beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks(); h.entryLoads = 0; h.endpointLoads = 0;
  vi.doMock("@tanstack/react-start/server-entry", () => {
    h.entryLoads++;
    return { default: { fetch: h.framework } };
  });
  vi.doMock("../cashier-login-endpoint.server", () => {
    h.endpointLoads++;
    return { handleCashierLogin: h.login };
  });
  h.framework.mockImplementation(async () => new Response("framework"));
  h.login.mockImplementation(async () => Response.json({ ok: false, code: "sign_in_failed" }, { status: 401 }));
});

describe("direct cashier Worker dispatch", () => {
  it.each([path, `${path}?retry=1`])("serves exact POST %s without loading the framework entry", async route => {
    const server = await worker(), input = request("POST", route), env = { deployment: "synthetic" }, ctx = {};
    Object.defineProperty(input, "cf", { value: { colo: "SYN" } });
    h.login.mockImplementationOnce(async () => {
      expect(h.env).toHaveBeenCalledWith(env);
      return Response.json({ ok: true, synthetic: "response" });
    });
    const response = await server.fetch(input, env, ctx);
    expect(await response.json()).toEqual({ ok: true, synthetic: "response" });
    expect(h.login).toHaveBeenCalledWith(input, { trustedWorkerIp: null });
    expect(h.framework).not.toHaveBeenCalled(); expect(h.entryLoads).toBe(0);
    expect(h.endpointLoads).toBe(1); secured(response);
    expect(response.headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
    expect(response.headers.has("access-control-allow-credentials")).toBe(false);
  });

  it("serves preflight without loading either the credential handler or framework", async () => {
    const response = await (await worker()).fetch(request("OPTIONS"), {}, {});
    expect(response.status).toBe(204); expect(await response.text()).toBe("");
    expect(h.login).not.toHaveBeenCalled(); expect(h.framework).not.toHaveBeenCalled();
    expect(h.entryLoads).toBe(0); expect(h.endpointLoads).toBe(0); secured(response);
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it.each(["GET", "HEAD", "PUT", "PATCH", "DELETE"])("retains framework dispatch for %s", async method => {
    const input = request(method), env = {}, ctx = {};
    expect(await (await (await worker()).fetch(input, env, ctx)).text()).toBe("framework");
    expect(h.framework).toHaveBeenCalledWith(input, env, ctx);
    expect(h.login).not.toHaveBeenCalled(); expect(h.entryLoads).toBe(1);
  });

  it.each([`${path}/`, "/api/cashier-login", "/api/public/Cashier-login", "/api/public/cashier-login/extra", "/"])(
    "retains framework dispatch for a different path %s", async route => {
      const response = await (await worker()).fetch(request("POST", route), {}, {});
      expect(await response.text()).toBe("framework"); expect(h.framework).toHaveBeenCalledOnce();
      expect(h.login).not.toHaveBeenCalled(); secured(response);
    },
  );

  it("retains Apple association dispatch and security before loading the framework", async () => {
    const input = new Request("https://beta-pos.luckycharmsdnbhd.com/.well-known/apple-app-site-association");
    const response = await (await worker()).fetch(input, {}, {});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ webcredentials: { apps: ["SMRQRLSBA3.com.luckycharms.pos.beta"] } });
    expect(h.login).not.toHaveBeenCalled(); expect(h.framework).not.toHaveBeenCalled(); secured(response);
  });

  it("passes only runtime-marked Cloudflare transport metadata as private address context", async () => {
    const input = request("POST", path, { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.8" });
    Object.defineProperty(input, "cf", { value: { colo: "SYN" } });
    await (await worker()).fetch(input, {}, {});
    expect(h.login).toHaveBeenCalledWith(input, { trustedWorkerIp: "203.0.113.9" });
    expect(h.entryLoads).toBe(0);
  });

  it.each([undefined, null, "spoofed"])("retains framework request scope without runtime metadata %j despite forwarding headers", async cf => {
    const input = request("POST", path, { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.8" });
    Object.defineProperty(input, "cf", { value: cf });
    await (await worker()).fetch(input, {}, {});
    expect(h.login).not.toHaveBeenCalled(); expect(h.endpointLoads).toBe(0);
    expect(h.framework).toHaveBeenCalledWith(input, {}, {}); expect(h.entryLoads).toBe(1);
  });

  it("keeps an explicitly missing Worker address distinct from a framework fallback", async () => {
    const input = request("POST", path, { "x-forwarded-for": "198.51.100.8" });
    Object.defineProperty(input, "cf", { value: {} });
    await (await worker()).fetch(input, {}, {});
    expect(h.login).toHaveBeenCalledWith(input, { trustedWorkerIp: null });
  });

  it("preserves catastrophic error normalization and security on the direct path", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      h.login.mockResolvedValueOnce(Response.json({ unhandled: true, message: "HTTPError" }, { status: 500 }));
      const input = request(); Object.defineProperty(input, "cf", { value: {} });
      const response = await (await worker()).fetch(input, {}, {});
      expect(response.status).toBe(500); expect(response.headers.get("content-type")).toContain("text/html");
      expect(await response.text()).toMatch(/<!doctype html>/i); secured(response);
      expect(h.framework).not.toHaveBeenCalled();
    } finally { error.mockRestore(); }
  });
});
