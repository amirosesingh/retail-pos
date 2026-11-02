import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { enrollmentMessage, intentMessage, closingStartMessage } from "../../../electron/security/shift-author-protocol.cjs";

const h = vi.hoisted(() => ({ fetch: vi.fn(), touch: vi.fn() }));
vi.stubGlobal("fetch", h.fetch);
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => ({ options }) }));
vi.mock("../external-supabase-config", () => ({ runtimeEnvValue: () => "fixture-service-key", supabaseConfig: () => ({ url: "https://project.fixture", key: "fixture-public" }) }));
vi.mock("../session-guard.server", () => ({ touchSession: h.touch }));
import { Route } from "@/routes/api/v1/pos/shift-author-enroll";
import { enrollShiftAuthor, verifyShiftAuthorAttestation, readShiftAuthorAuthority, requireCurrentShiftAuthorPermission, shiftAuthorTerminalEnrolled, verifyShiftClosingStart, readShiftClosingStartAuthority } from "../shift-author-verification.server";
import { signCashierSession } from "../pos-session.server";

const authorId = "00000000-0000-4000-8000-000000000001", otherId = "00000000-0000-4000-8000-000000000002";
const keyId = "00000000-0000-4000-8000-000000000003", terminalId = "00000000-0000-4000-8000-000000000004";
const shiftId = "00000000-0000-4000-8000-000000000005", intentId = "00000000-0000-4000-8000-000000000006";
const descriptor = { id: terminalId, platform: "pc" as const, mode: "operations" as const, branchId: "A" };
const proof = "a".repeat(64);
let pair: CryptoKeyPair, publicKey: string, saved: Record<string, unknown> | null;
let person: Record<string, unknown>, terminal: Record<string, unknown>, outage: boolean;
const encode = (data: ArrayBuffer) => Buffer.from(data).toString("base64url");
const sign = async (message: string) => encode(await crypto.subtle.sign("Ed25519", pair.privateKey, new TextEncoder().encode(message)));
const enrollment = () => ({ version: 1 as const, algorithm: "Ed25519" as const, keyId, authorId, projectOrigin: "https://project.fixture", terminalId, publicKey });
const credentials = () => ({ sessionToken: "raw-person-session", cashierToken: signCashierSession({ id: authorId, username: "cashier", storeId: "A", sessionToken: "raw-person-session" }), terminalToken: terminalId, deviceBindingProof: proof });
const request = async () => ({ ...credentials(), enrollment: enrollment(), signature: await sign(enrollmentMessage(enrollment())) });
const payloadJson = '{"version":1,"intentId":"fixture"}';
async function attestation(action: "ORIGINAL" | "RECOUNT" | "VARIANCE" = "ORIGINAL") {
  const payloadHash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payloadJson))).toString("hex");
  const unsigned = { version: 1 as const, algorithm: "Ed25519" as const, keyId, authorId, subject: "cashier", projectOrigin: "https://project.fixture", terminalId, branchId: "A", shiftId, intentId, action, payloadHash };
  return { ...unsigned, signature: await sign(intentMessage(unsigned)) };
}
const verify = (value: unknown, extras = {}) => verifyShiftAuthorAttestation({ attestation: value, payloadJson, terminal: descriptor, branchId: "A", shiftId, intentId, action: "ORIGINAL", ...extras });
async function startProof() {
  const { action: _action, intentId: _id, signature: _signature, ...fields } = await attestation();
  const unsigned = { ...fields, eventId: intentId, payloadJson };
  return { ...unsigned, signature: await sign(closingStartMessage(unsigned)) };
}
const verifyStart = (proof: unknown) => verifyShiftClosingStart({ proof, terminal: descriptor, branchId: "A", shiftId });
const handler = (Route as unknown as { options: { server: { handlers: { POST: (input: { request: Request }) => Promise<Response> } } } }).options.server.handlers.POST;
beforeAll(async () => {
  pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]) as CryptoKeyPair;
  publicKey = encode(await crypto.subtle.exportKey("spki", pair.publicKey));
});
describe("separate closing-start signature domain", () => {
  it("verifies immutable history after revocation but requires the existing close flag for new work", async () => {
    await enrollShiftAuthor(await request()); const value = await startProof();
    expect(await verifyStart(value)).toEqual(value);
    expect(await readShiftClosingStartAuthority(value)).toMatchObject({ allowed: false });
    person.permissions = { can_close_shift: true };
    expect(await readShiftClosingStartAuthority(value)).toMatchObject({ allowed: true });
    saved!.revoked_at = "2026-11-02T00:00:00Z";
    expect(await verifyStart(value)).toEqual(value);
    expect(await readShiftClosingStartAuthority(value)).toMatchObject({ allowed: false });
  });
  it("rejects intent-domain signatures, changed bytes and foreign actor/scope/event headers", async () => {
    await enrollShiftAuthor(await request()); const value = await startProof();
    for (const patch of [{ signature: (await attestation()).signature }, { payloadJson: payloadJson + " " }, { authorId: otherId },
      { eventId: shiftId }, { branchId: "B" }, { terminalId: otherId }, { projectOrigin: "https://other.fixture" }, { invented: true }])
      await expect(verifyStart({ ...value, ...patch })).rejects.toMatchObject({ code: "ESHIFT_AUTHOR_INVALID" });
  });
});
beforeEach(() => {
  vi.stubEnv("SETTINGS_ENCRYPTION_KEY", "isolated-author-fixture-only");
  saved = null; outage = false;
  person = { id: authorId, user_id: "cashier", auth_user_id: "auth-cashier", full_name: "Cashier", role: "staff", role_slug: "cashier", store_id: "A", is_active: true, permissions: { can_process_sale: true, can_shift_cash_count: true, can_close_shift: false, can_shift_cash_recount: false, can_shift_variance_approve: false } };
  terminal = { id: terminalId, platform: "pc", status: "used", location_id: "A", is_claimed: true, revoked_at: null, claim_proof: proof, claimed_platform: "electron" };
  h.touch.mockReset().mockResolvedValue({ ok: true, session: { kind: "cashier", staff_user_id: "cashier", label: "Cashier", branch_id: "A", terminal_id: terminalId } });
  h.fetch.mockReset().mockImplementation(async (url: string, options?: RequestInit) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/terminal_tokens")) return Response.json([terminal]);
    if (parsed.pathname.endsWith("/auth/v1/user")) return Response.json({ id: "auth-cashier", email: "cashier@example.test" });
    if (parsed.pathname.endsWith("/app_users")) {
      if (outage) return Response.json({}, { status: 503 });
      const match = ["id", "user_id", "auth_user_id"].every(field => !parsed.searchParams.has(field) || parsed.searchParams.get(field) === `eq.${person[field]}`);
      return Response.json(match ? [person] : []);
    }
    if (parsed.pathname.endsWith("/rpc/pos_shift_author_enroll")) {
      const body = JSON.parse(String(options?.body));
      const candidate = body.p_enrollment;
      if (saved && (saved.key_id !== candidate.keyId || saved.public_key !== candidate.publicKey)) return Response.json({ message: "SHIFT_AUTHOR_KEY_MISMATCH" }, { status: 409 });
      saved = { key_id: candidate.keyId, author_id: candidate.authorId, terminal_id: candidate.terminalId, project_origin: candidate.projectOrigin, subject: body.p_subject, public_key: candidate.publicKey, revoked_at: null };
      return Response.json({ ok: true });
    }
    if (parsed.pathname.endsWith("/rpc/pos_shift_author_key")) return Response.json({ terminal_enrolled: saved !== null, key: saved });
    throw new Error("Unexpected isolated fixture endpoint");
  });
});
afterAll(() => vi.unstubAllEnvs());

