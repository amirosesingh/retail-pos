import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import type { TerminalConfig } from "../terminal-tokens";

const require = createRequire(import.meta.url);
const nativeRestore = require("../../../../electron/terminal-restore.cjs").restoreTerminalConfig;

const f = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  restore: vi.fn(),
  clear: vi.fn(),
  clearSeal: vi.fn(),
  seal: vi.fn(),
  readSeal: vi.fn(),
  rpc: vi.fn(),
  posFetch: vi.fn(),
  missingWebsite: vi.fn(),
  saveBackend: vi.fn(),
  restoreProof: vi.fn(),
  event: vi.fn(),
  bootstrap: vi.fn(),
  backendRead: vi.fn(),
}));
const tokenId = "61ff814e-8652-45f0-9e67-a0cd62251512";
const proofHash = "a".repeat(64);
const project = "https://beta-project.example";
const localKey = "saved-publishable-key";
const backend = "https://beta-pos.example";

vi.mock("@/integrations/supabase/external-client", () => ({
  createTenantClient: () => ({ rpc: f.rpc }), resetExternalClient: vi.fn(), supabaseExternal: { rpc: f.rpc },
}));
vi.mock("@/lib/terminal-crypto", () => ({
  isEncryptedV1: () => true,
  decryptActivationV1: async () => ({
    pairToken: tokenId, supabaseUrl: project, supabaseAnonKey: "token-public-key", backendUrl: "https://issuer.example", platform: "pc",
  }),
}));
vi.mock("@/lib/device-secrets", () => ({ clearDeviceSecret: f.clearSeal, getDeviceSecret: f.readSeal, setDeviceSecret: f.seal }));
vi.mock("@/core/activation/device-proof", () => ({
  deviceProofHash: async () => proofHash, restoreVerifiedDesktopDeviceProof: f.restoreProof,
}));
vi.mock("@/core/activation/terminal-activation-log", () => ({ recordActivationAttempt: vi.fn() }));
vi.mock("@/core/activation/connection-health", () => ({ resetHealthCache: vi.fn() }));
vi.mock("@/core/api/sync-relay", () => ({ canRelay: () => false, relayOp: vi.fn() }));
vi.mock("@/lib/backend-config", () => ({ backendUrl: f.backendRead, saveBackendUrl: f.saveBackend }));
vi.mock("@/lib/server-origin", () => ({ serverOrigin: () => backend, posFetch: f.posFetch, serverUnreachableOnDevice: f.missingWebsite }));
vi.mock("@/lib/terminal-session", () => ({ provisionTerminalAccount: vi.fn() }));

const config: TerminalConfig = {
  tokenId, deviceType: "pc", deviceUse: "operations", deviceBindingProof: proofHash, locationId: "store-a",
  locationName: "Store A", supabaseUrl: project, supabaseKey: localKey, backendUrl: backend, activatedAt: "2026-11-10T00:00:00.000Z",
};
const request = { tokenId, proofHash, deviceName: "Counter A" };
const approved = {
  approved: true, locationId: config.locationId, locationName: config.locationName, supabaseUrl: project,
  supabaseKey: "token-public-key", backendUrl: backend, expiresAt: "2000-01-01T00:00:00.000Z",
};

/** Real native binding/proof verifier, with the on-disk marker's actual subset. */
function retainedNative(previous: TerminalConfig) {
  let active: TerminalConfig | null = null;
  const marker = { tokenId: previous.tokenId, deviceType: previous.deviceType, deviceUse: previous.deviceUse, locationId: previous.locationId };
  const write = vi.fn((value: TerminalConfig) => { active = value; return { ok: true }; });
  const fetch = vi.fn(async () => Response.json({ approved: true, status: "used", supabaseUrl: project,
    terminal: { id: previous.tokenId, platform: "pc", mode: previous.deviceUse, branchId: previous.locationId } }));
  const terminalStore = { read: () => active, lastBinding: () => marker, wasProvisioned: () => true, write };
  const dependencies = { terminalStore, cloudCredentials: { read: () => ({ url: project, key: localKey }) },
    configStore: { getStrict: () => backend }, fetchImpl: fetch };
  f.read.mockImplementation(async () => ({ ok: true, config: active }));
  f.restore.mockImplementation((candidate: TerminalConfig) => nativeRestore(candidate, dependencies));
  return { write, fetch, active: () => active };
}

