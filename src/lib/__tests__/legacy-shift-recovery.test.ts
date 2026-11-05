import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { normalizeLegacyPayload, normalizeLegacyRecovery, legacyRecoveryMessage, MAX_UPLOAD_BYTES } from "../../../electron/security/legacy-shift-recovery-protocol.cjs";
const mocks = vi.hoisted(() => ({ rest: vi.fn(), authority: vi.fn() }));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: mocks.rest }));
vi.mock("../desktop-database-authority.server", () => ({ databaseAuthority: mocks.authority }));
vi.mock("../external-supabase-config", () => ({ supabaseConfig: () => ({ url: "https://project.fixture", key: "public-fixture" }) }));
import { verifyLegacyShiftRecovery } from "../legacy-shift-recovery.server";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const terminal = uuid(1), author = uuid(2), shift = uuid(3), recovery = uuid(4), keyId = uuid(5), branch = uuid(6);
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const pair = generateKeyPairSync("ed25519");
const publicKey = pair.publicKey.export({ type: "spki", format: "der" }).toString("base64url");
function request() {
  const payload = normalizeLegacyPayload({ version: 1, recoveryId: recovery, branchId: branch, terminalId: terminal, shiftId: shift,
    evidenceHash: hash("[]"), cloudWitnessHash: hash("[]"), reason: "Review original saved closing", localGraphText: "[]", cloudGraphText: "[]", financialVerification: "UNVERIFIED_HISTORICAL" });
  const payloadJson = JSON.stringify(payload);
  const unsigned = { version: 1, algorithm: "Ed25519", keyId, projectOrigin: "https://project.fixture", terminalId: terminal, authorId: author,
    subject: "reviewer-admin", branchId: branch, shiftId: shift, recoveryId: recovery, action: "LEGACY_CLOSING_RECOVERY_V1", payloadHash: hash(payloadJson) };
  return { terminal: { id: terminal, platform: "pc" as const, mode: "operations" as const, branchId: branch }, branchId: branch, payloadJson,
    attestation: { ...unsigned, signature: sign(null, Buffer.from(legacyRecoveryMessage(unsigned)), pair.privateKey).toString("base64url") } };
}
beforeEach(() => {
  mocks.rest.mockReset().mockResolvedValue(Response.json({ terminal_enrolled: true, key: { key_id: keyId, author_id: author, terminal_id: terminal,
    project_origin: "https://project.fixture", public_key: publicKey, subject: "reviewer-admin", revoked_at: null } }));
  mocks.authority.mockReset().mockResolvedValue({ level: "admin", authorId: author, subject: "reviewer-admin", branchId: branch, permissions: {} });
});
describe("separate legacy-review author domain", () => {
  it("verifies current actual administrator without pretending the admin was the cashier", async () => {
    const result = await verifyLegacyShiftRecovery(request()); expect(result.authority.allowed).toBe(true); expect(result.attestation.action).toBe("LEGACY_CLOSING_RECOVERY_V1");
    const { signature: _signature, ...unsigned } = result.attestation;
    expect(legacyRecoveryMessage(unsigned)).toContain("retail-pos.shift-author.legacy-recovery.v1");
  });
  it("rejects ORIGINAL domain, malformed signatures and extra trust flags", () => {
    const r = request(); expect(() => normalizeLegacyRecovery({ ...r.attestation, action: "ORIGINAL" })).toThrow();
    expect(() => normalizeLegacyRecovery({ ...r.attestation, signature: "A".repeat(85) })).toThrow();
    expect(() => normalizeLegacyRecovery({ ...r.attestation, allowed: true })).toThrow();
  });
  it.each(["staff", "supervisor"])("does not upgrade %s through a permission checkbox", async level => {
    mocks.authority.mockResolvedValue({ level, authorId: author, subject: "reviewer-admin", branchId: branch, permissions: { can_shift_cash_recount: true } });
    expect((await verifyLegacyShiftRecovery(request())).authority.allowed).toBe(false);
  });
  it("revocation holds NEW work but retains verified signature for genuine receipt replay", async () => {
    mocks.rest.mockResolvedValue(Response.json({ terminal_enrolled: true, key: { key_id: keyId, author_id: author, terminal_id: terminal, project_origin: "https://project.fixture", public_key: publicKey, subject: "reviewer-admin", revoked_at: "2026-01-01Z" } }));
    expect((await verifyLegacyShiftRecovery(request())).authority.allowed).toBe(false);
  });
  it("rejects other branch, mobile and management devices before a key read", async () => {
    for (const override of [{ branchId: uuid(9) }, { platform: "mobile" }, { mode: "management" }]) {
      const r = request(); await expect(verifyLegacyShiftRecovery({ ...r, terminal: { ...r.terminal, ...override } } as never)).rejects.toMatchObject({ code: "ELEGACY_RECOVERY_INVALID" });
    }
    expect(mocks.rest).not.toHaveBeenCalled();
  });
  it("rejects payload changes and forged key/actor binding", async () => {
    const r = request(); await expect(verifyLegacyShiftRecovery({ ...r, payloadJson: r.payloadJson + " " })).rejects.toThrow();
    r.attestation.subject = "claimed-cashier"; await expect(verifyLegacyShiftRecovery(r)).rejects.toThrow();
  });
  it("network failure is unavailable, not false signature denial or discarded work", async () => {
    mocks.rest.mockRejectedValue(Error("private network detail")); await expect(verifyLegacyShiftRecovery(request())).rejects.toMatchObject({ code: "ELEGACY_RECOVERY_UNAVAILABLE", status: 503 });
  });
  it("malformed registry availability is separate from a valid absent-key denial", async () => {
    mocks.rest.mockResolvedValueOnce(new Response("upstream is unavailable", { status: 200 }));
    await expect(verifyLegacyShiftRecovery(request())).rejects.toMatchObject({ code: "ELEGACY_RECOVERY_UNAVAILABLE", status: 503 });
    mocks.rest.mockResolvedValueOnce(Response.json({ key: null }));
    await expect(verifyLegacyShiftRecovery(request())).rejects.toMatchObject({ code: "ELEGACY_RECOVERY_INVALID", status: 403 });
  });
  it("bounds upload separately from larger retained evidence and refuses invented financial verification", () => {
    const r = JSON.parse(request().payloadJson); expect(() => normalizeLegacyPayload({ ...r, reason: "x".repeat(MAX_UPLOAD_BYTES) })).toThrow();
    expect(() => normalizeLegacyPayload({ ...r, financialVerification: "VERIFIED" })).toThrow();
  });
});
