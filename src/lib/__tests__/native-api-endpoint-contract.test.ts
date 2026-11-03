import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ verify: vi.fn(), scope: vi.fn(), authority: vi.fn(), enroll: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => ({ options }) }));
vi.mock("@/core/api/pos-relay.server", () => ({ verifyRelayCaller: h.verify }));
vi.mock("@/core/api/relay-policy.server", () => ({ resolveRelayScope: h.scope }));
vi.mock("../desktop-database-authority.server", () => ({ databaseAuthority: h.authority }));
vi.mock("../shift-author-verification.server", () => ({ enrollShiftAuthor: h.enroll,
 ShiftAuthorError: class extends Error { constructor(readonly code: string, message: string, readonly status: number) { super(message); } },
}));
import { handleIpcAdopt } from "../ipc-adopt-endpoint.server";
import { handleShiftAuthorEnroll } from "../shift-author-enroll-endpoint.server";
import { ShiftAuthorError } from "../shift-author-verification.server";
import { Route as adoptRoute } from "@/routes/api/v1/pos/ipc-adopt";
import { Route as enrollRoute } from "@/routes/api/v1/pos/shift-author-enroll";
const proof = { sessionToken: "fixture-person", terminalToken: "fixture-terminal", deviceBindingProof: "a".repeat(64) };
const terminal = { id: "fixture-terminal", platform: "pc", mode: "operations", branchId: "branch-a" };
const account = { subject: "fixture-person", authorId: "00000000-0000-4000-8000-000000000001", level: "staff", branchId: null, permissions: { can_process_sale: true } };
type RouteContract = { options: { server: { handlers: { POST: (input: { request: Request }) => Promise<Response>; OPTIONS?: unknown } } } };
const post = (route: unknown) => (route as RouteContract).options.server.handlers.POST;
const snapshot = async (response: Response) => ({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.json() });
beforeEach(() => {
 vi.resetAllMocks();
 h.verify.mockResolvedValue({ kind: "cashier", staffUserId: "fixture-person", appUserId: account.authorId, terminalId: terminal.id, terminal });
 h.scope.mockResolvedValue({ storeId: "branch-a" });
 h.authority.mockResolvedValue({ ...account }); h.enroll.mockResolvedValue({ ok: true, enrolled: true });
});
it("uses the same verified adoption response directly and through the route, without new CORS or OPTIONS", async () => {
 const request = () => new Request("https://fixture.invalid/api/v1/pos/ipc-adopt", { method: "POST", body: JSON.stringify(proof) });
 const direct = await snapshot(await handleIpcAdopt(request()));
 expect(await snapshot(await post(adoptRoute)({ request: request() }))).toEqual(direct);
 expect(direct).toMatchObject({ status: 200, body: { ...account, branchId: "branch-a", accountScope: { branchId: null }, terminal } });
 expect(h.verify).toHaveBeenCalledWith(proof, { strictAvailability: true });
 expect(h.authority).toHaveBeenCalledWith(expect.objectContaining({ appUserId: account.authorId }), { strictAvailability: true });
 expect(direct.headers).not.toHaveProperty("access-control-allow-origin");
 expect((adoptRoute as unknown as RouteContract).options.server.handlers.OPTIONS).toBeUndefined();
});
it.each([
 ["not-json", {}, 401], ["{}", {}, 401], [JSON.stringify(proof), { "content-length": "10001" }, 413],
 [JSON.stringify({ ...proof, deviceBindingProof: "invalid" }), {}, 401],
])("retains adoption payload denial before identity verification", async (body, headers, status) => {
 const request = new Request("https://fixture.invalid", { method: "POST", body, headers });
 expect((await handleIpcAdopt(request)).status).toBe(status); expect(h.verify).not.toHaveBeenCalled();
});
it.each([401, 403, 503])("retains adoption authority failure status %s and private-error masking", async status => {
 h.verify.mockRejectedValue(Object.assign(new Error("PRIVATE fixture detail"), { status }));
 const result = await snapshot(await handleIpcAdopt(new Request("https://fixture.invalid", { method: "POST", body: JSON.stringify(proof) })));
 expect(result.status).toBe(status);
 expect(result.body.code).toBe(status === 503 ? "EAUTH_UNAVAILABLE" : "EAUTH_DENIED");
 expect(JSON.stringify(result)).not.toContain("PRIVATE"); expect(h.authority).not.toHaveBeenCalled();
});
it("retains rejection of an inactive or missing adoption authority", async () => {
 h.authority.mockResolvedValue(null);
 expect((await handleIpcAdopt(new Request("https://fixture.invalid", { method: "POST", body: JSON.stringify(proof) }))).status).toBe(403);
});
it("uses the same bounded enrollment handler directly and through its route without CORS or OPTIONS", async () => {
 const input = { fixture: "test-only-enrollment" };
 const request = () => new Request("https://fixture.invalid", { method: "POST", body: JSON.stringify(input) });
 const direct = await snapshot(await handleShiftAuthorEnroll(request()));
 expect(await snapshot(await post(enrollRoute)({ request: request() }))).toEqual(direct);
 expect(h.enroll).toHaveBeenCalledWith(input); expect(direct.status).toBe(200);
 expect(direct.headers).not.toHaveProperty("access-control-allow-origin");
 expect((enrollRoute as unknown as RouteContract).options.server.handlers.OPTIONS).toBeUndefined();
});
it.each([
 [undefined, {}, 400], ["not-json", {}, 400], ["{}", { "content-length": "12001" }, 413],
 [" ".repeat(12001), {}, 413],
])("rejects missing, malformed or oversized enrollment before credential work", async (body, headers, status) => {
 const response = await handleShiftAuthorEnroll(new Request("https://fixture.invalid", { method: "POST", body, headers }));
 expect(response.status).toBe(status); expect(h.enroll).not.toHaveBeenCalled();
});
it("retains fatal UTF-8 decoding without forwarding a malformed enrollment", async () => {
 const result = await snapshot(await handleShiftAuthorEnroll(new Request("https://fixture.invalid", { method: "POST", body: new Uint8Array([0xff]) })));
 expect(result.status).toBe(403); expect(result.body.code).toBe("ESHIFT_AUTHOR_INVALID"); expect(h.enroll).not.toHaveBeenCalled();
});
it("preserves typed author failures and masks unexpected enrollment failures", async () => {
 for (const [error, status, code] of [
  [new ShiftAuthorError("ESHIFT_AUTHOR_REVOKED", "Existing typed guidance", 403), 403, "ESHIFT_AUTHOR_REVOKED"],
  [Object.assign(new Error("PRIVATE fixture detail"), { status: 503 }), 503, "ESHIFT_AUTHOR_UNAVAILABLE"],
  [new Error("PRIVATE fixture detail"), 403, "ESHIFT_AUTHOR_INVALID"],
 ] as const) {
  h.enroll.mockRejectedValue(error);
  const result = await snapshot(await handleShiftAuthorEnroll(new Request("https://fixture.invalid", { method: "POST", body: "{}" })));
  expect(result.status).toBe(status); expect(result.body.code).toBe(code); expect(JSON.stringify(result)).not.toContain("PRIVATE");
 }
});
