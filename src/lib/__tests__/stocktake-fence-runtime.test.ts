import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createStockCoverageFrontierRuntime } = require("../../../electron/stock-coverage-frontier-runtime.cjs");
const { stockCoverageFrontierMessage } = require("../../../electron/security/stock-event-author-protocol.cjs");
const database = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const terminalId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const author = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const stocktakeId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const generation = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const keyId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const project = "https://supabase.fixture.test";
const issuedAt = "2026-11-21T04:00:00.0000000Z";
const fencedAt = "2026-11-21T04:00:01.1234567Z";
const expiresAt = "2026-11-21T04:05:00.0000000Z";
const observedAt = "2026-11-21T04:00:02.1234567Z";
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

function setup() {
  const pair = generateKeyPairSync("ed25519");
  const publicKey = pair.publicKey.export({ type: "spki", format: "der" }).toString("base64url");
  const state = {
    active: false, armed: false, released: false, role: "admin", epoch: 1, hasAuthority: true,
    context: "exact Beta identity", now: observedAt, generation, sqlDatabase: database, pins: true,
    marker: "a".repeat(64), gapHash: digest("[]"), pending: { business: "0", metadata: "0", unsigned: "0", unknown: "0" },
  };
  const events: string[] = [];
  let transaction: Transaction | null = null;

  class Transaction {
    async begin(isolation: string) {
      expect(isolation).toBe("SERIALIZABLE");
      expect(transaction).toBeNull();
      transaction = this;
    }
    async commit() {
      expect(transaction).toBe(this);
      transaction = null;
    }
    async rollback() { transaction = null; }
  }
  class Request {
    values: Record<string, string> = {};
    constructor(private owner: unknown) {}
    input(name: string, typeOrValue: string, value?: string) {
      this.values[name] = value ?? typeOrValue;
      return this;
    }
    async query(sql: string) {
      if (sql.includes("FROM dbo.pos_sync_shift_author_keys")) {
        expect(transaction).toBeNull();
        return { recordset: [{ project_origin: project, terminal_id: terminalId, author_id: author, key_id: keyId, public_key: publicKey }] };
      }
      expect(this.owner).toBe(transaction);
      expect(transaction).not.toBeNull();
      if (sql.includes("/*stocktake:optional*/")) return { recordset: [{ installed: true }] };
      if (sql.includes("/*stocktake:normal-observation*/")) return { recordset: [{ paused: state.armed && !state.released && state.now < expiresAt }] };
      expect(this.values).toMatchObject({ project, branch: "A", database, stocktake: stocktakeId, terminal: terminalId });
      if (sql.includes("/*stocktake:arm*/")) {
        expect(this.values.expires).toBe(expiresAt);
        if (!state.pins || state.sqlDatabase !== database || state.released) throw Error("STOCKTAKE_REFUSED");
        events.push("arm");
        state.armed = true;
        return {};
      }
      if (sql.includes("/*stocktake:release*/")) {
        expect(this.values.generation).toBe(state.generation);
        events.push("release");
        state.released = true;
        return {};
      }
      expect(sql).toContain("/*stocktake:fence*/");
      expect(sql).toContain("is_not_for_replication=0");
      expect(sql).toContain("HASHBYTES('SHA2_256'");
      if (!state.pins || state.sqlDatabase !== database) throw Error("STOCKTAKE_REFUSED");
      events.push("fence");
      return { recordset: state.armed ? [{
        generation: state.generation, fenced_at: fencedAt, expires_at: expiresAt, observed_at: state.now, released: state.released,
      }] : [] };
    }
  }
  const manager = { pool: {}, sql: () => ({ Transaction, Request, NVarChar: String, ISOLATION_LEVEL: { SERIALIZABLE: "SERIALIZABLE" } }) };
  const assertOutsideTx = () => expect(transaction).toBeNull();
  const drain = vi.fn(async () => {
    assertOutsideTx();
    events.push("drain");
    return { ok: true, final: true, allUploaded: true, pending: 0, failed: 0 };
  });
  const loadLease = vi.fn(async (_scope, purpose) => {
    assertOutsideTx();
    return { stocktakeId, projectOrigin: project, branchId: "A", terminalId, databaseId: database,
      state: purpose === "confirm" ? "armed" : "draining", leaseIssuedAt: issuedAt, leaseExpiresAt: expiresAt };
  });
  const loadRelease = vi.fn<() => Promise<unknown>>(async () => null);
  const readSnapshot = vi.fn(async (input: { transaction: Transaction; firstStocktake: boolean; assertCurrent(): void }) => {
    expect(input.transaction).toBe(transaction);
    expect(input.firstStocktake).toBe(true);
    input.assertCurrent();
    events.push("snapshot");
    return { available: true, databaseId: state.sqlDatabase, databaseKey: database + ":31:fixture", branchId: "A", terminalId,
      observedAt: state.now, sourceSequence: "0", sourceRoot: null, sourceGeneration: state.marker,
      gapHash: state.gapHash, pending: { ...state.pending }, blockers: [] };
  });
  const keys = {
    prepare: () => ({ enrolled: true, keyId, publicKey }),
    signStockCoverageFrontier: vi.fn((_binding, data) => {
      expect(transaction).not.toBeNull();
      events.push("sign");
      const { challengeId } = JSON.parse(data.frontierJson);
      const fields = { version: 1, algorithm: "Ed25519", keyId, projectOrigin: project, terminalId, authorId: author,
        subject: "synthetic-admin", branchId: "A", challengeId, frontierHash: digest(data.frontierJson) };
      return { ...fields, signature: sign(null, Buffer.from(stockCoverageFrontierMessage(fields)), pair.privateKey).toString("base64url") };
    }),
  };
  const wire: Array<{ frontierJson: string; proofJson: string }> = [];
  const cloud = {
    requestStockFrontierChallenge: vi.fn(async (input) => {
      assertOutsideTx();
      events.push("challenge");
      return { ok: true, version: 1, branchId: "A", terminalId, challenge: { challengeId: input.challengeId, issuedAt: observedAt,
        expiresAt, nonce: "A".repeat(43), cohortHash: "b".repeat(64) } };
    }),
    acceptStockFrontier: vi.fn(async (input) => {
      assertOutsideTx();
      events.push("submit");
      wire.push(input);
      const { challengeId } = JSON.parse(input.frontierJson);
      const { signature, ...fields } = JSON.parse(input.proofJson);
      expect(verify(null, Buffer.from(stockCoverageFrontierMessage(fields)), pair.publicKey, Buffer.from(signature, "base64url"))).toBe(true);
      return { ok: true, version: 1, branchId: "A", terminalId, receipt: { challengeId, frontierHash: fields.frontierHash,
        acceptedAt: observedAt, state: "accepted", observationGrade: "author_claimed", reasons: [] } };
    }),
  };
  const session = {
    hasPosAuthority: () => state.hasAuthority,
    identity: () => ({ source: "pos", level: state.role, authorId: author, canonicalSubject: "synthetic-admin", branchId: "A" }),
    epoch: () => state.epoch,
  };
  const runtime = createStockCoverageFrontierRuntime({
    manager, keys, session, terminal: () => ({ tokenId: terminalId, platform: "pc", mode: "operations", locationId: "A" }),
    branch: () => "A", project: () => project, context: () => state.context, cloud, readSnapshot, expectedDatabaseGuid: database,
    stocktakeBackend: { drain, loadLease, loadRelease },
  });
  const input = { assertLease: () => true, stocktakeId };
  const prove = (phase = "arm") => runtime.stocktake.prove({ ...input, phase });
  return { state, events, input, runtime, prove, drain, loadLease, loadRelease, readSnapshot, wire, cloud, keys };
}

