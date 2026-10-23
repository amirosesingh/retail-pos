import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, privateDecrypt, createDecipheriv } from "node:crypto";
import { defaultRule } from "../authorization";
const f = vi.hoisted(() => ({
  scope: {
    kind: "staff",
    staffUserId: "manager",
    storeId: "branch-a",
    roleSlug: "manager",
    role: "manager",
    label: "manager",
    actorName: "Manager",
    stale: false,
  },
  manager: true, deviceEnabled: true,
  active: true,
  totp: true,
  branch: "branch-a",
  personBranch: "branch-a" as string | null,
  platform: "android",
  service: vi.fn(),
  rules: vi.fn(),
  devices: [] as Record<string, unknown>[],
  verifier: "",
}));
vi.mock("../privileged-caller.server", () => ({
  requireCallerScope: async (_: unknown, options?: { permission?: string }) => {
    if (options?.permission && !f.manager) throw new Error("Permission denied");
    return f.scope;
  },
}));
vi.mock("@/core/api/pos-relay.server", () => ({
  serviceRest: (...args: unknown[]) => f.service(...args),
  verifyRelayCaller: async ({ terminalToken }: { terminalToken?: string }) => {
    if (!terminalToken) throw new Error("No registration");
    return { kind: "terminal", terminalId: terminalToken, storeId: f.branch };
  },
}));
vi.mock("../authorization.server", () => ({ loadRuleRows: () => f.rules() }));
vi.mock("../system-audit.server", () => ({ writeSystemAudit: async () => {} }));
import {
  enrollApprovalToken,
  verifyApprovalTotp,
  identifyApprovalTotp,
  registerApprovalVerifier,
  approvalVerifierBundle,
  approvalTokenStatus,
} from "../approval-token-server";
import { approvalTotp } from "../approval-totp";
const terminal = "11111111-1111-4111-8111-111111111111";
const proof = { sessionToken: "verified-user-session", terminalToken: terminal };
beforeEach(() => {
  vi.stubEnv("SETTINGS_ENCRYPTION_KEY", "test-approval-encryption-key-only");
  f.manager = true; f.deviceEnabled = true;
  f.active = true;
  f.totp = true;
  f.platform = "android";
  f.branch = "branch-a";
  f.personBranch = "branch-a";
  f.verifier = "";
  f.devices = [];
  f.scope.kind = "staff";
  f.scope.staffUserId = "manager";
  f.scope.storeId = "branch-a";
  f.rules.mockResolvedValue([
    { ...defaultRule("refund"), mode: "either", allowedRoles: ["manager"] },
  ]);
  f.service.mockImplementation(async (url: string, options?: { body?: string }) => {
    if (url.startsWith("app_users?"))
      return Response.json([
        {
          id: "user-id",
          user_id: "manager",
          full_name: "Manager",
          role: "manager",
          role_slug: "manager",
          store_id: f.personBranch,
          is_active: f.active,
          permissions: { approval_totp_enabled: f.totp },
        },
      ]);
    if (url.startsWith("terminal_tokens?")) return Response.json([{ platform: f.platform, approval_token_enabled: f.deviceEnabled }]);
    const args = JSON.parse(options?.body || "{}");
    if (args.p_op === "enroll") {
      if (!f.devices.length)
        f.devices.push({
          id: "device-id",
          user_id: "manager",
          terminal_id: terminal,
          secret_ciphertext: args.p_secret,
          last_used_step: -1,
        });
      return Response.json(f.devices[0]);
    }
    if (args.p_op === "read" || args.p_op === "read_branch") return Response.json(f.devices);
    if (args.p_op === "consume") {
      const device = f.devices[0];
      const valid = Number(device.last_used_step) < args.p_step;
      if (valid) device.last_used_step = args.p_step;
      return Response.json(valid);
    }
    if (args.p_op === "get_verifier")
      return Response.json(f.verifier ? { public_key: f.verifier } : null);
    if (args.p_op === "register_verifier") {
      f.verifier = args.p_secret;
      return Response.json(true);
    }
    throw new Error("Unexpected credential operation");
  });
});
afterEach(() => vi.unstubAllEnvs());
describe("approval credential authorization", () => {
  it.each(["ios", "mobile", "pc", "windows"])("accepts a registered %s receiver with the same permission and replay checks", async platform => {
    f.platform = platform;
    const enrolled = await enrollApprovalToken(proof);
    const code = await approvalTotp(enrolled.credential!.secret);
    expect((await verifyApprovalTotp("manager", code, "branch-a", terminal))?.userId).toBe("manager");
    expect(await verifyApprovalTotp("manager", code, "branch-a", terminal)).toBeNull();
  });
  it("only enrolls an enabled eligible signed-in person on the same registered branch", async () => {
    const enrolled = await enrollApprovalToken(proof);
    expect(enrolled.credential?.userId).toBe("manager");
    expect(f.devices[0].secret_ciphertext).not.toBe(enrolled.credential?.secret);
    f.branch = "branch-b";
    await expect(enrollApprovalToken(proof)).rejects.toThrow("branch");
    f.branch = "branch-a";
    f.totp = false;
    expect((await enrollApprovalToken(proof)).credential).toBe(null);
    f.totp = true;
    f.active = false;
    expect((await enrollApprovalToken(proof)).credential).toBe(null);
  });
  it("rejects a bare machine identity and non-manager verifier enrollment", async () => {
    f.scope.kind = "terminal";
    await expect(enrollApprovalToken(proof)).rejects.toThrow("Sign in");
    f.scope.kind = "staff";
    f.manager = false;
    await expect(registerApprovalVerifier(proof, "not-a-key")).rejects.toThrow("Permission denied");
  });
  it("requires a registered native receiver and prevents reuse of a cloud token", async () => {
    const enrolled = await enrollApprovalToken(proof);
    const code = await approvalTotp(enrolled.credential!.secret);
    expect(await verifyApprovalTotp("manager", code, "branch-a")).toBe(null);
    expect((await verifyApprovalTotp("manager", code, "branch-a", terminal))?.userId).toBe(
      "manager",
    );
    expect(await verifyApprovalTotp("manager", code, "branch-a", terminal)).toBe(null);
    f.totp = false;
    expect(await verifyApprovalTotp("manager", code, "branch-a", terminal)).toBe(null);
  });
  it("revalidates only this registered device enrollment without returning its secret", async () => {
    const enrolled = await enrollApprovalToken(proof);
    expect(await approvalTokenStatus(terminal, "manager", enrolled.credential!.id)).toEqual({ ok: true, active: true });
    expect((await approvalTokenStatus(terminal, "manager", "another-device")).active).toBe(false);
    f.deviceEnabled = false;
    expect((await approvalTokenStatus(terminal, "manager", enrolled.credential!.id)).active).toBe(false);
    f.deviceEnabled = true; f.active = false;
    expect((await approvalTokenStatus(terminal, "manager", enrolled.credential!.id)).active).toBe(false);
  });
  it("keeps an all-branch management token valid while signed out", async () => {
    f.branch = "";
    f.personBranch = null;
    const enrolled = await enrollApprovalToken(proof);
    f.rules.mockRejectedValue(new Error("No branch selected while signed out"));
    expect(await approvalTokenStatus(terminal, "manager", enrolled.credential!.id)).toEqual({ ok: true, active: true });
  });
  it.each(["windows", "pc"])("encrypts verifier bundles to the staff-manager-pinned %s public key", async platform => {
    const enrolled = await enrollApprovalToken(proof);
    f.platform = platform;
    await expect(approvalVerifierBundle(terminal)).rejects.toThrow("manager must sign in");
    const keys = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    await registerApprovalVerifier(proof, keys.publicKey);
    const result = await approvalVerifierBundle(terminal);
    expect(JSON.stringify(result)).not.toContain(enrolled.credential!.secret);
    const key = privateDecrypt(
      { key: keys.privateKey, oaepHash: "sha256" },
      Buffer.from(result.sealedKey, "base64"),
    );
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(result.iv, "base64"));
    decipher.setAuthTag(Buffer.from(result.tag, "base64"));
    const opened = JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(result.ciphertext, "base64")),
        decipher.final(),
      ]).toString(),
    );
    expect(opened.branchId).toBe("branch-a");
    expect(opened.entries[0].secret).toBe(enrolled.credential!.secret);
  });
});

