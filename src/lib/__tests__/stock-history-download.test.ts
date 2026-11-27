import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createStockHistoryDownloader } = require("../../../electron/sync/stock-history-download.cjs");
const { SyncCoordinator } = require("../../../electron/sync/coordinator.cjs");
const { instant, normalizeContext, changes } = require("../../../electron/db/stock-history-contract.cjs");
const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const scope = { branchId: "owned", terminalId: id(1), projectOrigin: "https://stock.fixture" };
const envelope = { ...scope, ok: true, version: 1 };
const at = "2026-11-20T00:00:00.1234567Z";
const movementAt = "2026-11-20T00:00:00.1234568Z";
const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");
const product = { id: id(2), name: "Item 📦", stock_by_store: { owned: "9007199254740993" } };
const [movement] = changes(normalizeContext({ operationId: id(3), branchId: scope.branchId, terminalId: id(4), kind: "stock", clockState: "verified" }, movementAt),
  [product], [{ ...product, stock_by_store: { owned: "9007199254740994" } }]);
const opening = [id(5), product.id, "9007199254740993", product.name, null, "000001", null];
const incomingMovement = ["8", at, movement.payload_hash, movement.payload_json];

function fixture({ rows = [[opening], [incomingMovement]], generation = "9", headCursor = "8", publication = id(7) } = {}) {
  const pageRows = rows.map(row => JSON.stringify(row, null, 1));
  const head = {
    snapshotId: publication, headCursor, coverageGeneration: generation, coverageState: "complete", coverageFrom: String(instant(at)),
    coverageThrough: String(instant(movementAt)), baseline: [id(6), at, at, "7", "physical_count", 1, "reviewer", "a".repeat(64), "{}"],
    pages: pageRows.map((page, index) => [index === 0 ? "openings" : "movements", rows[index]?.length, hash(page)]),
  };
  const manifest = { ...head, revision: hash(JSON.stringify([head.snapshotId, scope.projectOrigin, scope.branchId, scope.terminalId,
    head.headCursor, head.coverageGeneration, head.coverageState, head.coverageFrom, head.coverageThrough, head.baseline, head.pages])) };
  const manifestReply = { ...envelope, manifest };
  const page = (index: number) => ({ ...envelope, snapshotId: manifest.snapshotId, revision: manifest.revision,
    index, kind: manifest.pages[index]?.[0], rowsJson: pageRows[index] });
  const request = vi.fn(async (input: { action: string; index: number }) => input.action === "manifest" ? manifestReply : page(input.index));
  const current = vi.fn(async () => false), install = vi.fn(async (_staged: unknown) => "installed"), withdraw = vi.fn(async (_revision: string) => "withdrawn");
  const run = createStockHistoryDownloader({ request, current, install, withdraw });
  return { run, request, current, install, withdraw, page, manifestReply };
}