describe("verified personal author enrollment", () => {
  it("enrolls the same actual PIN author without granting new permissions and replays the same public key", async () => {
    const input = await request();
    expect(await enrollShiftAuthor(input)).toMatchObject({ ok: true, enrolled: true, authorId, subject: "cashier", publicKey });
    expect(await enrollShiftAuthor(input)).not.toHaveProperty("permissions");
    expect(person.permissions).toMatchObject({ can_shift_cash_recount: false });
    expect(await shiftAuthorTerminalEnrolled(terminalId)).toBe(true);
  });
  it("rejects leaked terminal transport proof and an arbitrary other target author", async () => {
    const input = await request();
    await expect(enrollShiftAuthor({ ...input, sessionToken: undefined, cashierToken: undefined })).rejects.toMatchObject({ code: "ESHIFT_AUTHOR_INVALID" });
    const other = { ...input.enrollment, authorId: otherId };
    await expect(enrollShiftAuthor({ ...input, enrollment: other, signature: await sign(enrollmentMessage(other)) })).rejects.toMatchObject({ code: "ESHIFT_AUTHOR_INVALID" });
    expect(saved).toBeNull();
  });
  it("keeps raw-session-only setup pending and cannot map a recycled username to a different profile", async () => {
    const input = await request();
    await expect(enrollShiftAuthor({ ...input, cashierToken: undefined })).rejects.toMatchObject({ code: "ESHIFT_AUTHOR_IDENTITY_PENDING" });
    person.id = otherId;
    await expect(enrollShiftAuthor(input)).rejects.toMatchObject({ code: "ESHIFT_AUTHOR_INVALID" });
    expect(saved).toBeNull();
  });
  it("supports an exact password Auth proof and authorized Management enrollment without an action grant", async () => {
    person.store_id = null;
    person.permissions = { can_use_management_pc: true };
    terminal.location_id = null; terminal.management_sync_enabled = true; terminal.management_registration = true;
    h.touch.mockResolvedValue({ ok: true, session: { kind: "staff", staff_user_id: "cashier", branch_id: null, terminal_id: terminalId } });
    const input = await request();
    expect(await enrollShiftAuthor({ ...input, sessionToken: undefined, cashierToken: undefined, accessToken: "verified-auth" })).toMatchObject({ ok: true, authorId });
    expect(person.permissions).not.toHaveProperty("can_shift_cash_recount");
  });
  it.each(["signature", "projectOrigin", "terminalId", "publicKey"])("rejects substituted %s and unknown wire fields", async field => {
    const input = await request();
    if (field === "signature") input.signature = "A".repeat(86);
    else (input.enrollment as Record<string, unknown>)[field] = field === "projectOrigin" ? "https://other.fixture" : field === "terminalId" ? "other-terminal" : "A".repeat(59);
    await expect(enrollShiftAuthor(input)).rejects.toBeDefined();
    await expect(enrollShiftAuthor({ ...await request(), authorId: otherId })).rejects.toMatchObject({ status: 400 });
    expect(saved).toBeNull();
  });
  it("retains a mismatched replacement key for explicit review", async () => {
    await enrollShiftAuthor(await request());
    const original = { ...saved };
    const input = await request(); input.enrollment.keyId = otherId; input.signature = await sign(enrollmentMessage(input.enrollment));
    await expect(enrollShiftAuthor(input)).rejects.toMatchObject({ code: "ESHIFT_AUTHOR_KEY_MISMATCH", status: 409 });
    expect(saved).toEqual(original);
  });
  it("rejects a noncanonical signature alias even when it decodes to the same bytes", async () => {
    const input = await request();
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const last = alphabet.indexOf(input.signature.at(-1)!);
    input.signature = input.signature.slice(0, -1) + alphabet[last + 1];
    await expect(enrollShiftAuthor(input)).rejects.toMatchObject({ code: "ESHIFT_AUTHOR_INVALID" });
    expect(saved).toBeNull();
  });
  it("bounds actual HTTP request bytes and sanitizes failed author verification", async () => {
    const response = await handler({ request: new Request("https://backend.fixture/api/v1/pos/shift-author-enroll", { method: "POST", body: JSON.stringify(await request()) }) });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ enrolled: true, publicKey });
    const large = await handler({ request: new Request("https://backend.fixture/api/v1/pos/shift-author-enroll", { method: "POST", body: "x".repeat(12001) }) });
    expect(large.status).toBe(413);
  });
});