function retainedPlaintext(value: TerminalConfig) {
  vi.spyOn(window.localStorage, "getItem").mockImplementation(key => key === "pos.terminal.config" ? JSON.stringify(value) : null);
}

const stale = (): TerminalConfig => ({ ...config, tokenId: "71ff814e-8652-45f0-9e67-a0cd62251512", locationId: "store-old", deviceBindingProof: "b".repeat(64) });

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubGlobal("window", {
    dispatchEvent: f.event,
    localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() },
    pos: { readTerminalConfig: f.read, writeTerminalConfig: f.write, restoreTerminalConfig: f.restore, clearTerminalConfig: f.clear, bootstrapCloudCredentials: f.bootstrap },
  });
  f.bootstrap.mockResolvedValue({ ok: true, url: project, key: localKey });
  f.backendRead.mockResolvedValue(backend);
  f.read.mockResolvedValue({ ok: true, config });
  f.write.mockResolvedValue({ ok: true });
  f.restore.mockResolvedValue({ ok: true, config });
  f.clear.mockResolvedValue({ ok: true });
  f.seal.mockResolvedValue(undefined);
  f.missingWebsite.mockReturnValue(false);
  f.rpc.mockImplementation(async (name: string) => name === "terminal_token_status"
    ? { data: [{ status: "used", location_id: config.locationId, location_name: config.locationName }], error: null }
    : { data: true, error: null });
});
afterEach(() => vi.unstubAllGlobals());

it("publishes a manual claim only after Windows confirms its secure write and preserves the saved connection", async () => {
  const { activateTerminal, readTerminalConfig } = await import("../terminal-tokens");
  let confirm!: (value: { ok: true; config: TerminalConfig }) => void;
  f.read.mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }));
  const activation = activateTerminal("code");
  await vi.waitFor(() => expect(f.read).toHaveBeenCalledOnce());
  expect(readTerminalConfig()).toBeNull();
  expect(f.event).not.toHaveBeenCalled();
  expect(f.write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    tokenId, deviceBindingProof: proofHash, backendUrl: backend, supabaseKey: localKey,
  }));
  expect(f.restore).not.toHaveBeenCalled();
  expect(f.saveBackend).not.toHaveBeenCalled();
  confirm({ ok: true, config });
  await expect(activation).resolves.toEqual(config);
  expect(readTerminalConfig()).toEqual(config);
});

it("keeps a refused Windows save out of renderer registration and permits the same code to retry", async () => {
  const { activateTerminal, readTerminalConfig } = await import("../terminal-tokens");
  f.write.mockResolvedValueOnce({ ok: false, error: "Pending transactions must be reviewed first." });
  await expect(activateTerminal("code")).rejects.toThrow("Pending transactions");
  expect(readTerminalConfig()).toBeNull();
  expect(f.event).not.toHaveBeenCalled();
  expect(f.seal).not.toHaveBeenCalled();
  await expect(activateTerminal("code")).resolves.toEqual(config);
  const claims = f.rpc.mock.calls.filter(([name]) => name === "terminal_token_claim");
  expect(claims).toHaveLength(2);
  expect(claims[0][1].p_proof_hash).toBe(claims[1][1].p_proof_hash);
});

it("rejects a code for a different project before it contacts the claim service", async () => {
  const { activateTerminal } = await import("../terminal-tokens");
  f.bootstrap.mockResolvedValue({ ok: true, url: "https://other-project.example", key: localKey });
  await expect(activateTerminal("code")).rejects.toThrow("different database");
  expect(f.rpc).not.toHaveBeenCalled();
  expect(f.write).not.toHaveBeenCalled();
});

it("leaves a code unclaimed when the Windows connection still needs setup", async () => {
  const { activateTerminal } = await import("../terminal-tokens");
  f.bootstrap.mockResolvedValue({ ok: false });
  await expect(activateTerminal("code")).rejects.toThrow("Save the database URL and publishable key");
  expect(f.rpc).not.toHaveBeenCalled();
  expect(f.write).not.toHaveBeenCalled();
});

