import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rest: vi.fn() }));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: mocks.rest }));
import { protectedHeldStatus } from "../protected-held-status.server";
const args = { read: { organizationId: "default", branchId: "A", tickets: [{ id: "held", billNo: "BILL", shiftId: null }] }, terminalId: "terminal", keepCommerce: false };
function response(text = '{"fixture":true}', overrides: Record<string, string> = {}, body?: BodyInit) {
  return new Response(body ?? text, { headers: { "content-type": "application/json", "X-POS-Held-Status-Version": "1",
    "X-POS-Held-Status-Bytes": String(Buffer.byteLength(text)), "X-POS-Held-Status-Rows": "1", ...overrides } });
}
beforeEach(() => { mocks.rest.mockReset(); });
describe("bounded held-status transport", () => {
  it("forwards only attested bytes without reparsing exact identity JSON or selecting privacy from the request", async () => {
    const text = '{"identityJson":"{\\"total\\":9007199254740993.11}"}';
    mocks.rest.mockResolvedValue(response(text)); const result = await protectedHeldStatus(args);
    expect(result.status).toBe(200); expect(await result.text()).toBe(text);
    expect(mocks.rest.mock.calls[0][0]).toBe("rpc/pos_sync_held_status_v1");
    expect(JSON.parse(mocks.rest.mock.calls[0][1].body)).toEqual({ p_organization_id: "default", p_branch_id: "A", p_terminal_id: "terminal",
      p_tickets: args.read.tickets, p_keep_commerce: false, p_max_bytes: 2097152 });
  });
  it.each([{ name: "X-POS-Held-Status-Version", value: "2" }, { name: "X-POS-Held-Status-Bytes", value: "2097153" },
    { name: "X-POS-Held-Status-Rows", value: "2" }, { name: "content-encoding", value: "gzip" }, { name: "content-length", value: "1" }])("refuses malformed attestation $name", async ({ name, value }) => {
    mocks.rest.mockResolvedValue(response(undefined, { [name]: value })); expect((await protectedHeldStatus(args)).status).toBe(502);
  });
  it("rejects both truncated and excess response streams before accepting any proof", async () => {
    for (const text of ["x", "x".repeat(100)]) { mocks.rest.mockResolvedValue(response(undefined, {}, new TextEncoder().encode(text))); expect((await protectedHeldStatus(args)).status).toBe(502); }
  });
  it.each([401, 403, 404, 409, 503])("retains upstream status %s and never falls back to a broad read", async status => {
    mocks.rest.mockResolvedValue(Response.json({ code: "UNCHANGED" }, { status })); const result = await protectedHeldStatus(args);
    expect(result.status).toBe(status); expect(await result.json()).toEqual({ code: "UNCHANGED" }); expect(mocks.rest).toHaveBeenCalledOnce();
  });
  it("keeps a transport failure unavailable rather than inventing an empty completed result", async () => {
    mocks.rest.mockRejectedValue(new TypeError("synthetic fixture network")); const result = await protectedHeldStatus(args);
    expect(result.status).toBe(503); expect(await result.json()).toMatchObject({ ok: false, code: "SERVICE_UNAVAILABLE" });
  });
});
