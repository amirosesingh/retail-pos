import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const {
  normalizeResponse,
  projectIdentity,
  adoptionReceipt,
} = require("../../../electron/sync/held-status-recovery.cjs");
const {
  parseExactJson,
  stringifyExactJson,
} = require("../../../electron/sync/shift-recovery-exact.cjs");
const { SyncCoordinator } = require("../../../electron/sync/coordinator.cjs");
const branch = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const terminal = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
const parent = "aaaaaaaa-aaaa-4aaa-8aaa-000000000003";
const guid = "aaaaaaaa-aaaa-4aaa-8aaa-000000000004";
const ticket = { id: "held-one", billNo: "STR1-PC-0001", shiftId: null };
const identity = () =>
  parseExactJson(
    JSON.stringify({
      id: ticket.id,
      store_id: branch,
      bill_no: ticket.billNo,
      shift_id: null,
      total: 12.35,
      cart_discount: 0,
      cart_discount_type: "amount",
      exchange_ref: null,
      member_id: null,
      lines: [{ productId: parent, qty: 1, price: 12.35 }],
      coupon: null,
      pending_request_id: null,
      approval_snapshot_hash: null,
    }),
  );
const response = () => ({
  ok: true,
  heldStatusVersion: 1,
  organizationId: "default",
  branchId: branch,
  terminalId: terminal,
  records: [
    {
      id: ticket.id,
      status: "cancelled",
      proofFrom: "held",
      rowVersion: "12",
      updatedAt: "2026-11-07T01:02:03.123456Z",
      identityJson: stringifyExactJson(identity()),
      parent: null,
    },
  ],
});
const decode = (value: unknown) =>
  normalizeResponse(value, { branchId: branch, terminalId: terminal, tickets: [ticket] });

describe("held-state proof protocol", () => {
  it("keeps exact decimal tokens while comparing only projected business identity", () => {
    const local = {
      ...JSON.parse(
        JSON.stringify({
          ...identity(),
          total: "12.350000000000",
          cart_discount: "0.000000000000",
        }),
      ),
      lines:
        '[{"productId":"' +
        parent +
        '","qty":1,"price":12.35,"cost":99,"name":"private name","job":{"private":"hidden"}}]',
      coupon: '{"code":"A","discount":0.1234567890123456789,"name":"private name","cost":9}',
    };
    const projected = projectIdentity(local, { local: true });
    expect(projected.lines).not.toMatch(/cost|private|name|job/);
    expect(projected.coupon).toContain("0.1234567890123456789");
    expect(projected.coupon).not.toMatch(/private|cost|name/);
    expect(decode(response())).toHaveLength(1);
  });
  it.each([
    [
      "foreign branch",
      (r: ReturnType<typeof response>) => {
        r.branchId = parent;
      },
    ],
    [
      "foreign terminal",
      (r: ReturnType<typeof response>) => {
        r.terminalId = parent;
      },
    ],
    [
      "duplicate id",
      (r: ReturnType<typeof response>) => {
        r.records.push(r.records[0]);
      },
    ],
    [
      "unexpected id",
      (r: ReturnType<typeof response>) => {
        r.records[0].id = "other";
      },
    ],
    [
      "missing proof kind",
      (r: ReturnType<typeof response>) => {
        r.records[0].proofFrom = "";
      },
    ],
    [
      "cancelled parent",
      (r: ReturnType<typeof response>) => {
        Object.assign(r.records[0], {
          parent: {
            kind: "sale",
            id: parent,
            storeId: branch,
            billNo: ticket.billNo,
            shiftId: null,
          },
        });
      },
    ],
    [
      "unsafe revision",
      (r: ReturnType<typeof response>) => {
        r.records[0].rowVersion = "2147483648";
      },
    ],
    [
      "rounded timestamp",
      (r: ReturnType<typeof response>) => {
        r.records[0].updatedAt = "not-a-date";
      },
    ],
    [
      "private line field",
      (r: ReturnType<typeof response>) => {
        const exact = identity();
        exact.lines[0].cost = parseExactJson("99");
        r.records[0].identityJson = stringifyExactJson(exact);
      },
    ],
    [
      "nested private id",
      (r: ReturnType<typeof response>) => {
        const exact = identity();
        exact.lines[0].productId = { cost: parseExactJson("99") };
        r.records[0].identityJson = stringifyExactJson(exact);
      },
    ],
    [
      "nested private top-level value",
      (r: ReturnType<typeof response>) => {
        const exact = identity();
        exact.member_id = { cost: parseExactJson("99") };
        r.records[0].identityJson = stringifyExactJson(exact);
      },
    ],
    [
      "untrusted extra field",
      (r: ReturnType<typeof response>) => {
        Object.assign(r.records[0], { rawCost: "99" });
      },
    ],
  ])("refuses %s before it can authorize an adoption", (_name, mutate) => {
    const value = response();
    mutate(value);
    expect(() => decode(value)).toThrow();
  });
  it("does not turn missing-held parent evidence into a fake held revision or cart proof", () => {
    const value = response();
    Object.assign(value.records[0], {
      status: "completed",
      proofFrom: "accepted_parent",
      rowVersion: null,
      updatedAt: null,
      identityJson: null,
      parent: { kind: "sale", id: parent, storeId: branch, billNo: ticket.billNo, shiftId: null },
    });
    expect(decode(value)[0].proofFrom).toBe("accepted_parent");
    value.records[0].rowVersion = "1";
    expect(() => decode(value)).toThrow();
  });
  it("preserves cross-shift held completion but does not widen the missing-held fallback", () => {
    const shift = "aaaaaaaa-aaaa-4aaa-8aaa-000000000005",
      value = response();
    Object.assign(value.records[0], {
      status: "completed",
      parent: { kind: "sale", id: parent, storeId: branch, billNo: ticket.billNo, shiftId: shift },
    });
    expect(decode(value)[0].parent.shiftId).toBe(shift);
    Object.assign(value.records[0], {
      proofFrom: "accepted_parent",
      identityJson: null,
      rowVersion: null,
      updatedAt: null,
    });
    expect(() =>
      normalizeResponse(value, {
        branchId: branch,
        terminalId: terminal,
        tickets: [{ ...ticket, shiftId: parent }],
      }),
    ).toThrow();
  });
  it("keeps receipt identity stable, source-bound and bounded instead of truncating evidence", () => {
    const args = {
      databaseGuid: guid,
      branchId: branch,
      terminalId: terminal,
      record: response().records[0],
      beforeJson: '{"status":"held"}',
      oldStatus: "held",
      sourceKey: "owned-source",
    };
    const receipt = adoptionReceipt(args);
    expect(adoptionReceipt(args)).toEqual(receipt);
    expect(adoptionReceipt({ ...args, sourceKey: "other-source" }).id).not.toBe(receipt.id);
    expect(receipt.type).toBe("held_status_cloud_adoption_v1");
    expect(receipt.note.length).toBeLessThanOrEqual(400);
    expect(JSON.parse(receipt.note)).toMatchObject({ s: "held", to: "cancelled" });
    expect(() => adoptionReceipt({ ...args, oldStatus: "x".repeat(500) })).toThrow();
  });
});