it("leaves a manual token unclaimed when the repair session expires during its status lookup", async () => {
  const { activateTerminal, ActivationError } = await import("../terminal-tokens");
  const beforeClaim = vi.fn(async () => { throw new ActivationError("Emergency Access authorization expired."); });
  await expect(activateTerminal("code", beforeClaim)).rejects.toThrow("Emergency Access authorization expired");
  expect(beforeClaim).toHaveBeenCalledOnce();
  expect(f.rpc.mock.calls.map(([name]) => name)).toEqual(["terminal_token_status"]);
  expect(f.write).not.toHaveBeenCalled(); expect(f.clearSeal).not.toHaveBeenCalled(); expect(f.seal).not.toHaveBeenCalled();
  expect(window.localStorage.removeItem).not.toHaveBeenCalled();
});

it.each(["project", "key", "backend"])("does not consume a manual repair token after the saved %s changes during status lookup", async changed => {
  const { activateTerminal } = await import("../terminal-tokens");
  const beforeClaim = vi.fn(async () => {
    if (changed === "backend") f.backendRead.mockResolvedValue("https://other-pos.example");
    else f.bootstrap.mockResolvedValue({ ok: true, url: changed === "project" ? "https://other-project.example" : project, key: changed === "key" ? "rotated-key" : localKey });
  });
  await expect(activateTerminal("code", beforeClaim)).rejects.toThrow(changed === "project" ? "different database" : "connection changed during activation");
  expect(f.rpc.mock.calls.map(([name]) => name)).toEqual(["terminal_token_status"]);
  expect(f.write).not.toHaveBeenCalled(); expect(f.seal).not.toHaveBeenCalled(); expect(f.clearSeal).not.toHaveBeenCalled();
  expect(window.localStorage.removeItem).not.toHaveBeenCalled(); expect(f.saveBackend).not.toHaveBeenCalled();
});

it("finishes a proof-bound web pairing after the first-claim deadline when this device already claimed it", async () => {
  const { activateWithTokenId } = await import("../terminal-tokens");
  f.posFetch.mockResolvedValueOnce(Response.json({ ...approved, status: "used" }));
  const onApproved = vi.fn();
  await expect(activateWithTokenId(request, onApproved)).resolves.toEqual(config);
  expect(onApproved).toHaveBeenCalledOnce();
  expect(f.rpc).toHaveBeenCalledWith("terminal_token_claim", expect.objectContaining({ p_token_id: tokenId, p_proof_hash: proofHash }));
  expect(f.write).toHaveBeenCalledOnce();
});

it("awaits native repair approval before consuming a hosted pairing claim", async () => {
  const { activateWithTokenId } = await import("../terminal-tokens");
  f.posFetch.mockResolvedValueOnce(Response.json({ ...approved, status: "used" }));
  let approve!: () => void;
  const onApproved = vi.fn(() => new Promise<void>(resolve => { approve = resolve; }));
  const pairing = activateWithTokenId(request, undefined, onApproved);
  await vi.waitFor(() => expect(onApproved).toHaveBeenCalledOnce());
  expect(f.rpc).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
  approve();
  await expect(pairing).resolves.toEqual(config);
  expect(f.rpc).toHaveBeenCalledWith("terminal_token_claim", expect.objectContaining({ p_token_id: tokenId }));
});

it("keeps the original setup and proof when the post-approval repair check refuses pairing", async () => {
  const { activateWithTokenId, ActivationError } = await import("../terminal-tokens");
  f.posFetch.mockResolvedValueOnce(Response.json({ ...approved, status: "used" }));
  await expect(activateWithTokenId(request, undefined, async () => { throw new ActivationError("Recovery authorization expired."); })).rejects.toThrow("Recovery authorization expired");
  expect(f.rpc).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled(); expect(f.clearSeal).not.toHaveBeenCalled();
  expect(f.seal).not.toHaveBeenCalled(); expect(f.saveBackend).not.toHaveBeenCalled(); expect(window.localStorage.removeItem).not.toHaveBeenCalled();
});

