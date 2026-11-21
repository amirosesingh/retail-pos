import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createStockHistoryRuntime, installedStockHistoryEnrollment } = require("../../../electron/stock-history-runtime.cjs");
const { SyncCoordinator } = require("../../../electron/sync/coordinator.cjs");

const enrollment = {
  branchId: "pilot-a",
  terminalId: "11111111-1111-4111-8111-111111111111",
  backendOrigin: "https://pos.fixture",
  projectOrigin: "https://project.fixture",
  databaseGuid: "22222222-2222-4222-8222-222222222222",
};
const product = "33333333-3333-4333-8333-333333333333";
const operation = "44444444-4444-4444-8444-444444444444";
const actor = "55555555-5555-4555-8555-555555555555";
const operations = [{ table: "products", kind: "update", match: { id: product }, values: { stock_quantity: 2 } }];
const movement = { operationId: operation, branchId: enrollment.branchId, terminalId: enrollment.terminalId, kind: "transfer" };
const history = { aggregateId: operation, changes: [{ entity_type: "stock_history_movements" }] };

function fixture(configured: typeof enrollment | null = enrollment) {
  const pool = {}, tx = {};
  const terminal = { tokenId: enrollment.terminalId, locationId: enrollment.branchId, deviceUse: "operations", deviceType: "pc",
    deviceBindingProof: "a".repeat(64) };
  const source = { terminal, base: enrollment.backendOrigin, project: { projectOrigin: enrollment.projectOrigin, branchId: enrollment.branchId },
    profile: { id: "fixture" }, pool, fingerprint: "verified-source" };
  const person = { source: "pos", level: "staff", branchId: enrollment.branchId, authorId: actor, canonicalSubject: "pilot-actor" };
  let epoch = 1;
  const cloud = { requestContext: vi.fn(() => source), assertRequestContext: vi.fn(), pushStockHistory: vi.fn() };
  const query = vi.fn();
  class Request {
    input() { return this; }
    query = query;
  }
  const manager = { pool, sql: () => ({ Request }) };
  const prepareKey = vi.fn();
  const signStockEvent = vi.fn(() => ({ signature: "fixture-stock-proof" }));
  const runtime = createStockHistoryRuntime({
    enrollment: configured, manager, cloud, keys: { prepare: prepareKey, signStockEvent },
    session: { hasPosAuthority: () => true, identity: () => person, epoch: () => epoch, hasPermission: vi.fn(() => true) },
    terminal: () => terminal, branch: () => enrollment.branchId, project: () => enrollment.projectOrigin, ready: () => true,
  });
  return { runtime, manager, source, person, terminal, tx, query, cloud, prepareKey, signStockEvent, switchActor: () => { epoch++; } };
}

function exactCapture(f: ReturnType<typeof fixture>, before = 4, after = 2) {
  const databaseKey = enrollment.databaseGuid + ":31:exact";
  vi.spyOn(f.runtime.capture, "capability").mockResolvedValue({ available: true, databaseKey });
  vi.spyOn(f.runtime.capture, "identity").mockResolvedValue(databaseKey);
  vi.spyOn(f.runtime.capture, "snapshot")
    .mockResolvedValueOnce([{ id: product, name: "Fixture", stock_by_store: { [enrollment.branchId]: before } }])
    .mockResolvedValueOnce([{ id: product, name: "Fixture", stock_by_store: { [enrollment.branchId]: after } }]);
  vi.spyOn(f.runtime.capture, "sources").mockResolvedValue([]);
  vi.spyOn(f.runtime.capture, "ensureHead").mockResolvedValue(undefined);
  f.query.mockResolvedValue({ recordset: [{ recorded_at: "2026-11-20T00:00:00.0000000Z" }] });
}

