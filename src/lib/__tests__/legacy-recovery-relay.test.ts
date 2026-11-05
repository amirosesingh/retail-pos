import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { legacyRecoveryMessage } from "../../../electron/security/legacy-shift-recovery-protocol.cjs";

vi.mock("../external-supabase-config", () => ({
  runtimeEnvValue: () => "test-service", supabaseConfig: () => ({ url: "https://cloud.test", key: "test-public" }),
}));
import { handleSyncRequest } from "../sync-endpoint.server";

const terminal = "00000000-0000-4000-8000-000000000001";
const branch = "00000000-0000-4000-8000-00000000000a";
const foreign = "00000000-0000-4000-8000-00000000000b";
const shift = "00000000-0000-4000-8000-000000000003";
const recovery = "00000000-0000-4000-8000-000000000004";
const author = "00000000-0000-4000-8000-000000000007";
const keyId = "00000000-0000-4000-8000-000000000008";
const bindingProof = "a".repeat(64);
const pair = generateKeyPairSync("ed25519");
const publicKey = pair.publicKey.export({ type: "spki", format: "der" }).toString("base64url");
const hash = (raw: string) => createHash("sha256").update(raw, "utf8").digest("hex");
function envelope() {
  // The relay preserves the reviewed graph bytes; SQL owns graph admission.
  const localGraphText = '[{"table":"shifts","rows":[{"counted_cash":123.4567890123456789}]}]';
  const cloudGraphText = "[]";
  const payloadJson = JSON.stringify({ version: 1, recoveryId: recovery, branchId: branch, terminalId: terminal, shiftId: shift,
    evidenceHash: hash(localGraphText), cloudWitnessHash: hash(cloudGraphText), reason: "Reviewed saved historical closing",
    localGraphText, cloudGraphText, financialVerification: "UNVERIFIED_HISTORICAL" });
  const unsigned = { version: 1, algorithm: "Ed25519", keyId, projectOrigin: "https://cloud.test", terminalId: terminal,
    authorId: author, subject: "reviewing-admin", branchId: branch, shiftId: shift, recoveryId: recovery,
    action: "LEGACY_CLOSING_RECOVERY_V1", payloadHash: hash(payloadJson) };
  return { organizationId: "default", branchId: branch, payloadJson,
    attestation: { ...unsigned, signature: sign(null, Buffer.from(legacyRecoveryMessage(unsigned)), pair.privateKey).toString("base64url") } };
}
let active: boolean, registryStatus: number, authorRole: string, authorBranch: string | null, authorActive: boolean, keyRevoked: boolean;
const rpc = vi.fn();
beforeEach(() => {
  active = true; registryStatus = 200; authorRole = "admin"; authorBranch = branch; authorActive = true; keyRevoked = false; rpc.mockClear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes("/terminal_tokens?")) return Response.json([{ id: terminal, platform: "pc", status: active ? "used" : "revoked",
      location_id: branch, is_claimed: true, claim_proof: bindingProof }], { status: registryStatus });
    if (url.includes("/stores?")) return Response.json([{ id: branch }]);
    if (url.includes("/app_users?")) return Response.json([{ id: author, user_id: "reviewing-admin", role: authorRole,
      role_slug: authorRole, store_id: authorBranch, is_active: authorActive, permissions: {} }]);
    if (url.includes("/rpc/pos_shift_author_key")) return Response.json({ key: { key_id: keyId, author_id: author, terminal_id: terminal,
      project_origin: "https://cloud.test", public_key: publicKey, subject: "reviewing-admin", revoked_at: keyRevoked ? "2026-11-05T00:00:00Z" : null } });
    if (url.includes("/rpc/")) { rpc(url, JSON.parse(String(options?.body))); return Response.json({ ok: true, recovery_id: recovery }); }
    throw new Error(`Unexpected isolated URL: ${url}`);
  }));
});
const request = (body: object, proof = bindingProof) => handleSyncRequest(new Request("https://pos.test/api/v1/pos/sync", {
  method: "POST", headers: { "x-pos-legacy-recovery": "1" }, body: JSON.stringify({ terminalToken: terminal, deviceBindingProof: proof, ...body }),
}));

