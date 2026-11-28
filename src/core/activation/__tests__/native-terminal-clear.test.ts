import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { recordId } = require("../../../../electron/sync/uuid-fields.cjs");
const source = readFileSync(new URL("../../../../electron/main.cjs", import.meta.url), "utf8");
const from = source.indexOf('  ipcMain.handle("terminal:clear",');
const to = source.indexOf('  ipcMain.handle("config:read",', from);
const registration = {
  tokenId: "10000000-0000-4000-8000-000000000001",
  supabaseUrl: "https://registered.example",
  deviceBindingProof: "private-device-proof",
};
const context = (reason: "revoked" | "missing" | "unpair" = "revoked") => ({
  tokenId: registration.tokenId,
  projectUrl: registration.supabaseUrl,
  verificationProjectUrl: registration.supabaseUrl,
  reason,
});

function shell() {
  let handler: (_event: unknown, raw?: unknown) => { ok: boolean; code?: string; error?: string };
  let active: typeof registration | null = { ...registration };
  const order: string[] = [];
  const read = vi.fn((_options: { strict: boolean }) => active);
  const write = vi.fn((_value: null) => { order.push("clear"); active = null; return { ok: true }; });
  const cloudRead = vi.fn((_options: { strict: boolean }) => ({ url: registration.supabaseUrl } as { url: string } | null));
  const log = vi.fn();
  const stop = vi.fn(() => { order.push("stop"); });
  const pause = vi.fn(() => { order.push("pause"); });
  const paused = new Function("ipcMain", "terminalStore", "cloudCredentials", "diagnostics", "recordId", "stopAutomaticSync", "syncCoordinator", `
    let terminalIdentityPausedSync = false;
    ${source.slice(from, to)}
    return () => terminalIdentityPausedSync;
  `)(
    { handle: (_channel: string, callback: typeof handler) => { handler = callback; } },
    { read, write }, { read: cloudRead }, { logConnection: log }, recordId, stop, { pause },
  ) as () => boolean;
  return { clear: (raw?: unknown) => handler({}, raw), read, write, cloudRead, log, stop, pause, paused, order,
    replace: (next: typeof active) => { active = next; } };
}

function expectRetained(native: ReturnType<typeof shell>) {
  expect(native.write).not.toHaveBeenCalled();
  expect(native.stop).not.toHaveBeenCalled();
  expect(native.pause).not.toHaveBeenCalled();
  expect(native.paused()).toBe(false);
}