it("rechecks native repair authorization before retrying a pairing claim after a network failure", async () => {
  const { activateWithTokenId, ActivationError } = await import("../terminal-tokens");
  f.posFetch.mockResolvedValueOnce(Response.json({ ...approved, status: "used" }));
  f.rpc.mockResolvedValueOnce({ data: null, error: new TypeError("Failed to fetch") });
  const beforeClaim = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ActivationError("Emergency Access authorization expired."));
  await expect(activateWithTokenId(request, undefined, beforeClaim)).rejects.toThrow("Emergency Access authorization expired");
  expect(beforeClaim).toHaveBeenCalledTimes(2); expect(f.rpc).toHaveBeenCalledOnce();
  expect(f.write).not.toHaveBeenCalled(); expect(f.clearSeal).not.toHaveBeenCalled(); expect(f.seal).not.toHaveBeenCalled();
  expect(window.localStorage.removeItem).not.toHaveBeenCalled();
});

it.each(["project", "key", "backend"])("does not consume a pairing repair token after the saved %s changes before its claim", async changed => {
  const { activateWithTokenId } = await import("../terminal-tokens");
  f.posFetch.mockResolvedValueOnce(Response.json({ ...approved, status: "used" }));
  const beforeClaim = vi.fn(async () => {
    if (changed === "backend") f.backendRead.mockResolvedValue("https://other-pos.example");
    else f.bootstrap.mockResolvedValue({ ok: true, url: changed === "project" ? "https://other-project.example" : project, key: changed === "key" ? "rotated-key" : localKey });
  });
  await expect(activateWithTokenId(request, undefined, beforeClaim)).rejects.toThrow(changed === "project" ? "different database" : "connection changed during activation");
  expect(f.rpc).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled(); expect(f.seal).not.toHaveBeenCalled(); expect(f.clearSeal).not.toHaveBeenCalled();
  expect(window.localStorage.removeItem).not.toHaveBeenCalled(); expect(f.saveBackend).not.toHaveBeenCalled();
});

it("refuses a pairing claim retry against a captured backend after the operator changes it", async () => {
  const { activateWithTokenId } = await import("../terminal-tokens");
  f.posFetch.mockResolvedValueOnce(Response.json({ ...approved, status: "used" }));
  f.rpc.mockImplementationOnce(async () => {
    f.backendRead.mockResolvedValue("https://other-pos.example");
    return { data: null, error: new TypeError("Failed to fetch") };
  });
  const beforeClaim = vi.fn(async () => {});
  await expect(activateWithTokenId(request, undefined, beforeClaim)).rejects.toThrow("connection changed during activation");
  expect(beforeClaim).toHaveBeenCalledTimes(2); expect(f.rpc).toHaveBeenCalledOnce();
  expect(f.write).not.toHaveBeenCalled(); expect(f.clearSeal).not.toHaveBeenCalled(); expect(f.seal).not.toHaveBeenCalled();
  expect(window.localStorage.removeItem).not.toHaveBeenCalled(); expect(f.saveBackend).not.toHaveBeenCalled();
});

it("refuses expired unused approvals and shows a connection error when the website returns HTML", async () => {
  const { activateWithTokenId } = await import("../terminal-tokens");
  f.posFetch.mockResolvedValueOnce(Response.json({ ...approved, status: "active" }))
    .mockResolvedValueOnce(new Response("<html>Wrong site</html>"));
  await expect(activateWithTokenId(request)).rejects.toThrow("expired");
  await expect(activateWithTokenId(request)).rejects.toThrow("did not return a POS pairing response");
  expect(f.rpc).not.toHaveBeenCalled();
});

it("restores the verified Windows identity and claim proof ahead of an old renderer copy", async () => {
  const { hydrateTerminalConfig } = await import("../terminal-tokens");
  f.readSeal.mockResolvedValue({ ...config, tokenId: "older-renderer-token" });
  await expect(hydrateTerminalConfig()).resolves.toEqual(config);
  expect(f.write).not.toHaveBeenCalled();
  expect(f.restoreProof).toHaveBeenCalledWith(proofHash);
});