describe("historical signature proof and current action authority are separate", () => {
  it("verifies exact frozen bytes and holds tampering or a foreign branch", async () => {
    await enrollShiftAuthor(await request()); const signed = await attestation();
    expect(await verify(signed)).toEqual(signed);
    await expect(verify(signed, { payloadJson: payloadJson + " " })).rejects.toMatchObject({ code: "ESHIFT_AUTHOR_INVALID" });
    await expect(verify(signed, { branchId: "B" })).rejects.toBeDefined();
    await expect(verify({ ...signed, action: "RECOUNT" })).rejects.toBeDefined();
    await expect(verify({ ...signed, authorId: otherId })).rejects.toBeDefined();
    const renamed = { ...signed, subject: "renamed-or-login-alias" };
    const { signature: _oldSignature, ...unsigned } = renamed;
    renamed.signature = await sign(intentMessage(unsigned));
    await expect(verify(renamed)).rejects.toMatchObject({ code: "ESHIFT_AUTHOR_INVALID" });
  });
  it("keeps original-only cashier grants narrow and checks page flags and new grants live", async () => {
    await enrollShiftAuthor(await request());
    expect(await readShiftAuthorAuthority(await attestation())).toMatchObject({ allowed: true });
    expect(await readShiftAuthorAuthority(await attestation("RECOUNT"))).toMatchObject({ allowed: false, code: "ESHIFT_AUTHOR_PERMISSION_REVOKED" });
    person.permissions = { can_shift_cash_recount: true, "page:shifts": false };
    expect(await readShiftAuthorAuthority(await attestation("RECOUNT"))).toMatchObject({ allowed: false });
    person.permissions = { can_shift_cash_recount: true };
    expect(await readShiftAuthorAuthority(await attestation("RECOUNT"))).toMatchObject({ allowed: true });
    expect(await readShiftAuthorAuthority(await attestation("VARIANCE"))).toMatchObject({ allowed: false });
    person.permissions = { can_close_shift: true, can_shift_variance_approve: true };
    expect(await readShiftAuthorAuthority(await attestation())).toMatchObject({ allowed: true });
    expect(await readShiftAuthorAuthority(await attestation("VARIANCE"))).toMatchObject({ allowed: true });
    person.role = "manager"; person.role_slug = "supervisor"; person.permissions = {};
    expect(await readShiftAuthorAuthority(await attestation("RECOUNT"))).toMatchObject({ allowed: false });
  });
  it("retains cryptographic history after profile/key revocation while denying NEW writes", async () => {
    await enrollShiftAuthor(await request()); const signed = await attestation();
    person.is_active = false;
    expect(await verify(signed)).toEqual(signed);
    expect(await readShiftAuthorAuthority(signed)).toMatchObject({ allowed: false, code: "ESHIFT_AUTHOR_REVOKED" });
    person.is_active = true; saved!.revoked_at = "2026-11-02T00:00:00Z";
    expect(await verify(signed)).toEqual(signed);
    await expect(requireCurrentShiftAuthorPermission(signed)).rejects.toMatchObject({ code: "ESHIFT_AUTHOR_REVOKED" });
    expect(await shiftAuthorTerminalEnrolled(terminalId)).toBe(true);
  });
  it("holds unavailable authority instead of treating it as revocation or upgrading permission", async () => {
    await enrollShiftAuthor(await request()); outage = true;
    await expect(readShiftAuthorAuthority(await attestation())).rejects.toMatchObject({ status: 503 });
  });
});
