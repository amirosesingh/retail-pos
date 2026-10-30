import { describe, expect, it, vi } from "vitest";
import acknowledgementModule from "../../../electron/sync/shift-closure-ack.cjs";
import workerModule from "../../../electron/sync/push-worker.cjs";

const { assertShiftClosureAcknowledgement } = acknowledgementModule;
const { PushWorker } = workerModule;

const branch = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherBranch = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const row = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", store_id: branch,
  status: "CLOSED", state: "CLOSED", closed_at: "2026-10-30T12:00:00Z", row_version: 2 };
const table = { cloudTable: "shifts", sqlServerTable: "shifts", dependencyOrder: 1,
  scope: "branch", columns: [{ cloudColumn: "id", primaryKey: true }, { cloudColumn: "store_id" }] };
const operation = { table: "shifts", rows: [row] };
const proof = (revision: number | string = 2) => ({ ok: true, applied_count: 0,
  shift_closure_ack_version: 1,
  shift_closures: [{ id: row.id, store_id: branch, row_version: revision }] });

function fixture(result: unknown = { ok: true }) {
  let pending = true;
  const change = { entity_type: "shifts", entity_id: JSON.stringify({ id: row.id }),
    key: { id: row.id }, operation: "update" };
  const reader = {
    pendingAggregates: vi.fn(async (_branch: string, _limit: number, excluded: string[]) =>
      pending && !excluded.includes("closure") ? [{ aggregateId: "closure", changes: [change] }] : []),
    rows: vi.fn(async () => [row]),
    acknowledgeAggregate: vi.fn(async () => { pending = false; }),
    failAggregate: vi.fn(),
  };
  const cloud = { pushAggregate: vi.fn().mockResolvedValue(result) };
  return { reader, cloud, pending: () => pending,
    worker: new PushWorker({ reader, cloud, registry: { tables: [table] } }) };
}