it("does not trust a renderer copy if Windows refuses to recover it", async () => {
  const { hydrateTerminalConfig, readTerminalConfig, isTerminalConfigHydrated } = await import("../terminal-tokens");
  f.read.mockResolvedValue({ ok: true, config: null });
  f.readSeal.mockResolvedValue(config);
  f.restore.mockResolvedValue({ ok: false });
  await expect(hydrateTerminalConfig()).rejects.toThrow("could not save the existing terminal activation");
  expect(isTerminalConfigHydrated()).toBe(false);
  expect(readTerminalConfig()).toBeNull();
  expect(f.event).not.toHaveBeenCalled();
  expect(window.localStorage.removeItem).not.toHaveBeenCalled();
  // A transient refusal must retry recovery with the same saved credentials.
  f.restore.mockResolvedValue({ ok: true, config });
  f.read.mockResolvedValueOnce({ ok: true, config: null }).mockResolvedValueOnce({ ok: true, config });
  await expect(hydrateTerminalConfig()).resolves.toEqual(config);
  expect(isTerminalConfigHydrated()).toBe(true);
  expect(f.write).not.toHaveBeenCalled();
  expect(f.restore).toHaveBeenCalledTimes(2);
});

it("uses only the narrow restore channel for signed-out retained registration recovery", async () => {
  const { hydrateTerminalConfig, readTerminalConfig } = await import("../terminal-tokens");
  f.read.mockResolvedValueOnce({ ok: true, config: null });
  f.readSeal.mockResolvedValue(config);
  f.write.mockResolvedValue({ ok: false, code: "PRIVILEGE_REQUIRED" });
  await expect(hydrateTerminalConfig()).resolves.toEqual(config);
  expect(readTerminalConfig()).toEqual(config);
  expect(f.restore).toHaveBeenCalledExactlyOnceWith(config);
  expect(f.read).toHaveBeenCalledTimes(2);
  expect(f.write).not.toHaveBeenCalled();
});

it("does not trust a successful restore reply without matching native read-back", async () => {
  const { hydrateTerminalConfig, readTerminalConfig, isTerminalConfigHydrated } = await import("../terminal-tokens");
  f.read.mockResolvedValueOnce({ ok: true, config: null }).mockResolvedValueOnce({ ok: true, config: { ...config, tokenId: "other-terminal" } });
  f.readSeal.mockResolvedValue(config);
  await expect(hydrateTerminalConfig()).rejects.toThrow("could not confirm");
  expect(isTerminalConfigHydrated()).toBe(false);
  expect(readTerminalConfig()).toBeNull();
  expect(f.clearSeal).not.toHaveBeenCalled();
});

it("retains evidence when an older native shell lacks the verified restore channel", async () => {
  const { hydrateTerminalConfig, isTerminalConfigHydrated } = await import("../terminal-tokens");
  Reflect.deleteProperty(window.pos!, "restoreTerminalConfig");
  f.read.mockResolvedValue({ ok: true, config: null });
  f.readSeal.mockResolvedValue(config);
  await expect(hydrateTerminalConfig()).rejects.toThrow("saved registration has not been removed");
  expect(isTerminalConfigHydrated()).toBe(false);
  expect(f.write).not.toHaveBeenCalled(); expect(f.clearSeal).not.toHaveBeenCalled();
});

it.each(["plaintext", "encrypted"] as const)("recovers the matching original registration when the %s retained copy is stale", async staleFormat => {
  const { hydrateTerminalConfig, readTerminalConfig } = await import("../terminal-tokens");
  const native = retainedNative(config);
  retainedPlaintext(staleFormat === "plaintext" ? stale() : config);
  f.readSeal.mockResolvedValue(staleFormat === "encrypted" ? stale() : config);
  await expect(hydrateTerminalConfig()).resolves.toEqual(config);
  expect(readTerminalConfig()).toEqual(config);
  expect(f.readSeal).toHaveBeenCalledExactlyOnceWith("terminal.config", true);
  expect(f.restore).toHaveBeenCalledTimes(staleFormat === "encrypted" ? 2 : 1);
  expect(native.fetch).toHaveBeenCalledOnce(); expect(native.write).toHaveBeenCalledOnce();
  expect(native.active()).toEqual(config);
  expect(f.write).not.toHaveBeenCalled(); expect(f.seal).not.toHaveBeenCalled();
  expect(f.clearSeal).not.toHaveBeenCalled(); expect(window.localStorage.removeItem).not.toHaveBeenCalled();
});

