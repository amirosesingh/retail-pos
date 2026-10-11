import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  scope: {
    role: "admin",
    roleSlug: "admin",
    storeId: "B1",
    staffUserId: "verified-admin",
    actorName: "Admin",
    label: "Admin",
    terminalId: "T1",
  },
  rest: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    validator: (parse: (data: unknown) => unknown) => ({
      handler: (handler: (value: { data: unknown }) => unknown) => (value: { data: unknown }) =>
        handler({ data: parse(value.data) }),
    }),
  }),
}));
vi.mock("@/core/api/pos-relay.server", () => ({
  verifyRelayCaller: mocks.verify,
  serviceRest: mocks.rest,
}));
vi.mock("@/core/api/relay-policy.server", () => ({ resolveRelayScope: async () => mocks.scope }));
import {
  correctPostedSale,
  loadPostedSaleForCorrection,
  saleCorrectionInput,
} from "@/lib/sale-corrections.functions";

const payload = () => ({
  saleId: "11111111-1111-4111-8111-111111111111",
  storeId: "B1",
  expectedVersion: 2,
  clientKey: "22222222-2222-4222-8222-222222222222",
  reason: "Add missing item",
  totals: {
    subtotal_amount: 10,
    discount_amount: 1,
    tax_amount: 0,
    total_amount: 9,
    coupon_discount: 0,
  },
  items: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      product_id: null,
      product_name: "Service",
      variant_code: null,
      unit_price: 10,
      unit_cost: 0,
      quantity: 1,
      discount_percent: 10,
      discount_amount: 0,
      tax_rate: 0,
      is_return: false as const,
      is_foc: false,
      promo_id: null,
      coupon_code: null,
      coupon_discount: 0,
    },
  ],
});
beforeEach(() => {
  mocks.rest.mockReset();
  mocks.verify.mockReset().mockResolvedValue({});
  Object.assign(mocks.scope, { role: "admin", roleSlug: "admin", storeId: "B1" });
});
describe("posted bill correction authorization", () => {
  it("refuses non-admin writes before touching the database", async () => {
    Object.assign(mocks.scope, { role: "staff", roleSlug: "cashier" });
    expect(await correctPostedSale({ data: payload() })).toMatchObject({ ok: false });
    expect(mocks.rest).not.toHaveBeenCalled();
  });
  it("refuses a forged branch", async () => {
    expect(await correctPostedSale({ data: { ...payload(), storeId: "B2" } })).toMatchObject({
      ok: false,
    });
    expect(mocks.rest).not.toHaveBeenCalled();
  });
  it("stamps the verified actor and sends no payment or bill-number changes", async () => {
    mocks.rest.mockResolvedValue(
      new Response(
        JSON.stringify({
          sale: { id: payload().saleId, bill_number: "B-1042", paid_amount: 20 },
          items: [],
        }),
      ),
    );
    expect(await correctPostedSale({ data: payload() })).toMatchObject({ ok: true });
    const [url, request] = mocks.rest.mock.calls[0];
    expect(url).toBe("rpc/pos_admin_correct_sale");
    const sent = JSON.parse(request.body);
    expect(sent.p_actor_id).toBe("verified-admin");
    expect(sent.p_sale).toBe(payload().saleId);
    expect(sent.p_expected_version).toBe(2);
    expect(sent.p_totals).not.toHaveProperty("paid_amount");
    expect(sent.p_totals).not.toHaveProperty("bill_number");
    expect(sent).not.toHaveProperty("payments");
  });
  it("returns a failed commit without claiming correction success", async () => {
    mocks.rest.mockResolvedValue(new Response("Stale bill", { status: 409 }));
    expect(await correctPostedSale({ data: payload() })).toMatchObject({
      ok: false,
      error: "Stale bill",
    });
  });
  it("requires an admin to load the fresh receipt for correction", async () => {
    Object.assign(mocks.scope, { role: "staff", roleSlug: "cashier" });
    expect(
      await loadPostedSaleForCorrection({ data: { saleId: payload().saleId, storeId: "B1" } }),
    ).toMatchObject({ ok: false });
    expect(mocks.rest).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5])("rejects invalid item quantity %s", (quantity) => {
    const input = payload();
    input.items[0].quantity = quantity;
    expect(saleCorrectionInput.safeParse(input).success).toBe(false);
  });
  it("rejects non-finite totals and excessive percentage discounts", () => {
    const input = payload();
    input.totals.total_amount = NaN;
    expect(saleCorrectionInput.safeParse(input).success).toBe(false);
    input.totals.total_amount = 9;
    input.items[0].discount_percent = 101;
    expect(saleCorrectionInput.safeParse(input).success).toBe(false);
  });
});