describe("authoritative shift closure acknowledgements", () => {
  it.each([{ ok: true, applied_count: 0 }, { ok: true, applied_count: 8 },
    { ...proof(), shift_closure_ack_version: 0 }, { ...proof(), shift_closures: [] }])(
    "does not equate an old receipt or aggregate row count with closure confirmation: %j", async result => {
      const f = fixture(result), progress = vi.fn();
      expect(await f.worker.pushAggregates(branch, 100, true, progress)).toBe(0);
      expect(f.pending()).toBe(true);
      expect(f.reader.acknowledgeAggregate).not.toHaveBeenCalled();
      expect(f.reader.failAggregate).toHaveBeenCalledWith("closure",
        expect.objectContaining({ code: "ESHIFT_CLOSURE_UNCONFIRMED", table: "shifts" }));
      expect(progress).not.toHaveBeenCalled();
    },
  );

  it.each([2, "2", 3])("accepts a confirmed equivalent replay at revision %s", async version => {
    const f = fixture(proof(version));
    expect(await f.worker.pushAggregates(branch, 100, true)).toBe(1);
    expect(f.pending()).toBe(false);
    expect(f.reader.acknowledgeAggregate).toHaveBeenCalledOnce();
  });

  it("keeps an ambiguous timeout pending and uses the same receipt on reconnect", async () => {
    const f = fixture();
    f.cloud.pushAggregate.mockRejectedValueOnce(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }))
      .mockResolvedValueOnce(proof());
    expect(await f.worker.pushAggregates(branch, 100, true)).toBe(0);
    expect(f.pending()).toBe(true);
    expect(await f.worker.pushAggregates(branch, 100, true)).toBe(1);
    expect(f.cloud.pushAggregate.mock.calls[0][0].batchId).toBe(f.cloud.pushAggregate.mock.calls[1][0].batchId);
    expect(f.reader.acknowledgeAggregate).toHaveBeenCalledOnce();
  });

  it("retains a semantic closing conflict without repeated gateway requests", async () => {
    const f = fixture();
    f.cloud.pushAggregate.mockRejectedValue(Object.assign(new Error("SYNC_SHIFT_CLOSURE_CONFLICT"),
      { code: "P0001", status: 500 }));
    expect(await f.worker.pushAggregates(branch, 100, true)).toBe(0);
    expect(f.pending()).toBe(true);
    expect(f.cloud.pushAggregate).toHaveBeenCalledOnce();
    expect(f.reader.acknowledgeAggregate).not.toHaveBeenCalled();
  });

  it.each([
    [{ id: row.id, store_id: otherBranch, row_version: 2 }],
    [{ id: "different", store_id: branch, row_version: 2 }],
    [{ id: row.id, store_id: branch, row_version: 1 }],
    [{ id: row.id, store_id: branch, row_version: 0 }],
    [{ id: row.id, store_id: branch, row_version: null }],
    [{ id: row.id, store_id: branch, row_version: 2.1 }],
    [{ id: row.id, store_id: branch, row_version: "9007199254740993" }],
    [proof().shift_closures[0], proof().shift_closures[0]],
    [null],
  ])("rejects missing, foreign, stale or malformed per-shift proof: %j", (...entries) => {
    expect(() => assertShiftClosureAcknowledgement({ ...proof(), shift_closures: entries }, [operation], branch))
      .toThrow(/not confirmed/);
  });

  it("normalizes UUID case without accepting another branch's incoming closure", () => {
    expect(() => assertShiftClosureAcknowledgement(proof(), [{ ...operation,
      rows: [{ ...row, id: row.id.toUpperCase(), store_id: branch.toUpperCase() }] }], branch)).not.toThrow();
    expect(() => assertShiftClosureAcknowledgement(proof(), [{ ...operation,
      rows: [{ ...row, store_id: otherBranch }] }], branch)).toThrow(/not confirmed/);
  });

  it("requires proof for partial closure flags too, and leaves ordinary uploads unchanged", () => {
    for (const patch of [{ status: "OPEN", state: "CLOSED", closed_at: null },
      { status: "OPEN", state: "ACTIVE", closed_at: row.closed_at }]) {
      expect(() => assertShiftClosureAcknowledgement({ ok: true }, [{ ...operation,
        rows: [{ ...row, ...patch }] }], branch)).toThrow(/not confirmed/);
    }
    expect(() => assertShiftClosureAcknowledgement({ ok: true }, [{ ...operation,
      rows: [{ ...row, status: "OPEN", state: "ACTIVE", closed_at: null }] }], branch)).not.toThrow();
    expect(() => assertShiftClosureAcknowledgement({ ok: true }, [{ table: "sales", rows: [row] }], branch)).not.toThrow();
  });

  it("does not advance change-tracking recovery until closure proof is present", async () => {
    let checkpoint = 0;
    const checkpoints = { list: vi.fn(async () => [{ entity_type: "shifts", change_tracking_version: checkpoint }]),
      save: vi.fn(async (_b: string, _t: string, _d: string, value: { change_tracking_version: number }) => {
        checkpoint = value.change_tracking_version;
      }) };
    const cloud = { pushBatch: vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValue(proof()) };
    const reader = { pendingAggregates: vi.fn(async () => []),
      changedIds: vi.fn(async (_t: unknown, version: number) => version ? []
        : [{ operation: "U", version: 17, key: { id: row.id } }]),
      rows: vi.fn(async () => [row]) };
    const worker = new PushWorker({ reader, cloud, checkpoints, registry: { tables: [table] } });
    await expect(worker.run({ branchId: branch })).rejects.toMatchObject({ code: "ESHIFT_CLOSURE_UNCONFIRMED" });
    expect(checkpoint).toBe(0);
    expect(checkpoints.save).not.toHaveBeenCalled();
    await expect(worker.run({ branchId: branch })).resolves.toMatchObject({ pushed: 1 });
    expect(checkpoint).toBe(17);
  });

  it("does not upload an old queued local event as central confirmation", async () => {
    const event = { id: "activity", store_id: branch, event_type: "shift_close", title: "Shift closed",
      message: "Local count saved", meta: JSON.stringify({ shift_closure_status: "confirmed", shift_id: row.id }) };
    const activityTable = { ...table, cloudTable: "activity_events", sqlServerTable: "activity_events" };
    const cloud = { pushAggregate: vi.fn().mockResolvedValue({ ok: true }) };
    const reader = { pendingAggregates: vi.fn().mockResolvedValueOnce([{ aggregateId: "old-event", changes: [{
      entity_type: "activity_events", entity_id: '{"id":"activity"}', key: { id: "activity" }, operation: "insert",
    }] }]).mockResolvedValue([]), rows: vi.fn(async () => [event]), acknowledgeAggregate: vi.fn(), failAggregate: vi.fn() };
    await new PushWorker({ reader, cloud, registry: { tables: [activityTable] } }).pushAggregates(branch, 100, true);
    expect(cloud.pushAggregate.mock.calls[0][0].operations[0].rows[0]).toMatchObject({
      title: "Shift closure reported", message: expect.stringContaining("has not been confirmed"),
      meta: { shift_id: row.id, shift_closure_status: "unconfirmed" },
    });
    expect(event.title).toBe("Shift closed");
    expect(reader.acknowledgeAggregate).toHaveBeenCalledWith("old-event");
  });

  it("also normalizes legacy activity during change-tracking recovery", async () => {
    let savedVersion = 0;
    const activityTable = { ...table, cloudTable: "activity_events", sqlServerTable: "activity_events" };
    const event = { id: "activity", store_id: branch, event_type: "shift_close", title: "Shift closed",
      message: "Offline report", meta: { shift_closure_status: "central_confirmed" } };
    const cloud = { pushBatch: vi.fn().mockResolvedValue({ ok: true }) };
    const reader = { pendingAggregates: vi.fn(async () => []), rows: vi.fn(async () => [event]),
      changedIds: vi.fn(async (_t: unknown, version: number) => version ? []
        : [{ operation: "U", version: 8, key: { id: event.id } }]) };
    const checkpoints = { list: vi.fn(async () => []),
      save: vi.fn(async (_b: string, _t: string, _d: string, value: { change_tracking_version: number }) => { savedVersion = value.change_tracking_version; }) };
    await new PushWorker({ reader, cloud, checkpoints, registry: { tables: [activityTable] } }).run({ branchId: branch });
    expect(cloud.pushBatch.mock.calls[0][0].rows[0]).toMatchObject({ title: "Shift closure reported",
      meta: { shift_closure_status: "unconfirmed" } });
    expect(event.title).toBe("Shift closed");
    expect(savedVersion).toBe(8);
  });
});
