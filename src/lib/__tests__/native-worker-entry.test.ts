import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ framework: vi.fn(), sync: vi.fn(), adopt: vi.fn(), enroll: vi.fn(), env: vi.fn(), frameworkLoads: 0 }));
vi.mock("../error-capture", () => ({ consumeLastCapturedError: () => undefined }));
vi.mock("../external-supabase-config", () => ({ setRuntimeEnv: h.env, supabaseConfig: () => ({ url: "https://database.fixture" }) }));
const paths = ["/api/v1/pos/sync", "/api/v1/pos/ipc-adopt", "/api/v1/pos/shift-author-enroll"] as const;
const input = (path: string, method = "POST", ...metadata: unknown[]) => {
  const request = new Request(`https://pos.fixture${path}`, { method, headers: { origin: "capacitor://localhost", "cf-connecting-ip": "203.0.113.1" },
    ...(method === "POST" ? { body: '{"fixture":true}' } : {}) });
  Object.defineProperty(request, "cf", { value: metadata.length ? metadata[0] : {} });
  return request;
};
const entry = async () => (await import("../../server")).default;
const headers = (response: Response) => {
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("content-security-policy")).toContain("https://database.fixture");
};

beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks(); h.frameworkLoads = 0;
  vi.doMock("@tanstack/react-start/server-entry", () => { h.frameworkLoads++; return { default: { fetch: h.framework } }; });
  vi.doMock("../sync-endpoint.server", () => ({ handleSyncRequest: h.sync }));
  vi.doMock("../ipc-adopt-endpoint.server", () => ({ handleIpcAdopt: h.adopt }));
  vi.doMock("../shift-author-enroll-endpoint.server", () => ({ handleShiftAuthorEnroll: h.enroll }));
  h.framework.mockImplementation(async () => new Response("framework"));
  for (const handler of [h.sync, h.adopt, h.enroll]) handler.mockImplementation(async () => Response.json({ ok: false, code: "fixture_denied" }, { status: 403 }));
});

describe("guarded native Worker dispatch", () => {
  it("receives bindings from Nitro when its SSR delegation supplies only the request", async () => {
    const runtime = { POS_GROUPED_EXTENDED_PILOT_ENABLED: "true" };
    vi.stubGlobal("__env__", runtime);
    try {
      const worker = await entry();
      await worker.fetch(input(paths[0]), undefined, undefined);
      expect(h.env).toHaveBeenLastCalledWith(runtime);
      const direct = { fixture: true };
      await worker.fetch(input(paths[0]), direct, undefined);
      expect(h.env).toHaveBeenLastCalledWith(direct);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(paths)("delegates exact CF POST %s without loading the UI router", async path => {
    const request = input(path), env = { fixture: true }, handler = path === paths[0] ? h.sync : path === paths[1] ? h.adopt : h.enroll;
    handler.mockImplementationOnce(async (received: Request) => {
      expect(h.env).toHaveBeenCalledWith(env);
      expect(received).toBe(request);
      expect(await received.text()).toBe('{"fixture":true}');
      return Response.json({ ok: true });
    });
    const response = await (await entry()).fetch(request, env, {});
    expect(await response.json()).toEqual({ ok: true }); headers(response);
    expect(handler).toHaveBeenCalledOnce(); expect(h.frameworkLoads).toBe(0);
    expect(response.headers.get("access-control-allow-origin")).toBe(path === paths[0] ? "capacitor://localhost" : null);
    for (const other of [h.sync, h.adopt, h.enroll].filter(value => value !== handler)) expect(other).not.toHaveBeenCalled();
  });

  it.each(paths)("retains each handler's denial response on %s", async path => {
    const response = await (await entry()).fetch(input(path), {}, {});
    expect(response.status).toBe(403); expect(await response.json()).toEqual({ ok: false, code: "fixture_denied" }); headers(response);
    expect(h.framework).not.toHaveBeenCalled();
  });

  it.each([undefined, null, "forged"])("retains framework scope without CF runtime metadata %j", async cf => {
    for (const path of paths) {
      const request = input(path, "POST", cf), env = {}, ctx = {};
      expect(await (await (await entry()).fetch(request, env, ctx)).text()).toBe("framework");
      expect(h.framework).toHaveBeenLastCalledWith(request, env, ctx);
    }
    expect(h.sync).not.toHaveBeenCalled(); expect(h.adopt).not.toHaveBeenCalled(); expect(h.enroll).not.toHaveBeenCalled();
  });

  it.each(["app_function", "authorization", "staff_admin", "system_audit", "membership_lookup", "membership_directory", "unknown", ""])(
    "keeps sync operation=%s on its existing framework path", async operation => {
      const response = await (await entry()).fetch(input(`${paths[0]}?operation=${operation}`), {}, {});
      expect(await response.text()).toBe("framework"); expect(h.sync).not.toHaveBeenCalled();
    },
  );

  it("retains sync preflight but does not add preflight to adoption or enrollment", async () => {
    const worker = await entry();
    const response = await worker.fetch(input(paths[0], "OPTIONS"), {}, {});
    expect(response.status).toBe(204); headers(response);
    expect(response.headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
    expect(h.framework).not.toHaveBeenCalled(); expect(h.sync).not.toHaveBeenCalled();
    for (const path of paths.slice(1)) expect(await (await worker.fetch(input(path, "OPTIONS"), {}, {})).text()).toBe("framework");
    expect(h.adopt).not.toHaveBeenCalled(); expect(h.enroll).not.toHaveBeenCalled();
  });

  it.each(["GET", "HEAD", "PUT", "DELETE"])("keeps other methods %s on the framework", async method => {
    for (const path of paths) expect(await (await (await entry()).fetch(input(path, method), {}, {})).text()).toBe("framework");
    expect(h.sync).not.toHaveBeenCalled(); expect(h.adopt).not.toHaveBeenCalled(); expect(h.enroll).not.toHaveBeenCalled();
  });

  it.each(paths)("does not intercept a trailing slash at %s", async path => {
    expect(await (await (await entry()).fetch(input(`${path}/`), {}, {})).text()).toBe("framework");
  });

  it("preserves structured availability errors without converting them into credential denial", async () => {
    h.adopt.mockResolvedValueOnce(Response.json({ ok: false, code: "EAUTH_UNAVAILABLE" }, { status: 503 }));
    const response = await (await entry()).fetch(input(paths[1]), {}, {});
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ ok: false, code: "EAUTH_UNAVAILABLE" }); headers(response);
  });

  it("keeps catastrophic-response normalization on the direct path", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      h.sync.mockResolvedValueOnce(Response.json({ unhandled: true, message: "HTTPError" }, { status: 500 }));
      const response = await (await entry()).fetch(input(paths[0]), {}, {});
      expect(response.status).toBe(500); expect(response.headers.get("content-type")).toContain("text/html"); headers(response);
      expect(h.framework).not.toHaveBeenCalled();
    } finally { error.mockRestore(); }
  });
});
