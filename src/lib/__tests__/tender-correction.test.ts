import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ scope: vi.fn(), rest: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => ({ validator: (parse: (data: unknown) => unknown) => ({ handler: (handle: (input: { data: unknown }) => unknown) => (input: { data: unknown }) => handle({ data: parse(input.data) }) }) }) }));
vi.mock("../privileged-caller.server", () => ({ requireCallerScope: mocks.scope }));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: mocks.rest }));
import { correctSaleTender } from "../tender-correction.functions";
const input = { sessionToken: "pos-session", saleId: "b8a9a774-7ea8-4935-88d9-206c796f8a34", storeId: "branch-a", method: "card" };
beforeEach(() => { vi.clearAllMocks(); mocks.scope.mockResolvedValue({ kind: "cashier", role: "admin", roleSlug: "admin", storeId: "branch-a" }); mocks.rest.mockResolvedValue(new Response(null, { status: 204 })); });
describe("verified tender correction", () => {
  it("uses the atomic cloud transaction for POS administrators", async () => {
    expect(await correctSaleTender({ data: input })).toEqual({ ok: true });
    expect(mocks.scope).toHaveBeenCalledWith(expect.objectContaining({ sessionToken: "pos-session" }));
    expect(mocks.rest).toHaveBeenCalledWith("rpc/pos_admin_correct_tender", expect.objectContaining({ body: JSON.stringify({ p_sale: input.saleId, p_store: input.storeId, p_method: "card" }) }));
  });
  it("refuses staff, device-only sessions and another branch", async () => {
    for (const scope of [{ kind: "cashier", role: "staff" }, { kind: "terminal", role: "admin" }, { kind: "cashier", role: "admin", storeId: "branch-b" }]) {
      mocks.scope.mockResolvedValue(scope);
      expect(await correctSaleTender({ data: input })).toMatchObject({ ok: false });
    }
    expect(mocks.rest).not.toHaveBeenCalled();
  });
});
