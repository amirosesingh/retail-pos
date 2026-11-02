import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), origin: "https://pos.example.test", expired: vi.fn(), epoch: 7 }));
vi.mock("@/lib/fetch-deadline", () => ({ fetchWithDeadline: mocks.fetch }));
vi.mock("@/lib/pos-credentials", () => ({ authHeaders: async () => ({ Authorization: "Bearer fixture-session" }), readCredentials: async () => ({ terminalToken: "fixture-terminal", deviceBindingProof: "fixture-proof" }), cashierTokenSync: () => null }));
vi.mock("@/lib/server-origin", () => ({ serverOrigin: () => mocks.origin, serverUrl: (url: string) => mocks.origin + url, serverUnreachableOnDevice: () => false }));
vi.mock("@/core/activation/terminal-tokens", () => ({ readTerminalConfig: () => null }));
vi.mock("@/lib/session-presence", () => ({ centralAuthAccessToken: () => null, hasCentralAuthSession: () => false }));
vi.mock("@/lib/session-epoch", () => ({ sessionEpoch: () => mocks.epoch }));
vi.mock("@/lib/session-expiry", () => ({ notifySessionExpired: mocks.expired }));
import { relayOp, relayTransferRequestApprovalState } from "@/core/api/sync-relay";
const op = { kind: "rpc" as const, table: "stock_transfers", fn: "stock_transfer_dispatch_atomic", args: { p_transfer_id: "fixture-transfer" } };
beforeEach(() => { vi.clearAllMocks(); mocks.origin = "https://pos.example.test"; mocks.epoch = 7; });

it("carries native dispatch data through the existing protected public alias and credential headers", async () => {
  mocks.fetch.mockResolvedValue(Response.json({ ok: true, results: [{ ok: true, data: { version: 1 } }] }));
  await expect(relayOp(op)).resolves.toEqual({ ok: true, data: { version: 1 } });
  const [url, options] = mocks.fetch.mock.calls[0];
  expect(url).toBe("https://pos.example.test/api/public/sync");
  expect(options.headers.Authorization).toBe("Bearer fixture-session");
  expect(JSON.parse(options.body)).toEqual({ terminalToken: "fixture-terminal", deviceBindingProof: "fixture-proof", ops: [op] });
});
it("preserves individual SQL failure codes without converting them to success", async () => {
  mocks.fetch.mockResolvedValue(Response.json({ ok: true, results: [{ ok: false, code: "23514", error: "Short by 1 of item at the sending branch" }] }));
  await expect(relayOp(op)).resolves.toMatchObject({ ok: false, code: "23514" });
});
it("retains explicit permission status without expiring a valid session", async () => {
  mocks.fetch.mockResolvedValue(Response.json({ ok: false, code: "PERMISSION_DENIED", error: "Denied" }, { status: 403 }));
  await expect(relayOp(op)).resolves.toMatchObject({ ok: false, code: "PERMISSION_DENIED", status: 403 });
  expect(mocks.expired).not.toHaveBeenCalled();
});
it("preserves existing session expiry handling and browser route selection", async () => {
  mocks.origin = ""; mocks.fetch.mockResolvedValue(Response.json({ ok: false, code: "SESSION_INVALID" }, { status: 401 }));
  await relayOp(op); expect(mocks.fetch.mock.calls[0][0]).toBe("/api/v1/pos/sync"); expect(mocks.expired).toHaveBeenCalledWith(7);
});
it("does not alter success for existing void-operation callers", async () => {
  mocks.fetch.mockResolvedValue(Response.json({ ok: true }));
  await expect(relayOp({ ...op, fn: "stock_transfer_receive" })).resolves.toEqual({ ok: true });
});
it("retains transport timeout classification for a bounded dispatch reconciliation", async () => {
  mocks.fetch.mockRejectedValue(Object.assign(new Error("Request aborted"), { name: "AbortError" }));
  await expect(relayOp(op)).resolves.toMatchObject({ ok: false, code: "AbortError" });
});
it("reads native approval reconciliation through the same verified central transport, never a local query", async () => {
  mocks.fetch.mockResolvedValue(Response.json({ ok: true, row: { request: { id: "request" } } }));
  expect(await relayTransferRequestApprovalState("request")).toEqual({ ok: true, row: { request: { id: "request" } } });
  const [url, options] = mocks.fetch.mock.calls[0]; expect(url).toBe("https://pos.example.test/api/public/sync");
  expect(options.headers.Authorization).toBe("Bearer fixture-session");
  expect(JSON.parse(options.body)).toEqual({ terminalToken: "fixture-terminal", deviceBindingProof: "fixture-proof", read: { kind: "transferRequestApprovalState", requestId: "request" } });
});
it("keeps approval-read diagnostics private and preserves existing session expiry handling", async () => {
  mocks.fetch.mockResolvedValue(Response.json({ ok: false, code: "SESSION_INVALID", error: "PRIVATE backend SQL" }, { status: 401 }));
  const result = await relayTransferRequestApprovalState("request"); expect(result).toMatchObject({ ok: false, code: "SESSION_INVALID" });
  expect(result.error).not.toContain("PRIVATE"); expect(mocks.expired).toHaveBeenCalledWith(7);
});
it("refuses a late approval-read response from an earlier signed-in session", async () => {
  mocks.fetch.mockImplementation(async () => { mocks.epoch++; return Response.json({ ok: true, row: { request: { id: "request" } } }); });
  expect(await relayTransferRequestApprovalState("request")).toMatchObject({ ok: false, code: "SESSION_CHANGED" });
});
