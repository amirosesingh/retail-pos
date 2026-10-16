import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { rest } = vi.hoisted(() => ({ rest: vi.fn() }));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: rest }));
vi.mock("../secure-settings.server", () => ({
  readSecureSetting: async () => "test-only-placeholder",
}));
import { startVerification, confirmVerification } from "../verification.server";
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.unstubAllGlobals());
it("sends an existing member's code only to the persisted contact", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  rest
    .mockResolvedValueOnce(
      Response.json([{ phone: "+673 1234567", email: "member@example.invalid" }]),
    )
    .mockResolvedValueOnce(Response.json([{ verification_channel: "email", is_active: true }]))
    .mockResolvedValueOnce(Response.json([{ id: "verification-id" }]));
  await startVerification({
    memberId: "member-id",
    email: "forged@example.invalid",
    phone: "999",
    sentBy: "staff",
  });
  const persisted = JSON.parse(rest.mock.calls[2][1].body)[0];
  expect(persisted.email).toBe("member@example.invalid");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).personalizations[0].to[0].email).toBe(
    "member@example.invalid",
  );
});
it("rejects a stale contact before marking a member verified", async () => {
  rest
    .mockResolvedValueOnce(
      Response.json([
        { member_id: "member", channel: "email", email: "old@example.invalid", status: "pending" },
      ]),
    )
    .mockResolvedValueOnce(Response.json([{ email: "new@example.invalid" }]));
  await expect(confirmVerification("verification-id", "123456")).rejects.toThrow("contact changed");
  expect(rest).toHaveBeenCalledTimes(2);
});
it("does not fall back to supplied contact if the member cannot be read", async () => {
  rest.mockResolvedValueOnce(new Response(null, { status: 503 }));
  await expect(
    startVerification({ memberId: "member-id", email: "forged@example.invalid", sentBy: "staff" }),
  ).rejects.toThrow("Could not read");
});