it("keeps both truly foreign retained bindings blocked by the real native verifier", async () => {
  const { hydrateTerminalConfig, isTerminalConfigHydrated } = await import("../terminal-tokens");
  const native = retainedNative(config);
  retainedPlaintext(stale());
  f.readSeal.mockResolvedValue({ ...stale(), tokenId: "81ff814e-8652-45f0-9e67-a0cd62251512" });
  await expect(hydrateTerminalConfig()).rejects.toMatchObject({ code: "EACTIVATION_RECOVERY_BINDING" });
  expect(f.restore).toHaveBeenCalledTimes(2);
  expect(native.fetch).not.toHaveBeenCalled(); expect(native.write).not.toHaveBeenCalled();
  expect(isTerminalConfigHydrated()).toBe(false);
  expect(f.event).not.toHaveBeenCalled(); expect(f.clearSeal).not.toHaveBeenCalled();
  expect(window.localStorage.removeItem).not.toHaveBeenCalled();
});

it("attempts identical retained copies only once even when their property order differs", async () => {
  const { hydrateTerminalConfig } = await import("../terminal-tokens");
  f.read.mockResolvedValue({ ok: true, config: null });
  retainedPlaintext(Object.fromEntries(Object.entries(config).reverse()) as TerminalConfig);
  f.readSeal.mockResolvedValue(config);
  f.restore.mockResolvedValue({ ok: false, code: "EACTIVATION_RECOVERY_BINDING", error: "Saved binding mismatch" });
  await expect(hydrateTerminalConfig()).rejects.toMatchObject({ code: "EACTIVATION_RECOVERY_BINDING" });
  expect(f.restore).toHaveBeenCalledOnce();
});

it.each(["EBADARG", "EACTIVATION_RECOVERY_BINDING", "EACTIVATION_RECOVERY_PROJECT", "EACTIVATION_RECOVERY_PROOF", "EACTIVATION_RECOVERY_VERIFY"])("may try one alternate retained copy after candidate-specific %s", async code => {
  const { hydrateTerminalConfig } = await import("../terminal-tokens");
  f.read.mockResolvedValueOnce({ ok: true, config: null }).mockResolvedValueOnce({ ok: true, config });
  retainedPlaintext(config); f.readSeal.mockResolvedValue(stale());
  f.restore.mockResolvedValueOnce({ ok: false, code, error: "Candidate refused" }).mockResolvedValueOnce({ ok: true, config });
  await expect(hydrateTerminalConfig()).resolves.toEqual(config);
  expect(f.restore).toHaveBeenCalledTimes(2);
  expect(f.write).not.toHaveBeenCalled(); expect(f.clearSeal).not.toHaveBeenCalled();
});

it.each(["EACTIVATION_CONTEXT_CHANGED", "EACTIVATION_STORE"])("does not try another copy after global %s", async code => {
  const { hydrateTerminalConfig, isTerminalConfigHydrated } = await import("../terminal-tokens");
  f.read.mockResolvedValue({ ok: true, config: null });
  retainedPlaintext(config); f.readSeal.mockResolvedValue(stale());
  f.restore.mockResolvedValueOnce({ ok: false, code, error: "Native context unavailable" });
  await expect(hydrateTerminalConfig()).rejects.toMatchObject({ code });
  expect(f.restore).toHaveBeenCalledOnce(); expect(isTerminalConfigHydrated()).toBe(false);
  expect(f.clearSeal).not.toHaveBeenCalled(); expect(window.localStorage.removeItem).not.toHaveBeenCalled();
});

it("stops after strict read-back fails instead of substituting a second retained registration", async () => {
  const { hydrateTerminalConfig } = await import("../terminal-tokens");
  f.read.mockResolvedValueOnce({ ok: true, config: null }).mockResolvedValueOnce({ ok: true, config: stale() });
  retainedPlaintext(stale()); f.readSeal.mockResolvedValue(config);
  await expect(hydrateTerminalConfig()).rejects.toMatchObject({ code: "EACTIVATION_STORE" });
  expect(f.restore).toHaveBeenCalledOnce(); expect(f.event).not.toHaveBeenCalled();
});

