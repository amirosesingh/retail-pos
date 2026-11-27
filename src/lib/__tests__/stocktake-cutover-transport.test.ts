import { describe, beforeEach, expect, it, vi } from "vitest";
import { stocktakeCutover, stocktakeCutoverSchema } from "../stocktake-cutover.server";

const { serviceRest, runtimeEnvValue, release } = vi.hoisted(() => ({
  serviceRest: vi.fn(), runtimeEnvValue: vi.fn(), release: { value: "beta" },
}));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest }));
vi.mock("../external-supabase-config", () => ({ supabaseConfig: () => ({ url: "https://beta.fixture" }), runtimeEnvValue }));
vi.mock("../release-channel", () => ({ get RELEASE_CHANNEL() { return release.value; } }));

const terminalId = "11111111-1111-4111-8111-111111111111";
const databaseId = "22222222-2222-4222-8222-222222222222";
const stocktakeId = "33333333-3333-4333-8333-333333333333";
const scope = { version: 1 as const, branchId: "A", terminalId, stocktakeId };
const terminal = { id: terminalId, branchId: "A", platform: "pc", mode: "operations" } as Parameters<typeof stocktakeCutover>[1];
const signal = new AbortController().signal;
beforeEach(() => { serviceRest.mockReset(); runtimeEnvValue.mockReset(); release.value = "beta"; });

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

  it("reads the sealed count for an authorized reviewer without sending a publication or trusting caller evidence", async () => {
    const result = { stocktakeId, branchId: "A", witnessId: "44444444-4444-4444-8444-444444444444",
      evidenceHash: "a".repeat(64), rosterHash: "b".repeat(64), cutoff: "2026-11-21T00:01:00.0000000Z",
      roster: [], physicalCounts: [], correctionMovements: [] };
    expect(stocktakeCutoverSchema.safeParse({ ...scope, action: "review", evidenceHash: result.evidenceHash }).success).toBe(false);
    serviceRest.mockResolvedValue(Response.json(result));
    const response = await stocktakeCutover({ ...scope, action: "review" }, terminal, "verified-reviewer", signal);
    expect(await response.json()).toMatchObject({ ok: true, result });
    const [route, init] = serviceRest.mock.calls[0];
    expect(route).toBe("rpc/pos_stock_history_stocktake_for_review");
    expect(JSON.parse(init.body)).toEqual({ p_subject: "verified-reviewer", p_terminal: terminalId,
      p_branch: "A", p_id: stocktakeId });
  });

  it("preserves a known stocktake hold without trusting a changed response", async () => {
    serviceRest.mockResolvedValueOnce(Response.json({ message: "STOCK_CUTOVER_RELEASE_UNCONFIRMED" }, { status: 400 }));
    const result = await stocktakeCutover({ ...scope, action: "release-status", databaseId }, terminal, "admin", signal);
    expect(result.status).toBe(409);
    expect(await result.json()).toEqual({ ok: false, code: "STOCK_CUTOVER_RELEASE_UNCONFIRMED" });
    serviceRest.mockResolvedValueOnce(Response.json({ stocktakeId, branchId: "B" }));
    expect((await stocktakeCutover({ ...scope, action: "prepare" }, terminal, "admin", signal)).status).toBe(503);
  });

  it("pins the application enrollment to the configured Beta backend, project and two distinct physical tills", async () => {
    const branchId = "codex-stock401-123abc";
    const otherId = "44444444-4444-4444-8444-444444444444";
    const pilot = { backendOrigin: "https://relay.fixture", projectOrigin: "https://beta.fixture", branchId,
      previousBranchId: "codex-stock401-456def", marker: branchId.toUpperCase(), tills: [
        { terminalId, databaseId, authorId: stocktakeId },
        { terminalId: otherId, databaseId: stocktakeId, authorId: databaseId },
      ] };
    const input = { version: 1 as const, action: "enroll" as const, branchId, terminalId, databaseId, challengeId: otherId };
    const verified = { ...terminal, branchId };
    const request = (url = pilot.backendOrigin, payload: typeof input = input) =>
      stocktakeCutover(payload, verified, "verified-admin", signal, `${url}/api/v1/pos/sync`);
    expect(stocktakeCutoverSchema.safeParse({ ...input, p_cohort: pilot.tills }).success).toBe(false);
    expect((await request()).status).toBe(403);
    runtimeEnvValue.mockReturnValue(JSON.stringify(pilot));
    expect((await request("https://other.fixture")).status).toBe(403);
    expect((await request(pilot.backendOrigin, { ...input, databaseId: otherId })).status).toBe(403);
    release.value = "stable";
    expect((await request()).status).toBe(403);
    expect(serviceRest).not.toHaveBeenCalled();
    release.value = "beta";
    const result = { branchId, terminalId, databaseId, projectOrigin: pilot.projectOrigin, cohortReady: false };
    serviceRest.mockResolvedValueOnce(Response.json(result));
    expect(await (await request()).json()).toMatchObject({ ok: true, result });
    const [path, init] = serviceRest.mock.calls[0];
    expect(path).toBe("rpc/pos_stock_history_enroll_stocktake_till");
    expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body)).toEqual({ p_subject: "verified-admin", p_terminal: terminalId, p_project: pilot.projectOrigin,
      p_branch: branchId, p_previous: pilot.previousBranchId, p_marker: pilot.marker, p_cohort: pilot.tills,
      p_database: databaseId, p_challenge: otherId });
    serviceRest.mockResolvedValueOnce(Response.json({ ...result, databaseId: otherId }));
    expect((await request()).status).toBe(503);
  });

  it("requires a separate trusted financial approval flag and forwards only the authenticated till proof", async () => {
    const branchId = "codex-stock401-123abc";
    const challengeId = "44444444-4444-4444-8444-444444444444";
    const pilot = { backendOrigin: "https://relay.fixture", projectOrigin: "https://beta.fixture", branchId,
      previousBranchId: "codex-stock401-456def", marker: branchId.toUpperCase(), tills: [
        { terminalId, databaseId, authorId: stocktakeId },
        { terminalId: challengeId, databaseId: stocktakeId, authorId: databaseId },
      ] };
    const input = { version: 1 as const, action: "approve-financial" as const, branchId, terminalId, databaseId, challengeId };
    const request = (url = pilot.backendOrigin, physicalDatabase: string = databaseId) => stocktakeCutover(
      { ...input, databaseId: physicalDatabase }, { ...terminal, branchId }, "verified-admin", signal, `${url}/api/v1/pos/sync`);
    expect(stocktakeCutoverSchema.safeParse({ ...input, authorId: stocktakeId, allowFinancialApproval: true }).success).toBe(false);
    for (const enabled of [undefined, false]) {
      runtimeEnvValue.mockReturnValue(JSON.stringify({ ...pilot, allowFinancialApproval: enabled }));
      expect((await request()).status).toBe(403);
    }
    runtimeEnvValue.mockReturnValue(JSON.stringify({ ...pilot, allowFinancialApproval: true }));
    expect((await request("https://foreign.fixture")).status).toBe(403);
    expect((await request(pilot.backendOrigin, stocktakeId)).status).toBe(403);
    release.value = "stable";
    expect((await request()).status).toBe(403);
    expect(serviceRest).not.toHaveBeenCalled();

    release.value = "beta";
    const result = { projectOrigin: pilot.projectOrigin, branchId, terminalId, databaseId, cohortReady: false };
    serviceRest.mockResolvedValueOnce(Response.json(result));
    expect(await (await request()).json()).toMatchObject({ ok: true, result });
    const [path, init] = serviceRest.mock.calls[0];
    expect(path).toBe("rpc/pos_stock_history_approve_financial_till");
    expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body)).toEqual({ p_subject: "verified-admin", p_terminal: terminalId, p_project: pilot.projectOrigin,
      p_branch: branchId, p_database: databaseId, p_challenge: challengeId });
    serviceRest.mockResolvedValueOnce(Response.json({ ...result, terminalId: challengeId }));
    expect((await request()).status).toBe(503);
  });

  it("allows a rollout opening only for the enabled Beta pilot and its complete pair of physical till proofs", async () => {
    const branchId = "codex-stock401-123abc";
    const peerId = "44444444-4444-4444-8444-444444444444";
    const pilot = { backendOrigin: "https://relay.fixture", projectOrigin: "https://beta.fixture", branchId,
      previousBranchId: "codex-stock401-456def", marker: branchId.toUpperCase(), tills: [
        { terminalId, databaseId, authorId: stocktakeId },
        { terminalId: peerId, databaseId: stocktakeId, authorId: databaseId },
      ] };
    const cutoff = "2026-11-21T00:01:00.0000000Z";
    const first = { terminalId, databaseId, challengeId: peerId, fenceGeneration: stocktakeId,
      localFencedAt: cutoff, localExpiresAt: "2026-11-21T00:05:00.0000000Z" };
    const peer = { ...first, terminalId: peerId, databaseId: stocktakeId, challengeId: terminalId };
    const input = { ...scope, branchId, action: "activate-rollout" as const, proofs: [first, peer] };
    const request = (payload = input, url = pilot.backendOrigin) =>
      stocktakeCutover(payload, { ...terminal, branchId }, "verified-admin", signal, `${url}/api/v1/pos/sync`);
    expect(stocktakeCutoverSchema.safeParse({ ...input, cutoff }).success).toBe(false);
    runtimeEnvValue.mockReturnValue(JSON.stringify(pilot));
    expect((await request()).status).toBe(403);
    runtimeEnvValue.mockReturnValue(JSON.stringify({ ...pilot, allowRolloutActivation: true }));
    expect((await request(input, "https://other.fixture")).status).toBe(403);
    expect((await request({ ...input, proofs: [first] })).status).toBe(403);
    expect((await request({ ...input, proofs: [first, first] })).status).toBe(403);
    expect((await request({ ...input, proofs: [first, { ...peer, databaseId }] })).status).toBe(403);
    release.value = "stable";
    expect((await request()).status).toBe(403);
    expect(serviceRest).not.toHaveBeenCalled();
    release.value = "beta";
    const result = { branchId, baselineId: stocktakeId, cutoff, openingKind: "system_snapshot",
      verificationState: "verified", productCount: 2 };
    serviceRest.mockResolvedValueOnce(Response.json(result));
    expect(await (await request()).json()).toMatchObject({ ok: true, result });
    const [path, init] = serviceRest.mock.calls[0];
    expect(path).toBe("rpc/pos_stock_history_activate_rollout");
    expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body)).toEqual({ p_subject: "verified-admin", p_terminal: terminalId, p_project: pilot.projectOrigin,
      p_branch: branchId, p_id: stocktakeId, p_proofs: input.proofs });
    serviceRest.mockResolvedValueOnce(Response.json({ ...result, cutoff: "2026-11-21" }));
    expect((await request()).status).toBe(503);
  });
});