describe("Main stock history pilot scope", () => {
  it("accepts only an exact locally configured installation binding", () => {
    const install = (value: unknown) => installedStockHistoryEnrollment({ POS_STOCK_HISTORY_PILOT_ENROLLMENT: JSON.stringify(value) });
    expect(install(enrollment)).toEqual(enrollment);
    expect(install({ ...enrollment, backendOrigin: "http://pos.fixture" })).toBeNull();
    expect(install({ ...enrollment, authorId: actor })).toBeNull();
    expect(installedStockHistoryEnrollment({})).toBeNull();
  });

  it("preserves a stock-only pending aggregate without opening a connection for a disabled pilot", async () => {
    const f = fixture(null);
    expect(f.runtime.capture).toBeNull();
    expect(await f.runtime.uploader.upload(history, enrollment.branchId, enrollment.terminalId))
      .toMatchObject({ held: { code: "ESTOCK_HISTORY_ROUTE_UNAVAILABLE", fresh: false } });
    expect(f.cloud.requestContext).not.toHaveBeenCalled();
    expect(f.query).not.toHaveBeenCalled();
    expect(f.cloud.pushStockHistory).not.toHaveBeenCalled();
    await expect(f.runtime.uploader.upload({ ...history, changes: [...history.changes, { entity_type: "sales" }] },
      enrollment.branchId, enrollment.terminalId)).rejects.toMatchObject({ code: "ESTOCK_HISTORY_ACK_UNCONFIRMED" });
  });

  it("rejects a foreign source before querying SQL or loading authority", async () => {
    const f = fixture();
    f.source.base = "https://different.fixture";
    expect(await f.runtime.capture.begin(f.tx, operations, movement)).toBeNull();
    expect(await f.runtime.captureReady({ pool: f.manager.pool, branchId: enrollment.branchId,
      terminalId: enrollment.terminalId, authorId: actor })).toBe(false);
    expect(f.query).not.toHaveBeenCalled();
    expect(f.prepareKey).not.toHaveBeenCalled();
  });

  it("checks the real SQL GUID before reading schema or claiming an arrival capability", async () => {
    const f = fixture();
    f.query.mockResolvedValue({ recordset: [{ database_guid: product, schema_generation: "31" }] });
    expect(await f.runtime.capture.begin(f.tx, operations, movement)).toBeNull();
    expect(await f.runtime.captureReady({ pool: f.manager.pool, branchId: enrollment.branchId,
      terminalId: enrollment.terminalId, authorId: actor })).toBe(false);
    expect(f.query).toHaveBeenCalledTimes(2);
    expect(f.prepareKey).not.toHaveBeenCalled();
  });

  it("captures an unsupported writer as unsigned history and an explicit gap", async () => {
    const f = fixture();
    exactCapture(f);
    const insert = vi.spyOn(f.runtime.capture, "insertMovements").mockResolvedValue(undefined);
    const gap = vi.spyOn(f.runtime.capture, "invalidateCoverage").mockResolvedValue(undefined);
    const token = await f.runtime.capture.begin(f.tx, operations, movement);
    expect(await f.runtime.capture.finish(f.tx, token)).toMatchObject({ captured: 1, incomplete: true });
    expect(insert).toHaveBeenCalledWith(f.tx, enrollment.branchId, [
      expect.objectContaining({ product_id: product, actor_id: actor, clock_state: "unverified", source_kind: "transfer", quantity_delta: "-2" }),
    ]);
    expect(insert.mock.calls[0]?.[2]).not.toMatchObject([expect.objectContaining({ author_proof_json: expect.any(String) })]);
    expect(gap).toHaveBeenCalledWith(f.tx, enrollment.branchId, "UNVERIFIED_STOCK_WRITER");
    expect(f.prepareKey).not.toHaveBeenCalled();
  });

  it.each([true, false])("signs only the attested grouped checkout stock evidence (grouped cash %s)", async groupedCashOrigin => {
    const f = fixture();
    exactCapture(f);
    const keyId = "66666666-6666-4666-8666-666666666666", publicKey = "fixture-key";
    f.prepareKey.mockReturnValue({ enrolled: true, keyId, publicKey });
    f.query.mockImplementation(async (sql: string) => ({ recordset: sql.includes("pos_sync_shift_author_keys")
      ? [{ project_origin: enrollment.projectOrigin, terminal_id: enrollment.terminalId, author_id: actor, key_id: keyId, public_key: publicKey }]
      : [{ recorded_at: "2026-11-20T00:00:00.0000000Z" }] }));
    const insert = vi.spyOn(f.runtime.capture, "insertMovements").mockResolvedValue(undefined);
    const gap = vi.spyOn(f.runtime.capture, "invalidateCoverage").mockResolvedValue(undefined);
    const token = await f.runtime.capture.begin(f.tx, operations, { ...movement, kind: "sale", groupedCashOrigin });
    expect(await f.runtime.capture.finish(f.tx, token)).toMatchObject({ captured: 1, incomplete: !groupedCashOrigin });
    const rows = insert.mock.calls[0]?.[2];
    if (!Array.isArray(rows)) throw new Error("Expected captured stock movements");
    const [row] = rows;
    expect(row).toMatchObject({ actor_id: actor, source_kind: "sale", quantity_delta: "-2", clock_state: "unverified" });
    if (groupedCashOrigin) {
      expect(f.signStockEvent).toHaveBeenCalledWith({ projectOrigin: enrollment.projectOrigin, terminalId: enrollment.terminalId, authorId: actor },
        expect.objectContaining({ expectedKeyId: keyId, action: "SALE", branchId: enrollment.branchId, operationId: operation }));
      expect(row).toHaveProperty("author_proof_json", JSON.stringify({ signature: "fixture-stock-proof" }));
      expect(gap).not.toHaveBeenCalled();
    } else {
      expect(f.signStockEvent).not.toHaveBeenCalled();
      expect(row).not.toHaveProperty("author_proof_json");
      expect(gap).toHaveBeenCalledWith(f.tx, enrollment.branchId, "UNVERIFIED_STOCK_WRITER");
    }
  });

  it("does not attach a newly signed-in author to an admitted original write", async () => {
    const f = fixture();
    exactCapture(f);
    const token = await f.runtime.capture.begin(f.tx, operations, movement);
    f.switchActor();
    await expect(f.runtime.capture.finish(f.tx, token)).rejects.toMatchObject({ code: "ESTOCK_HISTORY_CONTEXT_CHANGED" });
  });

  it.each(["original", "other-key", "legacy"])("requires the original enrolled refund signer (%s)", async mode => {
    const f = fixture();
    exactCapture(f, 2, 4);
    const movementId = "77777777-7777-4777-8777-777777777777";
    vi.mocked(f.runtime.capture.sources).mockResolvedValueOnce([]).mockResolvedValueOnce([{
      table: "stock_delta_applied", id: movementId, productId: product, branchId: enrollment.branchId, delta: "2",
    }]);
    const keyId = "66666666-6666-4666-8666-666666666666", publicKey = "fixture-key";
    f.prepareKey.mockReturnValue({ enrolled: true, keyId, publicKey });
    f.query.mockImplementation(async (sql: string) => ({ recordset: sql.includes("pos_sync_shift_author_keys")
      ? [{ project_origin: enrollment.projectOrigin, terminal_id: enrollment.terminalId, author_id: actor, key_id: keyId, public_key: publicKey }]
      : [{ recorded_at: "2026-11-20T00:00:00.0000000Z" }] }));
    const insert = vi.spyOn(f.runtime.capture, "insertMovements").mockResolvedValue(undefined);
    vi.spyOn(f.runtime.capture, "invalidateCoverage").mockResolvedValue(undefined);
    const refundStockAuthor = mode === "legacy" ? null : { action: "REFUND", operationId: operation, branchId: enrollment.branchId,
      projectOrigin: enrollment.projectOrigin, terminalId: enrollment.terminalId, authorId: actor, subject: f.person.canonicalSubject,
      keyId: mode === "original" ? keyId : product };
    const token = await f.runtime.capture.begin(f.tx, operations, { ...movement, kind: "refund", refundStockAuthor });
    expect(await f.runtime.capture.finish(f.tx, token)).toMatchObject({ captured: 1, incomplete: mode !== "original" });
    const rows = insert.mock.calls[0]?.[2];
    const row = Array.isArray(rows) ? rows[0] : undefined;
    expect(row).toMatchObject({ source_kind: "refund", quantity_delta: "2", clock_state: "unverified",
      effective_at_raw: "2026-11-20T00:00:00.0000000Z", recorded_at_raw: "2026-11-20T00:00:00.0000000Z",
      source_refs: [["stock_delta_applied", movementId, "2"]], });
    if (mode === "original") {
      expect(f.signStockEvent).toHaveBeenCalledWith(expect.objectContaining({ authorId: actor }),
        expect.objectContaining({ action: "REFUND", expectedKeyId: keyId, operationId: operation }));
      expect(row).toHaveProperty("author_proof_json");
    } else {
      expect(f.signStockEvent).not.toHaveBeenCalled();
      expect(row).not.toHaveProperty("author_proof_json");
    }
  });
});

describe("stock frontier scheduling in the existing coordinator", () => {
  it("runs under the ordinary lease and does not affect the result or delay a final pass with another observation", async () => {
    const observe = vi.fn(async ({ assertLease }: { assertLease: () => boolean }) => {
      expect(assertLease()).toBe(true);
      throw new Error("Optional frontier unavailable");
    });
    const reader = { connectionManager: { pool: {} }, pendingSummary: vi.fn(async () => ({ pending: 0, failed: 0 })) };
    const push = vi.fn(async () => ({ pushed: 1 }));
    const pull = vi.fn(async () => ({ merged: 1 }));
    const coordinator = new SyncCoordinator({ pushWorker: { reader, run: push }, pullWorker: { run: pull }, observeStockFrontier: observe });
    expect(await coordinator.runNow({ branchId: enrollment.branchId })).toMatchObject({ ok: true, pushed: 1, merged: 1 });
    expect(observe).toHaveBeenCalledTimes(1);
    expect(await coordinator.runFinal({ branchId: enrollment.branchId })).toMatchObject({ ok: true, allUploaded: true });
    expect(observe).toHaveBeenCalledTimes(1);
    expect(pull).toHaveBeenCalledTimes(1);
  });
});
