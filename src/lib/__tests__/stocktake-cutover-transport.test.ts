import { describe, beforeEach, expect, it, vi } from "vitest";
import { stocktakeCutover, stocktakeCutoverSchema } from "../stocktake-cutover.server";

const { serviceRest } = vi.hoisted(() => ({ serviceRest: vi.fn() }));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest }));
vi.mock("../external-supabase-config", () => ({ supabaseConfig: () => ({ url: "https://beta.fixture" }) }));

const terminalId = "11111111-1111-4111-8111-111111111111";
const databaseId = "22222222-2222-4222-8222-222222222222";
const stocktakeId = "33333333-3333-4333-8333-333333333333";
const scope = { version: 1 as const, branchId: "A", terminalId, stocktakeId };
const terminal = { id: terminalId, branchId: "A", platform: "pc", mode: "operations" } as Parameters<typeof stocktakeCutover>[1];
const signal = new AbortController().signal;
beforeEach(() => { serviceRest.mockReset(); });

describe("verified Stock Report cutover transport", () => {
  it("uses the server-bound project, Administrator, terminal and exact database for a lease lookup", async () => {
    const result = { stocktakeId, branchId: "A", projectOrigin: "https://beta.fixture", terminalId, databaseId, state: "armed",
      leaseIssuedAt: "2026-11-21T00:00:00.0000000Z", leaseExpiresAt: "2026-11-21T00:05:00.0000000Z" };
    serviceRest.mockResolvedValue(Response.json(result));
    const response = await stocktakeCutover({ ...scope, action: "lease", databaseId, purpose: "confirm" },
      terminal, "verified-admin", signal);
    expect(await response.json()).toEqual({ ok: true, version: 1, branchId: "A", terminalId, projectOrigin: "https://beta.fixture", result });
    const [path, init] = serviceRest.mock.calls[0];
    expect(path).toBe("rpc/pos_stock_history_load_stocktake_lease");
    expect(JSON.parse(init.body)).toEqual({ p_subject: "verified-admin", p_terminal: terminalId, p_project: "https://beta.fixture",
      p_branch: "A", p_id: stocktakeId, p_database: databaseId, p_purpose: "confirm" });
  });

  it("rejects foreign operations terminals and untrusted actor, project or count fields", async () => {
    expect(stocktakeCutoverSchema.safeParse({ ...scope, action: "prepare", subject: "forged", project: "https://other.fixture" }).success).toBe(false);
    expect(stocktakeCutoverSchema.safeParse({ ...scope, action: "arm", proofs: [], pending: 0 }).success).toBe(false);
    expect((await stocktakeCutover({ ...scope, action: "prepare", branchId: "B" }, terminal, "admin", signal)).status).toBe(403);
    expect(serviceRest).not.toHaveBeenCalled();
  });

  it("preserves a known stocktake hold without trusting a changed response", async () => {
    serviceRest.mockResolvedValueOnce(Response.json({ message: "STOCK_CUTOVER_RELEASE_UNCONFIRMED" }, { status: 400 }));
    const result = await stocktakeCutover({ ...scope, action: "release-status", databaseId }, terminal, "admin", signal);
    expect(result.status).toBe(409);
    expect(await result.json()).toEqual({ ok: false, code: "STOCK_CUTOVER_RELEASE_UNCONFIRMED" });
    serviceRest.mockResolvedValueOnce(Response.json({ stocktakeId, branchId: "B" }));
    expect((await stocktakeCutover({ ...scope, action: "prepare" }, terminal, "admin", signal)).status).toBe(503);
  });
});