describe("native terminal clear retains the current registration", () => {
  it.each(["revoked", "missing"] as const)("clears a confirmed %s registration before pausing sync", reason => {
    const native = shell();
    expect(native.clear(context(reason))).toEqual({ ok: true });
    expect(native.read).toHaveBeenCalledWith({ strict: true });
    expect(native.cloudRead).toHaveBeenCalledWith({ strict: true });
    expect(native.write).toHaveBeenCalledExactlyOnceWith(null);
    expect(native.paused()).toBe(true);
    expect(native.order).toEqual(["clear", "stop", "pause"]);
  });

  it("refuses an older revocation after a replacement terminal is saved", () => {
    const native = shell();
    native.replace({ ...registration, tokenId: "10000000-0000-4000-8000-000000000002" });
    expect(native.clear(context())).toMatchObject({ ok: false, code: "EACTIVATION_CONTEXT_CHANGED" });
    expectRetained(native);
  });

  it.each(["projectUrl", "verificationProjectUrl"] as const)("refuses a different %s", field => {
    const native = shell();
    expect(native.clear({ ...context(), [field]: "https://another-project.example" })).toMatchObject({
      ok: false, code: "EACTIVATION_CONTEXT_CHANGED",
    });
    expectRetained(native);
  });

  it.each(["revoked", "missing"] as const)("retains registration when the operator changes the database during %s verification", reason => {
    const native = shell();
    native.cloudRead.mockReturnValue({ url: "https://new-project.example" });
    expect(native.clear(context(reason))).toMatchObject({ ok: false, code: "EACTIVATION_CONTEXT_CHANGED" });
    expectRetained(native);
  });

  it("requires the current saved cloud connection for an automatic clear", () => {
    const native = shell();
    native.cloudRead.mockReturnValue(null);
    expect(native.clear(context())).toMatchObject({ ok: false, code: "EACTIVATION_CONTEXT_CHANGED" });
    expectRetained(native);
  });

  it("allows explicit unpair of the matching registration after changing the connection", () => {
    const native = shell();
    native.cloudRead.mockReturnValue({ url: "https://new-project.example" });
    expect(native.clear({ ...context("unpair"), verificationProjectUrl: undefined })).toEqual({ ok: true });
    expect(native.cloudRead).not.toHaveBeenCalled();
    expect(native.write).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("normalizes URL host casing and trailing slashes without accepting other paths", () => {
    const native = shell();
    expect(native.clear({ ...context(), projectUrl: "https://REGISTERED.example/", verificationProjectUrl: "https://registered.example///" })).toEqual({ ok: true });
    const changedPath = shell();
    expect(changedPath.clear({ ...context(), projectUrl: "https://registered.example/other" })).toMatchObject({ code: "EACTIVATION_CONTEXT_CHANGED" });
    expectRetained(changedPath);
  });

  it.each([undefined, null, [], {}, { ...context(), tokenId: "" }, { ...context(), reason: "other" },
    { ...context(), projectUrl: "" }, { ...context(), verificationProjectUrl: undefined }])("refuses incomplete legacy or malformed context %#", raw => {
    const native = shell();
    expect(native.clear(raw)).toMatchObject({ ok: false, code: "EACTIVATION_CONTEXT_CHANGED" });
    expectRetained(native);
  });

  it("does not write or pause when the native registration is already absent", () => {
    const native = shell();
    native.replace(null);
    expect(native.clear(context())).toEqual({ ok: true });
    expectRetained(native);
    expect(native.cloudRead).not.toHaveBeenCalled();
  });

  it.each(["registration", "connection"])("retains registration when the %s vault cannot be read", vault => {
    const native = shell();
    const failure = () => { throw new Error("Private vault failure: " + registration.deviceBindingProof); };
    if (vault === "registration") native.read.mockImplementation(failure);
    else native.cloudRead.mockImplementation(failure);
    const result = native.clear(context());
    expect(result).toMatchObject({ ok: false, code: "EACTIVATION_STORE" });
    expect(JSON.stringify(result)).not.toContain(registration.deviceBindingProof);
    expectRetained(native);
  });

  it("keeps synchronization running if clearing the store fails", () => {
    const native = shell();
    native.write.mockReturnValue({ ok: false });
    expect(native.clear(context())).toMatchObject({ ok: false, code: "EACTIVATION_STORE" });
    expect(native.stop).not.toHaveBeenCalled();
    expect(native.pause).not.toHaveBeenCalled();
    expect(native.paused()).toBe(false);
  });

  it("records clear outcomes without terminal credentials, project URLs or proofs", () => {
    const native = shell();
    native.clear({ ...context(), tokenId: "different-private-token" });
    native.clear(context());
    const logged = JSON.stringify(native.log.mock.calls);
    expect(logged).toContain("activation.clear.refused");
    expect(logged).toContain("activation.clear.succeeded");
    for (const value of [...Object.values(registration), "different-private-token"]) expect(logged).not.toContain(value);
  });

  it("forwards the expected native context through preload", () => {
    const preload = readFileSync(new URL("../../../../electron/preload.cjs", import.meta.url), "utf8");
    const property = preload.split("\n").find(line => line.includes("clearTerminalConfig:"));
    expect(property).toBeDefined();
    const invoke = vi.fn();
    const bridge = new Function("invoke", `return ({ ${property} });`)(invoke);
    const expected = context();
    bridge.clearTerminalConfig(expected);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("terminal:clear", expected);
  });
});
