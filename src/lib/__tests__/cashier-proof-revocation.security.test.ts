import { createHash, createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { touch } = vi.hoisted(() => ({ touch: vi.fn() }));
vi.mock("../session-guard.server", () => ({ touchSession: touch }));
import { signCashierSession, verifyCashierSession } from "../pos-session.server";
const person = { id: "person-id", username: "cashier", storeId: "branch-a", sessionToken: "pst_login" };
beforeEach(() => {
  vi.stubEnv("SETTINGS_ENCRYPTION_KEY", "test-cashier-signing-key");
  touch.mockReset().mockResolvedValue({ ok: true, session: {
    kind: "cashier", staff_user_id: "cashier", branch_id: "branch-a",
  } });
});
describe("cashier proof revocation", () => {
  it("accepts a current signed login even without a separate raw-token field", async () => {
    await expect(verifyCashierSession(signCashierSession(person))).resolves.toEqual(person);
    expect(touch).toHaveBeenCalledWith("pst_login");
  });
  it.each(["revoked", "idle", "unknown", "unavailable"])("rejects the same proof when its login is %s", async reason => {
    const token = signCashierSession(person);
    touch.mockResolvedValue({ ok: false, reason });
    await expect(verifyCashierSession(token)).resolves.toBeNull();
  });
  it.each([
    { kind: "staff", staff_user_id: "cashier", branch_id: "branch-a" },
    { kind: "cashier", staff_user_id: "another-user", branch_id: "branch-a" },
    { kind: "cashier", staff_user_id: "cashier", branch_id: "branch-b" },
  ])("rejects a different bound identity or branch", async session => {
    touch.mockResolvedValue({ ok: true, session });
    await expect(verifyCashierSession(signCashierSession(person))).resolves.toBeNull();
  });
  it("requires legacy unbound proofs to be renewed with the PIN", async () => {
    const body = Buffer.from(JSON.stringify({ id: person.id, username: person.username, storeId: person.storeId, exp: Date.now() + 10000 })).toString("base64url");
    const key = createHash("sha256").update("test-cashier-signing-key").digest();
    const sig = createHmac("sha256", key).update(body).digest("base64url");
    await expect(verifyCashierSession(`${body}.${sig}`)).resolves.toBeNull();
    expect(touch).not.toHaveBeenCalled();
  });
  it("rejects tampered and expired proofs before looking up a login", async () => {
    const token = signCashierSession(person);
    await expect(verifyCashierSession(`${token}x`)).resolves.toBeNull();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 13 * 60 * 60 * 1000);
    await expect(verifyCashierSession(token)).resolves.toBeNull();
    vi.restoreAllMocks();
    expect(touch).not.toHaveBeenCalled();
  });
});