it("restores readable plaintext only after native proof verification when the encrypted copy is unreadable", async () => {
  const { hydrateTerminalConfig } = await import("../terminal-tokens");
  const native = retainedNative(config); retainedPlaintext(config);
  f.readSeal.mockRejectedValue(new Error("Private encrypted-copy error"));
  await expect(hydrateTerminalConfig()).resolves.toEqual(config);
  expect(native.fetch).toHaveBeenCalledOnce(); expect(native.write).toHaveBeenCalledOnce();
  expect(f.clearSeal).not.toHaveBeenCalled(); expect(window.localStorage.removeItem).not.toHaveBeenCalled();
});

it("retains unreadable encrypted evidence when the available plaintext cannot be verified", async () => {
  const { hydrateTerminalConfig } = await import("../terminal-tokens");
  const native = retainedNative(config); retainedPlaintext(stale());
  f.readSeal.mockRejectedValue(new Error("Private encrypted-copy error"));
  await expect(hydrateTerminalConfig()).rejects.toMatchObject({ code: "EACTIVATION_STORE" });
  expect(native.write).not.toHaveBeenCalled(); expect(f.clearSeal).not.toHaveBeenCalled();
  expect(window.localStorage.removeItem).not.toHaveBeenCalled();
});

it.each(["EACTIVATION_RECOVERY_PROJECT", "EACTIVATION_RECOVERY_PROOF", "EACTIVATION_RECOVERY_VERIFY"])("preserves deeper %s when another stale copy has only a binding mismatch", async code => {
  const { hydrateTerminalConfig } = await import("../terminal-tokens");
  f.read.mockResolvedValue({ ok: true, config: null }); retainedPlaintext(stale()); f.readSeal.mockResolvedValue(config);
  f.restore.mockResolvedValueOnce({ ok: false, code, error: "Matching identity needs recovery" })
    .mockResolvedValueOnce({ ok: false, code: "EACTIVATION_RECOVERY_BINDING", error: "Stale other identity" });
  await expect(hydrateTerminalConfig()).rejects.toMatchObject({ code });
  expect(f.restore).toHaveBeenCalledTimes(2);
});

it("does not propagate an unknown native diagnostic code or use it to bypass failure", async () => {
  const { hydrateTerminalConfig } = await import("../terminal-tokens");
  f.read.mockResolvedValue({ ok: true, config: null }); retainedPlaintext(stale()); f.readSeal.mockResolvedValue(config);
  f.restore.mockResolvedValue({ ok: false, code: "PRIVATE_UNKNOWN_VALUE", error: "Native refusal" });
  await expect(hydrateTerminalConfig()).rejects.toMatchObject({ code: "EACTIVATION_STORE" });
  expect(f.restore).toHaveBeenCalledOnce();
});

it.each(["refusal", "transport"] as const)("preserves a safe storage reason when the first native read has a %s failure", async failure => {
  const { hydrateTerminalConfig, isTerminalConfigHydrated } = await import("../terminal-tokens");
  if (failure === "refusal") f.read.mockResolvedValue({ ok: false, code: "EACTIVATION_STORE" });
  else f.read.mockRejectedValue(new Error("Private native transport detail"));
  retainedPlaintext(config); f.readSeal.mockResolvedValue(config);
  await expect(hydrateTerminalConfig()).rejects.toMatchObject({ code: "EACTIVATION_STORE" });
  expect(isTerminalConfigHydrated()).toBe(false);
  expect(f.readSeal).not.toHaveBeenCalled(); expect(f.restore).not.toHaveBeenCalled();
  expect(f.clearSeal).not.toHaveBeenCalled(); expect(window.localStorage.removeItem).not.toHaveBeenCalled();
});

it("stops candidate fallback after a native restore transport rejection", async () => {
  const { hydrateTerminalConfig } = await import("../terminal-tokens");
  f.read.mockResolvedValue({ ok: true, config: null }); retainedPlaintext(config); f.readSeal.mockResolvedValue(stale());
  f.restore.mockRejectedValue(new Error("Private native transport detail"));
  await expect(hydrateTerminalConfig()).rejects.toMatchObject({ code: "EACTIVATION_STORE" });
  expect(f.restore).toHaveBeenCalledOnce(); expect(f.event).not.toHaveBeenCalled();
});

