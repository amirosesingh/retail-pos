import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rest: vi.fn(), verify: vi.fn(), resolve: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => ({ validator: (parse: (value: unknown) => unknown) => ({ handler: (fn: (value: { data: unknown }) => unknown) => (input: { data: unknown }) => fn({ data: parse(input.data) }) }) }) }));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: mocks.rest, verifyRelayCaller: mocks.verify }));
vi.mock("@/core/api/relay-policy.server", () => ({ resolveRelayScope: mocks.resolve }));
import { addMissedBill, listMissedBillCashiers } from "../missed-bill.functions";
import { handleHostedFunctionRequest } from "../hosted-function-endpoint.server";

const request = { data: { storeId: "branch-a", sessionToken: "admin-proof-token" } };
const account = (id: string, storeId: string | null = "branch-a") => ({ user_id: id, full_name: `Name ${id}`, store_id: storeId });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.verify.mockResolvedValue({ kind: "staff" });
  mocks.resolve.mockResolvedValue({ role: "admin", roleSlug: "admin", staffUserId: "admin", storeId: null });
  mocks.rest.mockImplementation(async (path: string) => path.startsWith("stores?")
    ? Response.json([{ id: "branch-a" }]) : Response.json([account("cashier")]) );
});

describe("historical original cashier selection", () => {
  it("reads only active branch/all-branch accounts and returns IDs/names without account secrets", async () => {
    mocks.rest.mockImplementation(async (path: string) => {
      const query = new URL(path, "https://fixture.test/").searchParams;
      if (path.startsWith("stores?")) {
        expect(query.get("id")).toBe("eq.branch-a");
        expect(query.get("is_active")).toBe("eq.true");
        expect(query.get("deleted_at")).toBe("is.null");
        return Response.json([{ id: "branch-a" }]);
      }
      expect(query.get("select")).toBe("user_id,full_name,store_id");
      expect(query.get("is_active")).toBe("eq.true");
      expect(query.get("or")).toBe('(store_id.is.null,store_id.eq."",store_id.eq."branch-a")');
      return Response.json([
        { ...account("a"), pin_hash: "never-return", email: "private@example.test", permissions: { can_manage_staff: true } },
        account("global", null), account("empty", ""), account("foreign", "branch-b"),
      ]);
    });
    const result = await listMissedBillCashiers(request);
    expect(result.ok).toBe(true);
    expect(result.rows.map(row => row.userId)).toEqual(["a", "empty", "global"]);
    expect(Object.keys(result.rows[0])).toEqual(["userId", "name"]);
    expect(JSON.stringify(result)).not.toMatch(/never-return|private@example|permissions|foreign/);
    expect(mocks.verify).toHaveBeenCalledOnce();
  });

  it.each([
    { role: "staff", roleSlug: "cashier", staffUserId: "cashier", storeId: "branch-a" },
    { role: "manager", roleSlug: "supervisor", staffUserId: "manager", storeId: null },
    { role: "admin", staffUserId: "admin", storeId: "branch-b" },
    { role: "admin", storeId: null },
    { role: "admin", staffUserId: "admin", storeId: null, stale: true },
  ])("denies unauthorized, stale or another-branch identity before a privileged read: %j", async scope => {
    mocks.resolve.mockResolvedValue(scope);
    expect((await listMissedBillCashiers(request)).ok).toBe(false);
    expect(mocks.rest).not.toHaveBeenCalled();
  });

  it("enforces a normal terminal's resolved branch even for an administrator", async () => {
    mocks.verify.mockResolvedValue({ kind: "cashier", terminalId: "normal-a", storeId: "branch-a" });
    mocks.resolve.mockResolvedValue({ role: "admin", staffUserId: "admin", terminalId: "normal-a", storeId: "branch-a" });
    expect((await listMissedBillCashiers({ data: { ...request.data, storeId: "branch-b" } })).ok).toBe(false);
    expect(mocks.rest).not.toHaveBeenCalled();
  });

  it("fails clearly for an inactive branch and staff-service errors", async () => {
    mocks.rest.mockResolvedValueOnce(Response.json([]));
    const inactive = await listMissedBillCashiers(request);
    expect(inactive.ok).toBe(false);
    expect("error" in inactive && inactive.error).toMatch(/active branch/);
    expect(mocks.rest).toHaveBeenCalledTimes(1);
    mocks.rest.mockResolvedValueOnce(Response.json([{ id: "branch-a" }])).mockResolvedValueOnce(new Response("backend error", { status: 503 }));
    const unavailable = await listMissedBillCashiers(request);
    expect(unavailable.ok).toBe(false);
    expect("error" in unavailable && unavailable.error).toMatch(/could not be loaded/);
    expect(unavailable.rows).toEqual([]);
  });

  it("paginates beyond the first page rather than omitting original cashiers", async () => {
    mocks.rest.mockImplementation(async (path: string) => {
      if (path.startsWith("stores?")) return Response.json([{ id: "branch-a" }]);
      const offset = Number(new URL(path, "https://fixture.test/").searchParams.get("offset"));
      return Response.json(offset === 0 ? Array.from({ length: 200 }, (_, i) => account(String(i).padStart(3, "0"))) : [account("200")]);
    });
    const result = await listMissedBillCashiers(request);
    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(201);
    expect(result.rows.at(-1)?.userId).toBe("200");
    expect(mocks.rest).toHaveBeenCalledTimes(3);
  });

  it("quotes special branch characters as one filter value", async () => {
    const storeId = 'a",store_id.neq.null,(b';
    await listMissedBillCashiers({ data: { ...request.data, storeId } });
    const path = mocks.rest.mock.calls[1][0] as string;
    expect(new URL(path, "https://fixture.test/").searchParams.get("or")).toBe(`(store_id.is.null,store_id.eq."",store_id.eq.${JSON.stringify(storeId)})`);
  });

  it("stops rather than endlessly re-reading a repeated page", async () => {
    mocks.rest.mockImplementation(async (path: string) => path.startsWith("stores?")
      ? Response.json([{ id: "branch-a" }])
      : Response.json(Array.from({ length: 200 }, (_, i) => account(String(i)))));
    const result = await listMissedBillCashiers(request);
    expect(result.ok).toBe(false);
    expect("error" in result && result.error).toMatch(/did not advance/);
    expect(mocks.rest).toHaveBeenCalledTimes(3);
  });

  it("fails closed on an invalid account scope instead of treating it as all-branch", async () => {
    mocks.rest.mockResolvedValueOnce(Response.json([{ id: "branch-a" }]))
      .mockResolvedValueOnce(Response.json([{ user_id: "invalid", full_name: "Invalid", store_id: { unexpected: "branch-b" } }]));
    expect((await listMissedBillCashiers(request)).ok).toBe(false);
  });

  it("registers the same guarded minimal read for Electron and mobile hosted requests", async () => {
    const deviceBindingProof = "a".repeat(64);
    const response = await handleHostedFunctionRequest(new Request("https://fixture.test/api/v1/pos/sync?operation=app_function", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "missed-bill.listMissedBillCashiers", data: { ...request.data, deviceBindingProof } }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, rows: [{ userId: "cashier", name: "Name cashier" }] });
    expect(mocks.verify).toHaveBeenCalledOnce();
    expect(mocks.verify).toHaveBeenCalledWith(expect.objectContaining({ deviceBindingProof }));
  });

  it("passes native binding proof to historical-write verification without persisting credentials", async () => {
    const deviceBindingProof = "a".repeat(64);
    const data = {
      ...request.data, deviceBindingProof, accessToken: "fixture-access", terminalToken: "fixture-terminal", cashierToken: "fixture-cashier",
      clientKey: "10000000-0000-4000-8000-000000000001", originalReference: "PAPER-123", occurredAt: "2026-01-01T10:00:00Z",
      cashierId: "cashier", originalShiftId: null, reason: "Original paper bill missed", stockHandling: "already_corrected", stockReason: "Adjustment ADJ-123",
      items: [{ productId: "10000000-0000-4000-8000-000000000002", quantity: 1, unitPrice: 10, unitCost: 4, discountAmount: 0, taxAmount: 0 }],
      payments: [{ method: "cash", amount: 10 }],
    };
    mocks.rest.mockResolvedValueOnce(Response.json({ saleId: data.clientKey, receiptNo: `MB-${data.clientKey}`, sale: {}, items: [] }));
    expect((await addMissedBill({ data })).ok).toBe(true);
    expect(mocks.verify).toHaveBeenCalledWith(expect.objectContaining({ deviceBindingProof, terminalToken: "fixture-terminal" }));
    const [path, init] = mocks.rest.mock.calls[0];
    expect(path).toBe("rpc/pos_admin_add_missed_bill");
    const payload = JSON.parse(String(init.body));
    expect(payload.p_entry.cashierId).toBe("cashier");
    for (const field of ["sessionToken", "accessToken", "terminalToken", "cashierToken", "deviceBindingProof"])
      expect(payload.p_entry).not.toHaveProperty(field);
    expect(String(init.body)).not.toContain(deviceBindingProof);
  });
});