describe("Main-only signed stocktake fence", () => {
  it("commits the fence before final push, signs only clean SQL observations, and binds phase and generation", async () => {
    const f = setup();
    await expect(f.runtime.stocktake.arm(f.input)).resolves.toMatchObject({ stocktakeId, fenceGeneration: generation });
    const arm = await f.prove();
    const confirm = await f.prove("confirm");
    expect(f.events).toEqual(["arm", "fence", ...Array.from({ length: 2 }, () =>
      ["fence", "drain", "challenge", "fence", "snapshot", "sign", "snapshot", "fence", "submit"]).flat()]);
    for (const [index, phase, claim] of [[0, "arm", arm], [1, "confirm", confirm]] as const) {
      expect(claim).toEqual({ terminalId, databaseId: database, challengeId: expect.any(String), fenceGeneration: generation,
        localFencedAt: fencedAt, localExpiresAt: expiresAt });
      const frontier = JSON.parse(f.wire[index]!.frontierJson);
      expect(frontier.gapHash).toBe(digest(["stock401-pause-v1", phase, project, "A", stocktakeId, terminalId, claim.challengeId,
        database, generation, fencedAt, expiresAt].join("\x1f")));
      expect(frontier.pending).toEqual(f.state.pending);
    }
    expect(arm.challengeId).not.toBe(confirm.challengeId);
    expect(f.runtime.status()).toMatchObject({ state: "unavailable", reason: "NOT_OBSERVED" });
  });

  it.each(["admin", "pilot", "database", "definition", "unarmed", "expiry", "upload", "snapshot", "gap", "generation", "epoch"])(
    "refuses %s failures without submitting a proof", async reason => {
      const f = setup();
      if (reason !== "unarmed") await f.runtime.stocktake.arm(f.input);
      if (reason === "admin") f.state.role = "staff";
      if (reason === "pilot") f.state.context = "";
      if (reason === "database") f.state.sqlDatabase = generation;
      if (reason === "definition") f.state.pins = false;
      if (reason === "expiry") f.state.now = expiresAt;
      if (reason === "upload") f.drain.mockResolvedValueOnce({ ok: true, final: true, allUploaded: false, pending: 1, failed: 0 });
      if (reason === "snapshot") f.state.pending.unknown = "1";
      if (reason === "gap") f.state.gapHash = "c".repeat(64);
      if (reason === "generation") f.keys.signStockCoverageFrontier.mockImplementationOnce(() => {
        f.state.generation = stocktakeId;
        return { synthetic: true } as never;
      });
      if (reason === "epoch") f.keys.signStockCoverageFrontier.mockImplementationOnce(() => {
        f.state.epoch++;
        return { synthetic: true } as never;
      });
      await expect(f.prove()).rejects.toThrow();
      expect(f.cloud.acceptStockFrontier).not.toHaveBeenCalled();
    },
  );

  it("requires trusted exact release before expiry and cannot rearm a released generation", async () => {
    const f = setup();
    await f.runtime.stocktake.arm(f.input);
    const release = () => f.runtime.stocktake.release({ ...f.input, fenceGeneration: generation, releasedAt: observedAt });
    await expect(release()).rejects.toMatchObject({ code: "ESTOCK_STOCKTAKE_RELEASE_UNCONFIRMED" });
    f.loadRelease.mockResolvedValueOnce({ stocktakeId, projectOrigin: project, branchId: "B", terminalId, databaseId: database, state: "released", releasedAt: observedAt });
    await expect(release()).rejects.toMatchObject({ code: "ESTOCK_STOCKTAKE_RELEASE_UNCONFIRMED" });
    f.loadRelease.mockResolvedValueOnce({ stocktakeId, projectOrigin: project, branchId: "A", terminalId, databaseId: database, state: "released", releasedAt: observedAt });
    await expect(release()).resolves.toEqual({ released: true });
    expect(f.state.released).toBe(true);
    await expect(f.runtime.stocktake.arm(f.input)).rejects.toThrow("STOCKTAKE_REFUSED");
    await expect(f.prove()).rejects.toMatchObject({ code: "ESTOCK_STOCKTAKE_FENCE_CLOSED" });
  });

  it("releases an expired local fence without a central release acknowledgement", async () => {
    const f = setup();
    await f.runtime.stocktake.arm(f.input);
    f.state.now = expiresAt;
    await expect(f.runtime.stocktake.release({ ...f.input, fenceGeneration: generation })).resolves.toEqual({ released: true });
    expect(f.loadRelease).not.toHaveBeenCalled();
  });

  it("defers only normal frontier observation while the qualified durable fence is active", async () => {
    const f = setup();
    await f.runtime.stocktake.arm(f.input);
    expect(await f.runtime.run({ assertLease: f.input.assertLease })).toEqual({
      state: "deferred", reason: "STOCKTAKE_FENCE_ACTIVE", coverageProven: false,
    });
    expect(f.drain).not.toHaveBeenCalled();
    expect(f.readSnapshot).not.toHaveBeenCalled();
    expect(f.cloud.requestStockFrontierChallenge).not.toHaveBeenCalled();
    expect(f.runtime.status()).toMatchObject({ reason: "NOT_OBSERVED" });
  });
});
