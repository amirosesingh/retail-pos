import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const { send, verify } = vi.hoisted(() => ({ send: vi.fn(), verify: vi.fn() }));
vi.mock("@/integrations/supabase/external-client", () => ({ memberPortalClientSnapshot: () => ({ auth: { signInWithOtp: send, verifyOtp: verify } }) }));
import { sendMemberOtp, verifyMemberOtp } from "../member-portal";
beforeEach(() => { vi.resetAllMocks(); send.mockResolvedValue({ error: null }); verify.mockResolvedValue({ data: { session: { access_token: "test-session" } }, error: null }); });
describe("entered membership email verification codes", () => {
  it("requests an email OTP and verifies the entered code without consuming a link", async () => {
    await sendMemberOtp("email", " member@example.invalid ");
    expect(send).toHaveBeenCalledWith({ email: "member@example.invalid", options: { shouldCreateUser: true } });
    await verifyMemberOtp("email", "member@example.invalid", "123456");
    expect(verify).toHaveBeenCalledWith({ email: "member@example.invalid", token: "123456", type: "email" });
  });
  it("keeps the versioned template as a code email, without login links", () => {
    const template = readFileSync("supabase/membership/templates/verification-code.html", "utf8");
    expect(template).toContain("{{ .Token }}");
    expect(template).not.toContain("ConfirmationURL");
    expect(template).not.toContain("TokenHash");
    expect(template).not.toMatch(/<a\b/i);
  });
});