describe("legacy recovery through actual native relay guards", () => {
  it("keeps the signed raw graph and dispatches only the separate recovery RPC", async () => {
    const input = envelope();
    expect((await request({ sqlServerLegacyRecovery: input })).status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("/rpc/pos_sync_recover_legacy_closing"), {
      p_organization_id: "default", p_branch_id: branch, p_terminal_id: terminal, p_payload_json: input.payloadJson,
      p_attestation: input.attestation, p_authority: { allowed: true, authorId: author, subject: "reviewing-admin" },
    });
  });
  it("does not require a later background cashier to impersonate the reviewing administrator", async () => {
    // Device authentication + frozen enrolled author proof is sufficient; no
    // renderer role, subject or uploader identity is used as review authority.
    expect((await request({ sqlServerLegacyRecovery: envelope() })).status).toBe(200);
    expect(rpc.mock.calls[0][1].p_authority.allowed).toBe(true);
  });
  it.each(["staff", "manager"])("a reviewer now having role %s gets receipt-only admission", async role => {
    authorRole = role;
    expect((await request({ sqlServerLegacyRecovery: envelope() })).status).toBe(200);
    expect(rpc.mock.calls[0][1].p_authority.allowed).toBe(false);
  });
  it.each(["inactive", "revoked-key", "other-branch"])("holds new writes after %s, preserving exact-receipt replay", async condition => {
    if (condition === "inactive") authorActive = false;
    if (condition === "revoked-key") keyRevoked = true;
    if (condition === "other-branch") authorBranch = foreign;
    expect((await request({ sqlServerLegacyRecovery: envelope() })).status).toBe(200);
    expect(rpc.mock.calls[0][1].p_authority.allowed).toBe(false);
  });
  it("rejects changed raw bytes, forged signatures and a different signed branch before RPC", async () => {
    for (const kind of ["bytes", "signature", "branch"]) {
      const input = envelope();
      if (kind === "bytes") input.payloadJson += " ";
      if (kind === "signature") input.attestation.signature = "A".repeat(86);
      if (kind === "branch") input.attestation.branchId = foreign;
      expect((await request({ sqlServerLegacyRecovery: input })).status).toBe(403);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects another branch, invalid device proof and revoked registration", async () => {
    expect((await request({ sqlServerLegacyRecovery: { ...envelope(), branchId: foreign } })).status).toBe(403);
    expect((await request({ sqlServerLegacyRecovery: envelope() }, "b".repeat(64))).status).toBe(401);
    active = false;
    expect((await request({ sqlServerLegacyRecovery: envelope() })).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("reports a verification outage separately from an authorization denial", async () => {
    registryStatus = 503;
    expect((await request({ sqlServerLegacyRecovery: envelope() })).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects mixed operations and an oversized payload before verification", async () => {
    expect((await request({ sqlServerLegacyRecovery: envelope(), read: { kind: "health" } })).status).toBe(400);
    expect((await request({ sqlServerLegacyRecovery: { ...envelope(), payloadJson: " ".repeat(256 * 1024 + 1) } })).status).toBe(413);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("bounds declared and streamed UTF-8 wire bytes before JSON/authentication work", async () => {
    const declared = await handleSyncRequest(new Request("https://pos.test/api/v1/pos/sync", { method: "POST",
      headers: { "x-pos-legacy-recovery": "1", "content-length": String(256 * 1024 + 1) }, body: "{}" }));
    expect(declared.status).toBe(413);
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(100 * 1024)); }, cancel() { cancelled = true; } });
    const streamed = await handleSyncRequest(new Request("https://pos.test/api/v1/pos/sync", { method: "POST", headers: { "x-pos-legacy-recovery": "1" },
      body: stream, duplex: "half" } as RequestInit));
    expect(streamed.status).toBe(413); expect(cancelled).toBe(true); expect(rpc).not.toHaveBeenCalled();
  });
  it("requires bounded transport for the new operation without changing ordinary sync limits", async () => {
    const response = await handleSyncRequest(new Request("https://pos.test/api/v1/pos/sync", { method: "POST", body: JSON.stringify({
      terminalToken: terminal, deviceBindingProof: bindingProof, sqlServerLegacyRecovery: envelope(),
    }) }));
    expect(response.status).toBe(400); expect(rpc).not.toHaveBeenCalled();
  });
});