describe("stock-history immutable download", () => {
  it("preserves exact noncanonical JSON bytes and rechecks before taking an install lease", async () => {
    const f = fixture(), guard = vi.fn();
    let rechecking = false;
    const result = await f.run(scope, guard, async (work: (check: () => void) => Promise<string>) => {
      expect(f.request.mock.calls.map(([request]) => request.action)).toEqual(["manifest", "page", "page", "manifest"]);
      rechecking = true;
      return work(guard);
    });
    expect(rechecking).toBe(true);
    expect(result).toBe("installed");
    expect(f.request.mock.calls.map(([request]) => request.action)).toEqual(["manifest", "page", "page", "manifest"]);
    expect(f.install.mock.calls[0]?.[0]).toMatchObject({
      openings: [{ quantity: "9007199254740993", barcode: "000001" }],
      movements: [{ terminalId: id(4), payloadJson: movement.payload_json, ingestedCursor: "8", ingestedAt: at }],
    });
  });

  it.each(["foreign", "changed manifest", "tampered bytes", "cursor gap", "duplicate leg", "unverified clock"])("installs nothing for %s", async mode => {
    let f = fixture();
    if (mode === "foreign") f.request.mockResolvedValueOnce({ ...f.manifestReply, terminalId: id(44) });
    if (mode === "changed manifest") f.request.mockImplementationOnce(async () => f.manifestReply)
      .mockImplementationOnce(async () => f.page(0)).mockImplementationOnce(async () => f.page(1))
      .mockImplementationOnce(async () => fixture({ generation: "10", publication: id(19) }).manifestReply);
    if (mode === "tampered bytes") f.request.mockResolvedValueOnce(f.manifestReply)
      .mockResolvedValueOnce({ ...f.page(0), rowsJson: JSON.stringify([opening]) });
    if (mode === "cursor gap") f = fixture({ rows: [[opening], [["9", at, movement.payload_hash, movement.payload_json]]] });
    if (mode === "duplicate leg") f = fixture({ headCursor: "9", rows: [[opening], [incomingMovement, ["9", ...incomingMovement.slice(1)]]] });
    if (mode === "unverified clock") {
      const payload: unknown[] = JSON.parse(movement.payload_json);
      payload[15] = "unverified";
      const raw = JSON.stringify(payload);
      f = fixture({ rows: [[opening], [["8", at, hash(raw), raw]]] });
    }
    await expect(f.run(scope, () => undefined)).rejects.toBeDefined();
    expect(f.install).not.toHaveBeenCalled();
    expect(f.withdraw).not.toHaveBeenCalled();
  });

  it("distinguishes a missing snapshot from explicit withdrawal", async () => {
    const never = fixture(), withdrawn = fixture();
    never.request.mockResolvedValueOnce({ ...envelope, manifest: null } as never);
    withdrawn.request.mockResolvedValueOnce({ ...envelope, manifest: null, withdrawal: { coverageGeneration: "10" } } as never);
    expect(await never.run(scope, () => undefined)).toBeNull();
    expect(never.withdraw).not.toHaveBeenCalled();
    expect(await withdrawn.run(scope, () => undefined)).toBe("withdrawn");
    expect(withdrawn.withdraw).toHaveBeenCalledWith("10", scope, expect.any(Function));
  });

  it("resumes a bounded page set on the next sync without changing the selected package", async () => {
    const pages = Array.from({ length: 5 }, (_, index) => {
      const [row] = changes(normalizeContext({ operationId: id(40 + index), branchId: scope.branchId, terminalId: id(4), kind: "stock", clockState: "verified" }, movementAt),
        [product], [{ ...product, stock_by_store: { owned: "9007199254740994" } }]);
      return [[String(index + 8), at, row.payload_hash, row.payload_json]];
    });
    const f = fixture({ rows: [[opening], ...pages], headCursor: "12" });
    expect(await f.run(scope, () => undefined)).toBeNull();
    expect(f.install).not.toHaveBeenCalled();
    expect(await f.run(scope, () => undefined)).toBe("installed");
    expect(f.request.mock.calls.map(([request]) => request.action === "page" ? request.index : request.action))
      .toEqual(["manifest", 0, 1, 2, 3, "manifest", 4, 5, "manifest"]);
    expect(f.install).toHaveBeenCalledTimes(1);
  });

  it("keeps optional network paging outside the coordinator trading lease", async () => {
    let finishNetwork!: () => void, finishInstall!: () => void;
    const network = new Promise<void>(resolve => { finishNetwork = resolve; });
    const installed = new Promise<void>(resolve => { finishInstall = resolve; });
    const reader = { connectionManager: { pool: {} }, pendingSummary: vi.fn(async () => ({ pending: 0, failed: 0 })) };
    const download = vi.fn(async ({ runInstall }: { runInstall: (work: (ownsLease: () => boolean) => void) => Promise<void> }) => {
      try {
        expect(coordinator.ownsExclusive()).toBe(false);
        await network;
        await runInstall(ownsLease => { expect(ownsLease()).toBe(true); });
      } finally { finishInstall(); }
    });
    const coordinator = new SyncCoordinator({ pushWorker: { reader, run: vi.fn(async () => ({ pushed: 1 })) },
      pullWorker: { run: vi.fn(async () => ({ merged: 1 })) }, downloadStockHistory: download });
    expect(await coordinator.runNow({ branchId: scope.branchId })).toMatchObject({ ok: true, pushed: 1, merged: 1 });
    expect(download).toHaveBeenCalledTimes(1);
    expect(await coordinator.withExclusive(() => "checkout")).toBe("checkout");
    finishNetwork();
    await installed;
    await expect(download.mock.results[0]?.value).resolves.toBeUndefined();
    expect(await coordinator.runFinal({ branchId: scope.branchId })).toMatchObject({ ok: true });
    expect(download).toHaveBeenCalledTimes(1);
  });
});
