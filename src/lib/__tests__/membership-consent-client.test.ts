import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/external-client", () => ({ memberPortalClientSnapshot: () => ({ rpc }) }));
import { enrollMemberPortal } from "../member-portal";
import { MEMBERSHIP_TERMS_VERSION, MEMBERSHIP_PRIVACY_VERSION } from "../membership-policies";
const signup = { fullName: "Member", phone: "+6738123456", termsAccepted: true, marketingConsent: false };
beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValueOnce({ data: { terms_version: MEMBERSHIP_TERMS_VERSION, privacy_version: MEMBERSHIP_PRIVACY_VERSION }, error: null });
  rpc.mockResolvedValue({ data: { id: "member-a" }, error: null });
});
describe("membership consent submission", () => {
  it("rejects missing acceptance before any enrollment request", async () => {
    await expect(enrollMemberPortal({ ...signup, termsAccepted: false })).rejects.toThrow("accept the membership terms");
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([false, true])("passes the actual marketing choice %s and policy versions", async (marketingConsent) => {
    await enrollMemberPortal({ ...signup, marketingConsent });
    expect(rpc.mock.calls[1][0]).toBe("membership_portal_enroll_details");
    expect(rpc.mock.calls[1][1].p_profile).toMatchObject({ terms_accepted: true, terms_version: MEMBERSHIP_TERMS_VERSION, privacy_version: MEMBERSHIP_PRIVACY_VERSION, marketing_consent: marketingConsent });
    expect(rpc.mock.calls[1][1].p_profile).not.toHaveProperty("accepted_at");
  });
  it("does not silently enroll against a database without consent support", async () => {
    rpc.mockReset().mockResolvedValue({ data: null, error: { message: "RPC missing" } });
    await expect(enrollMemberPortal(signup)).rejects.toThrow("being updated");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("rejects an outdated policy version", async () => {
    rpc.mockReset().mockResolvedValue({ data: { terms_version: "old" }, error: null });
    await expect(enrollMemberPortal(signup)).rejects.toThrow("refresh");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
