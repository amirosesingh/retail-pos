import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const {
  createApprovalTokenVerifier,
  tokenAt,
} = require("../../../electron/approval-token-verifier.cjs");
const {
  verifySyncedApprovalPin,
  verifySyncedStaffPin,
} = require("../../../electron/synced-staff-login.cjs");
import bcrypt from "bcryptjs";
const roots: string[] = [];
const root = path.resolve("node_modules/.cache/test-tmp");
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of roots.splice(0)) {
    if (!directory.startsWith(root + path.sep)) throw new Error("Unexpected temporary directory");
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
function fixture() {
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, "token-"));
  roots.push(directory);
  const binding = { tokenId: "terminal-a", branch: "branch-a", origin: "project-a" };
  const secret = Buffer.from("12345678901234567890").toString("base64");
  const secure = {
    isEncryptionAvailable: () => true,
    encryptString: vi.fn((s: string) => Buffer.from(s).reverse()),
    decryptString: (b: Buffer) => Buffer.from(b).reverse().toString(),
  };
  const used = new Map<string, number>();
  const query = vi.fn(async (values: Record<string, unknown>) => {
    const key = String(values.key);
    const step = Number(values.step);
    if ((used.get(key) ?? -1) >= step) return { recordset: [] };
    used.set(key, step);
    return { recordset: [{ key }] };
  });
  const pool = {
    request: () => {
      const values: Record<string, unknown> = {};
      const request = {
        input: (key: string, value: unknown) => {
          values[key] = value;
          return request;
        },
        query: () => query(values),
      };
      return request;
    },
  };
  const fetchBundle = vi.fn(async () => ({
    ok: true,
    terminalId: binding.tokenId,
    branchId: binding.branch,
    validUntil: Date.now() + 86400000,
    entries: [{ id: "device-a", userId: "manager", secret, lastUsedStep: -1 }],
  }));
  const options = {
    safeStorage: secure,
    directory: () => directory,
    terminal: () => ({ tokenId: binding.tokenId }),
    branch: () => binding.branch,
    origin: () => binding.origin,
    fetchBundle,
  };
  return {
    verifier: createApprovalTokenVerifier(options),
    options,
    binding,
    secure,
    pool,
    query,
    secret,
  };
}
describe("offline Windows token verifier", () => {
  it("seals credentials and rejects reuse even after the verifier restarts", async () => {
    const f = fixture();
    await f.verifier.refresh();
    expect(f.secure.encryptString).toHaveBeenCalledOnce();
    const code = tokenAt(f.secret, Math.floor(Date.now() / 30000));
    expect(await f.verifier.verify(f.pool, "manager", code, "branch-a")).toBe(true);
    const restarted = createApprovalTokenVerifier(f.options);
    expect(await restarted.verify(f.pool, "manager", code, "branch-a")).toBe(false);
  });
  it("rejects a different account, branch, terminal, tenant and expired enrollment", async () => {
    const f = fixture();
    await f.verifier.refresh();
    const code = tokenAt(f.secret, Math.floor(Date.now() / 30000));
    expect(await f.verifier.verify(f.pool, "cashier", code, "branch-a")).toBe(false);
    expect(await f.verifier.verify(f.pool, "manager", code, "branch-b")).toBe(false);
    f.binding.origin = "project-b";
    expect(await f.verifier.verify(f.pool, "manager", code, "branch-a")).toBe(false);
    f.binding.origin = "project-a";
    f.binding.tokenId = "terminal-b";
    expect(await f.verifier.verify(f.pool, "manager", code, "branch-a")).toBe(false);
    f.binding.tokenId = "terminal-a";
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 86401000);
    expect(await f.verifier.verify(f.pool, "manager", code, "branch-a")).toBe(false);
    expect(f.query).not.toHaveBeenCalled();
  });
  it("does not fall back to unencrypted credential storage", async () => {
    const f = fixture();
    f.secure.isEncryptionAvailable = () => false;
    await f.verifier.refresh();
    expect(f.secure.encryptString).not.toHaveBeenCalled();
  });
});
describe("approval credential switches", () => {
  function pool(permissions: Record<string, boolean>) {
    return {
      request: () => {
        const request = {
          input: () => request,
          query: async (sql: string) => ({
            recordset: sql.includes("FROM dbo.app_users")
              ? [
                  {
                    id: "user-a",
                    username: "manager",
                    full_name: "Manager",
                    store_id: "branch-a",
                    role_slug: "manager",
                    is_active: true,
                    permissions,
                    pin_hash: bcrypt.hashSync("123456", 4),
                  },
                ]
              : sql.includes("MERGE dbo.pin_attempts")
                ? [{ attempts: 1 }]
                : [],
          }),
        };
        return request;
      },
    };
  }
  it("accepts an enabled token with the approval PIN disabled", async () => {
    const verifyTotp = vi.fn(async () => true);
    const result = await verifySyncedApprovalPin(
      pool({ approval_pin_enabled: false, approval_totp_enabled: true }),
      "manager",
      "12345678",
      "branch-a",
      { verifyTotp },
    );
    expect(result.ok).toBe(true);
    expect(result.credentialMethod).toBe("totp");
    expect(verifyTotp).toHaveBeenCalledOnce();
  });
  it("rejects disabled approval credentials without changing terminal sign-in", async () => {
    const verifyTotp = vi.fn(async () => true);
    const p = pool({ approval_pin_enabled: false, approval_totp_enabled: false });
    expect(
      (await verifySyncedApprovalPin(p, "manager", "123456", "branch-a", { verifyTotp })).ok,
    ).toBe(false);
    expect(verifyTotp).not.toHaveBeenCalled();
    expect((await verifySyncedStaffPin(p, "manager", "123456", "branch-a")).ok).toBe(true);
  });
});

describe("native approval IPC boundary", () => {
  it("allows signed-in cashiers to present credentials while restricting verifier enrollment", () => {
    const session = require("../../../electron/admin-session.cjs");
    const privilege = require("../../../electron/ipc-privilege.cjs");
    session.clear();
    expect(privilege.allowed("staff:verify-approval-pin")).toBe(false);
    session.grant("staff", "cashier", { can_process_sale: true }, "pos", "branch-a");
    expect(privilege.allowed("staff:verify-approval-pin")).toBe(true);
    expect(privilege.allowed("approval:enroll-verifier")).toBe(false);
    session.grant("supervisor", "manager", { can_manage_staff: true }, "pos", "branch-a");
    expect(privilege.allowed("approval:enroll-verifier")).toBe(true);
    session.clear();
  });
});
