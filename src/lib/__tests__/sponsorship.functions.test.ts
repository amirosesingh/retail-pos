import { beforeEach, expect, it, vi } from "vitest";
const { scope, rest } = vi.hoisted(() => ({ scope: vi.fn(), rest: vi.fn() }));
vi.mock("@/lib/privileged-caller.server", () => ({ requireCallerScope: scope }));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: rest }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    validator: (parse: (input: unknown) => unknown) => ({
      handler: (fn: (input: { data: unknown }) => unknown) => (input: { data: unknown }) =>
        fn({ data: parse(input.data) }),
    }),
  }),
}));
import {
  loadSponsorships,
  requestSponsorship,
  handOverSponsorship,
  loadSponsorshipDailyValues,
  getSponsorshipAccess,
  getSponsorshipDirectPolicy,
  saveSponsorshipDirectPolicy,
} from "../sponsorship.functions";
const id = "00000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.resetAllMocks();
  scope.mockResolvedValue({
    kind: "staff",
    staffUserId: "issuer",
    storeId: "a",
    permissions: {},
    role: "cashier",
    roleSlug: "cashier",
  });
  rest.mockResolvedValue({ ok: true, json: async () => [] });
});
it("verifies permission before any privileged read or mutation", async () => {
  scope.mockRejectedValue(new Error("No permission"));
  await expect(loadSponsorships({ data: { storeId: "a" } })).rejects.toThrow(/permission/);
  await expect(handOverSponsorship({ data: { id, receivedBy: "Receiver" } })).rejects.toThrow(
    /permission/,
  );
  expect(rest).not.toHaveBeenCalled();
});
it("rejects a different branch before requesting rows or totals", async () => {
  await expect(loadSponsorships({ data: { storeId: "b" } })).rejects.toThrow(/branch/);
  await expect(
    loadSponsorshipDailyValues({
      data: { storeId: "b", from: "2026-10-01", to: "2026-10-24", zone: "Asia/Brunei" },
    }),
  ).rejects.toThrow(/branch/);
  expect(rest).not.toHaveBeenCalled();
});
it("requires a person rather than a bare terminal proof", async () => {
  scope.mockResolvedValue({ kind: "terminal", storeId: "a", permissions: {} });
  await expect(loadSponsorships({ data: { storeId: "a" } })).rejects.toThrow(/staff/);
  expect(rest).not.toHaveBeenCalled();
});
it("checks creation permission before preparing a sponsorship", async () => {
  scope.mockRejectedValue(new Error("Denied"));
  await expect(
    requestSponsorship({
      data: {
        proof: {},
        routing: {
          id,
          storeId: "a",
          numbering: { prefix: "SP-A-20261024", minimum: 1, padding: 4 },
          recipient: "Club",
          purpose: "Event",
          lines: [{ productId: id, quantity: 1 }],
        },
      },
    }),
  ).rejects.toThrow(/Denied/);
  expect(scope).toHaveBeenCalledWith({}, { permission: "can_create_sponsorship" });
  expect(rest).not.toHaveBeenCalled();
});
it("returns aggregate-only reporting through the scoped sales permission", async () => {
  rest.mockResolvedValue({ ok: true, json: async () => [{ day: "2026-10-24", value: 20 }] });
  expect(
    await loadSponsorshipDailyValues({
      data: { storeId: "a", from: "2026-10-24", to: "2026-10-24", zone: "Asia/Brunei" },
    }),
  ).toEqual([{ day: "2026-10-24", value: 20 }]);
  expect(scope).toHaveBeenCalledWith(expect.anything(), { permission: "can_view_sales_reports" });
  expect(rest.mock.calls[0][0]).toBe("rpc/sponsorship_daily_values");
});

it("does not let a settings-enabled non-admin grant direct issue authority", async () => {
  await expect(getSponsorshipDirectPolicy({ data: {} })).rejects.toThrow(/administrator/);
  await expect(
    saveSponsorshipDirectPolicy({ data: { userIds: ["issuer"], version: 0 } }),
  ).rejects.toThrow(/administrator/);
  expect(rest).not.toHaveBeenCalled();
});
it("administrators have direct access without reading or granting another user's policy", async () => {
  scope.mockResolvedValue({
    kind: "staff",
    staffUserId: "owner",
    storeId: null,
    role: "admin",
    roleSlug: "admin",
    permissions: {},
  });
  expect(await getSponsorshipAccess({ data: {} })).toEqual({ direct: true });
  expect(rest).not.toHaveBeenCalled();
});
it("direct access follows the current named-user policy", async () => {
  rest.mockResolvedValue({ ok: true, json: async () => [{ user_ids: ["issuer"] }] });
  expect(await getSponsorshipAccess({ data: {} })).toEqual({ direct: true });
  rest.mockResolvedValue({ ok: true, json: async () => [{ user_ids: [] }] });
  expect(await getSponsorshipAccess({ data: {} })).toEqual({ direct: false });
});