function mainFixture() {
  const source = readFileSync("electron/main.cjs", "utf8"),
    start = source.indexOf("async function recoverLocalHeldStatuses("),
    end = source.indexOf("\nasync function prepareShiftRecoveryMetadata(", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const state = { enabled: true, configured: true, connected: true, tradingReady: true };
  const registration = {
    tokenId: terminal,
    deviceType: "pc",
    deviceUse: "operations",
    locationId: branch,
    deviceBindingProof: "a".repeat(64),
  };
  const pool = {},
    profile = { database: "OwnedFixture", host: "fixture" },
    sourceContext = { pool, fingerprint: "fixture-fingerprint" };
  const details = {
    database_guid: guid,
    database_name: "OwnedFixture",
    configured_id: 5,
    actual_id: 5,
    has_tickets: 1,
  };
  const query = vi.fn(async () => ({ recordset: [details] }));
  class Request {
    input() {
      return this;
    }
    query() {
      return query();
    }
  }
  const instance = { hasSingleInstanceLock: () => true },
    coordinator = new SyncCoordinator({ pushWorker: {}, pullWorker: {} });
  const recovered = vi.fn(async (scope: { assertCurrent(): void }) => {
    scope.assertCurrent();
    return { updated: 1, reviewRequired: 0, deferred: false, code: null };
  });
  const log = vi.fn();
  const context = {
    require: createRequire(new URL("../../../electron/main.cjs", import.meta.url)),
    process: { platform: "win32" },
    app: instance,
    syncCoordinator: coordinator,
    safeMode: false,
    quitting: false,
    closeWriteBarrier: { sealed: false },
    terminalStore: { read: () => registration },
    databaseService: { snapshot: () => state },
    databaseManager: { pool, profile, sql: () => ({ Request, NVarChar: () => ({}) }) },
    databaseConfig: { profile: () => profile },
    syncCloud: { requestContext: () => sourceContext },
    authorizationServerUrl: () => "https://fixture.invalid",
    cloudCredentials: { read: () => ({ url: "https://tenant.fixture.invalid" }) },
    isManagementDevice: () => registration.deviceUse === "management",
    localBranchId: () => registration.locationId,
    recordId: require("../../../electron/sync/uuid-fields.cjs").recordId,
    createHash,
    heldStatusRecovery: { reconcile: recovered },
    diagnostics: { logConnection: log },
  };
  runInNewContext(source.slice(start, end) + "\nthis.recover=recoverLocalHeldStatuses;", context);
  const recover = (context as typeof context & { recover(options: unknown): Promise<unknown> })
    .recover;
  return {
    state,
    registration,
    pool,
    profile,
    sourceContext,
    details,
    query,
    instance,
    coordinator,
    recovered,
    context,
    log,
    run: () => coordinator.withExclusive(() => recover({ branchId: branch })),
    recover,
  };
}
describe("actual Main held recovery callback admission", () => {
  it("uses the existing exclusive lease and primary database identity", async () => {
    const f = mainFixture();
    expect(await f.run()).toMatchObject({ updated: 1 });
    expect(f.recovered).toHaveBeenCalledOnce();
    expect(f.recovered.mock.calls[0][0]).toMatchObject({
      branchId: branch,
      terminalId: terminal,
      expectedDatabaseGuid: guid,
      expectedDatabaseName: "OwnedFixture",
    });
  });
  it.each([
    "management",
    "mobile",
    "paused",
    "no lock",
    "shutdown",
    "safe mode",
    "not ready",
    "bad proof",
    "wrong branch",
  ])("denies %s without SQL or recovery writes", async (mode) => {
    const f = mainFixture();
    if (mode === "management") {
      f.registration.deviceUse = "management";
      f.registration.locationId = "";
    }
    if (mode === "mobile") f.registration.deviceType = "mobile";
    if (mode === "paused") f.coordinator.paused = true;
    if (mode === "no lock") f.instance.hasSingleInstanceLock = () => false;
    if (mode === "shutdown") f.context.quitting = true;
    if (mode === "safe mode") f.context.safeMode = true;
    if (mode === "not ready") f.state.tradingReady = false;
    if (mode === "bad proof") f.registration.deviceBindingProof = "bad";
    if (mode === "wrong branch") f.registration.locationId = parent;
    expect(await f.run()).toMatchObject({ updated: 0, deferred: true });
    expect(f.query).not.toHaveBeenCalled();
    expect(f.recovered).not.toHaveBeenCalled();
  });
  it("denies a call outside the coordinator lease", async () => {
    const f = mainFixture();
    expect(await f.recover({ branchId: branch })).toMatchObject({ deferred: true });
    expect(f.query).not.toHaveBeenCalled();
  });
  it("skips package probing and network work when no active held ticket exists", async () => {
    const f = mainFixture();
    f.details.has_tickets = 0;
    expect(await f.run()).toMatchObject({ updated: 0, deferred: false });
    expect(f.recovered).not.toHaveBeenCalled();
  });
  it("does not adopt when the source changes during its primary identity read", async () => {
    const f = mainFixture();
    f.query.mockImplementation(async () => {
      f.sourceContext.fingerprint = "changed";
      return { recordset: [f.details] };
    });
    expect(await f.run()).toMatchObject({ updated: 0, deferred: true });
    expect(f.recovered).not.toHaveBeenCalled();
  });
  it("keeps private failure content out of diagnostics", async () => {
    const f = mainFixture();
    f.recovered.mockRejectedValue(
      Object.assign(Error("private fixture payload"), { code: "EHELD_STATUS_CT_REVIEW" }),
    );
    expect(await f.run()).toMatchObject({ code: "EHELD_STATUS_CT_REVIEW", deferred: true });
    expect(JSON.stringify(f.log.mock.calls)).not.toContain("private fixture payload");
  });
});

describe("coordinator retains the protected shift failure", () => {
  it("can update independent held status while keeping the shift error and feed blocked", async () => {
    const gap = Object.assign(Error("shift recovery still required"), {
        code: "ECHANGEGAP",
        table: "shifts",
      }),
      pull = vi.fn(),
      recover = vi.fn(async () => {
        expect(coordinator.ownsExclusive()).toBe(true);
        return { updated: 2, deferred: false };
      });
    const coordinator = new SyncCoordinator({
      pushWorker: {
        run: async () => {
          throw gap;
        },
      },
      pullWorker: { run: pull },
      recoverHeldStatuses: recover,
    });
    const result = await coordinator.runNow({ branchId: branch });
    expect(result).toMatchObject({
      ok: false,
      code: "ECHANGEGAP",
      heldStatusRecovery: { updated: 2 },
    });
    expect(result.lastError).toContain("shift recovery still required");
    expect(pull).not.toHaveBeenCalled();
    expect(recover).toHaveBeenCalledOnce();
  });
  it("an auxiliary failure cannot replace the shift error or certify final upload", async () => {
    const coordinator = new SyncCoordinator({
      pushWorker: {
        run: async () => {
          throw Object.assign(Error("original"), { code: "ECHANGEGAP", table: "shifts" });
        },
      },
      pullWorker: {},
      recoverHeldStatuses: async () => {
        throw Error("auxiliary");
      },
    });
    expect(await coordinator.runFinal({ branchId: branch })).toMatchObject({
      ok: false,
      code: "ECHANGEGAP",
      heldStatusRecovery: { deferred: true, code: "EHELD_STATUS_RETRY" },
    });
  });
});