it("enrolls a permitted branch user on a management phone without widening that user's branch", async () => {
  f.branch = "";
  const result = await enrollApprovalToken(proof);
  expect(result.credential?.branchId).toBe("branch-a");
  f.deviceEnabled = false;
  expect((await enrollApprovalToken(proof)).credential).toBeNull();
  f.deviceEnabled = true; f.totp = false;
  expect((await enrollApprovalToken(proof)).credential).toBeNull();
});

it.each(["pc", "windows", "mobile"])("management %s can issue and receive a token without widening user branch access", async platform => {
 f.platform = platform; f.branch = "";
 const result = await enrollApprovalToken(proof);
 expect(result.credential?.branchId).toBe("branch-a");
 const code = await approvalTotp(result.credential!.secret);
 expect(await verifyApprovalTotp("manager", code, "branch-b", terminal)).toBeNull();
 expect((await verifyApprovalTotp("manager", code, "branch-a", terminal))?.userId).toBe("manager");
 expect(await verifyApprovalTotp("manager", code, "branch-a", terminal)).toBeNull();
 f.deviceEnabled = false;
 expect((await enrollApprovalToken(proof)).credential).toBeNull();
});

it("resolves a code owner without an ID, but rejects collisions before consuming", async () => {
  const enrolled = await enrollApprovalToken(proof);
  const code = await approvalTotp(enrolled.credential!.secret);
  expect(await identifyApprovalTotp(code, "branch-a", terminal)).toBe("manager");
  expect(f.devices[0].last_used_step).toBe(-1);
  f.devices.push({ ...f.devices[0], id: "second-device", user_id: "other-person" });
  expect(await identifyApprovalTotp(code, "branch-a", terminal)).toBeNull();
  expect(f.devices[0].last_used_step).toBe(-1);
  expect(await identifyApprovalTotp(code, "branch-b", terminal)).toBeNull();
  expect(await identifyApprovalTotp(code, "branch-a")).toBeNull();
  expect(await identifyApprovalTotp("1234", "branch-a", terminal)).toBeNull();
});
