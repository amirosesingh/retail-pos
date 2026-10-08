import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { beginDataTask, dataProgress, withDataTask } from "../data-progress";
import { readAllPages } from "../paged-read";
const require = createRequire(import.meta.url);
const { SyncCoordinator } = require("../../../electron/sync/coordinator.cjs");
const { PushWorker } = require("../../../electron/sync/push-worker.cjs");
const { readPage } = require("../../../electron/sync/page-policy.cjs");
const { aggregatePolicy } = require("../../../electron/db/write-policy.cjs");

describe("shared database reliability", () => {
  it("serializes lifecycle uploads and automatic synchronization", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    const push = vi
      .fn()
      .mockImplementationOnce(async () => {
        order.push("repair");
        await gate;
        return {};
      })
      .mockImplementationOnce(async () => {
        order.push("automatic");
        return {};
      });
    const pull = vi.fn(async () => {
      order.push("pull");
      return {};
    });
    const coordinator = new SyncCoordinator({
      pushWorker: { run: push },
      pullWorker: { run: pull },
    });
    const repair = coordinator.runPush({ branchId: "B1" });
    await Promise.resolve();
    await Promise.resolve();
    const automatic = coordinator.runNow({ branchId: "B1" });
    expect(order).toEqual(["repair"]);
    release();
    await Promise.all([repair, automatic]);
    expect(order).toEqual(["repair", "automatic", "pull"]);
  });
  it("still downloads when an upload record is rejected", async () => {
    const pull = vi.fn().mockResolvedValue({ merged: 2 });
    const coordinator = new SyncCoordinator({
      pushWorker: {
        run: vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error("Invalid row"), { code: "P0001", table: "purchase_orders" }),
          ),
      },
      pullWorker: { run: pull },
    });
    expect(await coordinator.runNow({ branchId: "B1" })).toMatchObject({
      ok: false,
      table: "purchase_orders",
    });
    expect(pull).toHaveBeenCalledOnce();
  });
  it("does not retry permanent permission failures", async () => {
    const worker = new PushWorker({
      reader: {},
      cloud: {},
      checkpoints: {},
      registry: { tables: [] },
    });
    const work = vi.fn().mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    await expect(worker.retry(work)).rejects.toThrow("Forbidden");
    expect(work).toHaveBeenCalledOnce();
  });
  it("shrinks an oversized download and grows small subsequent pages", async () => {
    const fetch = vi.fn(async (limit: number) => {
      if (limit > 50) throw Object.assign(new Error("Too large"), { status: 413 });
      return { rows: [{ id: "one" }] };
    });
    expect(await readPage(fetch, 100)).toMatchObject({ limit: 50, nextLimit: 100 });
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([100, 50]);
  });
  it("does not let a sale label bypass member administration permissions", () => {
    expect(() =>
      aggregatePolicy(
        "sale",
        [{ table: "members", kind: "upsert", rows: [{ id: "M1", loyalty_points: 999 }] }],
        { source: "pos", permissions: { can_process_sale: true } },
      ),
    ).toThrow("Member management permission");
    expect(() =>
      aggregatePolicy("sale", [{ table: "purchase_orders", kind: "upsert", rows: [] }], {
        source: "pos",
        permissions: { can_process_sale: true, can_receive_purchase_order: true },
      }),
    ).toThrow("unrelated tables");
  });
  it("requires sale permission even when the renderer chooses a general label", () => {
    expect(() =>
      aggregatePolicy("general", [{ table: "sales", kind: "upsert", rows: [{ id: "S1" }] }], {
        source: "pos",
        permissions: {},
      }),
    ).toThrow("Sale permission");
    expect(() =>
      aggregatePolicy("general", [{ table: "products", kind: "upsert", rows: [] }], null),
    ).toThrow("Sign in");
  });
  it("allows legitimate sale accrual only for its actual member", () => {
    const scope = aggregatePolicy(
      "sale",
      [
        {
          table: "sales",
          kind: "upsert",
          rows: [{ id: "S1", member_id: "M1", total_amount: 20, points_earned: 2 }],
        },
        { table: "members", kind: "upsert", rows: [{ id: "M1" }] },
      ],
      { source: "pos", permissions: { can_process_sale: true } },
    );
    expect(scope.enforcePermissions).toBe(true);
    expect(scope.memberAccrual.get("m1")).toEqual({ points: 2, spent: 20 });
  });
  it("marks retention as local cleanup instead of an outbound business deletion", () => {
    const sql = readFileSync("electron/jobs/retention.cjs", "utf8");
    expect(sql).toContain("WITH CHANGE_TRACKING_CONTEXT (0x4C4F43414C) DELETE");
  });
  it("keeps concurrent work separate and clears failed progress", async () => {
    const one = beginDataTask("One");
    const two = beginDataTask("Two");
    one.report(25, 100);
    two.report(7);
    expect(dataProgress().map((task) => [task.completed, task.total])).toEqual([
      [25, 100],
      [7, null],
    ]);
    one.finish();
    two.finish();
    await expect(
      withDataTask("Failure", async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    expect(dataProgress()).toEqual([]);
  });
  it("loads 100,000 cloud rows with bounded concurrency and actual progress", async () => {
    let active = 0;
    let peak = 0;
    let received = 0;
    const result = await readAllPages(async (from, to) => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      const rows = Array.from({ length: Math.min(to + 1, 100000) - from }, (_, index) => ({
        id: from + index,
      }));
      received += rows.length;
      active--;
      return { data: rows, error: null, count: 100000 };
    });
    expect(result.data).toHaveLength(100000);
    expect(received).toBe(100000);
    expect(peak).toBeLessThanOrEqual(3);
    expect(dataProgress()).toEqual([]);
  });
  it("preserves unuploaded local rows during a bootstrap refresh", async () => {
    const { refreshTable } = require("../../../electron/jobs/bootstrap.cjs");
    class Transaction {
      begin = vi.fn();
      commit = vi.fn();
      rollback = vi.fn();
    }
    const table = {
      cloudTable: "products",
      sqlServerTable: "products",
      columns: [{ cloudColumn: "id", primaryKey: true }],
    };
    const reader = { unacknowledged: vi.fn().mockResolvedValue(new Set(['{"id":"local"}'])) };
    const cloud = {
      bootstrapPage: vi
        .fn()
        .mockResolvedValue({ rows: [{ id: "local" }, { id: "remote" }], cursor: null }),
      applyLocalBatch: vi.fn(),
    };
    await refreshTable({
      registry: { tables: [table] },
      cloud,
      reader,
      branchId: "B1",
      tableName: "products",
      connectionManager: { sql: () => ({ Transaction }), pool: {} },
    });
    expect(reader.unacknowledged).toHaveBeenCalledWith(
      table,
      ['{"id":"local"}', '{"id":"remote"}'],
      expect.any(Transaction),
    );
    expect(cloud.applyLocalBatch).toHaveBeenCalledWith(expect.any(Transaction), table, {
      rows: [{ entity_id: '{"id":"remote"}', row_data: { id: "remote" }, tombstone: false }],
      tombstones: [],
    });
  });
  it("binds local analytics to its paired branch and rejects unbounded reports", async () => {
    const { readAnalytics } = require("../../../electron/db/repositories/analytics.cjs");
    const request = {
      input: vi.fn().mockReturnThis(),
      query: vi.fn().mockResolvedValue({ recordsets: [[{ bills: 2 }], [], [], [{ id: "B1" }]] }),
    };
    const manager = { pool: { request: () => request } };
    expect(await readAnalytics(manager, "B1", "2026-10-01", "2026-10-08")).toMatchObject({
      ok: true,
      directory: [{ id: "B1" }],
    });
    expect(request.input).toHaveBeenCalledWith("branch", "B1");
    expect(request.query.mock.calls[0][0]).toContain("WHERE s.store_id=@branch");
    await expect(readAnalytics(manager, "B1", "invalid", "2026-10-08")).rejects.toThrow(
      "valid report",
    );
    request.query.mockResolvedValue({ recordsets: [[], Array(500001), [], []] });
    await expect(readAnalytics(manager, "B1", "2026-10-01", "2026-10-08")).rejects.toMatchObject({
      code: "EREPORT_LIMIT",
    });
  });
  it("matches pending UUID keys independently of casing while preserving ordinary text keys", () => {
    const { canonicalEntityKey } = require("../../../electron/sync/entity-key.cjs");
    const lower = '{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}';
    expect(canonicalEntityKey(lower.toUpperCase().replace('"ID"', '"id"'))).toBe(lower);
    expect(canonicalEntityKey('{"id":"CaseSensitiveReference"}')).toBe(
      '{"id":"CaseSensitiveReference"}',
    );
  });
});
