import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TerminalConfig } from "../terminal-tokens";

const f = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  seal: vi.fn(),
  readSeal: vi.fn(),
  rpc: vi.fn(),
  posFetch: vi.fn(),
  missingWebsite: vi.fn(),
  saveBackend: vi.fn(),
  restoreProof: vi.fn(),
  event: vi.fn(),
  bootstrap: vi.fn(),
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
vi.mock("@/lib/device-secrets", () => ({ clearDeviceSecret: vi.fn(), getDeviceSecret: f.readSeal, setDeviceSecret: f.seal }));
vi.mock("@/core/activation/device-proof", () => ({
  deviceProofHash: async () => proofHash, restoreVerifiedDesktopDeviceProof: f.restoreProof,
}));
vi.mock("@/core/activation/terminal-activation-log", () => ({ recordActivationAttempt: vi.fn() }));
vi.mock("@/core/activation/connection-health", () => ({ resetHealthCache: vi.fn() }));
vi.mock("@/core/api/sync-relay", () => ({ canRelay: () => false, relayOp: vi.fn() }));
vi.mock("@/lib/backend-config", () => ({ backendUrl: async () => backend, saveBackendUrl: f.saveBackend }));
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

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubGlobal("window", {
    dispatchEvent: f.event,
    localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() },
    pos: { readTerminalConfig: f.read, writeTerminalConfig: f.write, bootstrapCloudCredentials: f.bootstrap },
  });
  f.bootstrap.mockResolvedValue({ ok: true, url: project, key: localKey });
  f.read.mockResolvedValue({ ok: true, config });
  f.write.mockResolvedValue({ ok: true });
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

it("finishes a proof-bound web pairing after the first-claim deadline when this device already claimed it", async () => {
  const { activateWithTokenId } = await import("../terminal-tokens");
  f.posFetch.mockResolvedValueOnce(Response.json({ ...approved, status: "used" }));
  const onApproved = vi.fn();
  await expect(activateWithTokenId(request, onApproved)).resolves.toEqual(config);
  expect(onApproved).toHaveBeenCalledOnce();
  expect(f.rpc).toHaveBeenCalledWith("terminal_token_claim", expect.objectContaining({ p_token_id: tokenId, p_proof_hash: proofHash }));
  expect(f.write).toHaveBeenCalledOnce();
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
  const { hydrateTerminalConfig, readTerminalConfig } = await import("../terminal-tokens");
  f.read.mockResolvedValue({ ok: true, config: null });
  f.readSeal.mockResolvedValue(config);
  f.write.mockResolvedValue({ ok: false });
  await expect(hydrateTerminalConfig()).resolves.toBeNull();
  expect(readTerminalConfig()).toBeNull();
  expect(f.event).not.toHaveBeenCalled();
});