it.each(["plaintext", "encrypted"] as const)("does not report fresh absence when the only retained %s artifact is malformed", async format => {
  const { hydrateTerminalConfig, isTerminalConfigHydrated } = await import("../terminal-tokens");
  f.read.mockResolvedValue({ ok: true, config: null });
  if (format === "plaintext") vi.spyOn(window.localStorage, "getItem").mockReturnValue("{broken-json");
  else f.readSeal.mockResolvedValue({});
  await expect(hydrateTerminalConfig()).rejects.toMatchObject({ code: "EBADARG" });
  expect(isTerminalConfigHydrated()).toBe(false); expect(f.restore).not.toHaveBeenCalled();
  expect(f.clearSeal).not.toHaveBeenCalled(); expect(window.localStorage.removeItem).not.toHaveBeenCalled();
});

it.each(["plaintext", "encrypted"] as const)("accepts a valid alternate only through native verification when the %s retained artifact is malformed", async format => {
  const { hydrateTerminalConfig } = await import("../terminal-tokens");
  const native = retainedNative(config);
  if (format === "plaintext") {
    vi.spyOn(window.localStorage, "getItem").mockReturnValue("{broken-json"); f.readSeal.mockResolvedValue(config);
  } else {
    retainedPlaintext(config); f.readSeal.mockResolvedValue({});
  }
  await expect(hydrateTerminalConfig()).resolves.toEqual(config);
  expect(native.fetch).toHaveBeenCalledOnce(); expect(native.write).toHaveBeenCalledOnce();
  expect(f.clearSeal).not.toHaveBeenCalled(); expect(window.localStorage.removeItem).not.toHaveBeenCalled();
});

it("keeps the renderer identity and sealed copies when native clearing refuses stale context", async () => {
  const { hydrateTerminalConfig, clearTerminalConfig, readTerminalConfig } = await import("../terminal-tokens");
  await hydrateTerminalConfig();
  f.clear.mockResolvedValue({ ok: false, code: "EACTIVATION_CONTEXT_CHANGED" });
  await expect(clearTerminalConfig({ config, reason: "missing", verificationProjectUrl: project }))
    .rejects.toMatchObject({ code: "EACTIVATION_CONTEXT_CHANGED" });
  expect(readTerminalConfig()).toEqual(config);
  expect(f.clearSeal).not.toHaveBeenCalled();
  expect(window.localStorage.removeItem).not.toHaveBeenCalled();
});

it("does not erase a fresh activation when an earlier clear reply arrives late", async () => {
  const { hydrateTerminalConfig, clearTerminalConfig, readTerminalConfig, writeTerminalConfig } = await import("../terminal-tokens");
  await hydrateTerminalConfig();
  let finish!: (result: { ok: true }) => void;
  f.clear.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const clearing = clearTerminalConfig({ config, reason: "revoked", verificationProjectUrl: project });
  const replacement = { ...config, tokenId: "replacement-token", locationId: "store-b" };
  writeTerminalConfig(replacement);
  finish({ ok: true });
  await expect(clearing).rejects.toMatchObject({ code: "EACTIVATION_CONTEXT_CHANGED" });
  expect(readTerminalConfig()).toEqual(replacement);
  expect(f.clearSeal).not.toHaveBeenCalled();
  expect(window.localStorage.removeItem).not.toHaveBeenCalled();
});

it("clears both sealed registration copies only after the matching native clear succeeds", async () => {
  const { hydrateTerminalConfig, clearTerminalConfig, readTerminalConfig } = await import("../terminal-tokens");
  await hydrateTerminalConfig();
  await clearTerminalConfig({ config, reason: "revoked", verificationProjectUrl: project });
  expect(f.clear).toHaveBeenCalledExactlyOnceWith({ tokenId, projectUrl: project, reason: "revoked", verificationProjectUrl: project });
  expect(readTerminalConfig()).toBeNull();
  expect(f.clearSeal).toHaveBeenCalledWith("terminal.config");
  expect(f.clearSeal).toHaveBeenCalledWith("activation.record.v1");
});
