import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  staff: vi.fn(),
  relayAllowed: vi.fn(),
  relay: vi.fn(),
  local: vi.fn(),
  from: vi.fn(),
  upsert: vi.fn(),
  range: vi.fn(),
  checkpoint: vi.fn(),
  getUser: vi.fn(),
  getSession: vi.fn(),
  expired: vi.fn(),
}));
vi.mock("@/integrations/supabase/external-client", () => ({
  supabaseExternal: { from: mocks.from, auth: { getUser: mocks.getUser, getSession: mocks.getSession } },
  externalClientSnapshot: () => ({
    from: mocks.from,
    auth: { getUser: mocks.getUser, getSession: mocks.getSession },
  }),
}));
vi.mock("@/core/api/sync-relay", () => ({
  hasStaffSession: mocks.staff,
  canRelay: mocks.relayAllowed,
  relayOp: mocks.relay,
}));
vi.mock("@/core/local-db/local-db", () => ({ localDb: mocks.local }));
vi.mock("../sync-outbox", () => ({ isOnline: () => true, isOnlineSyncEnabled: () => true }));
vi.mock("../sync-status", () => ({
  syncState: () => ({}),
  setSyncState: vi.fn(),
  lastSuccessfulPull: () => null,
  lastTablePull: () => null,
  setLastTablePull: mocks.checkpoint,
  setLastSuccessfulPull: mocks.checkpoint,
}));
vi.mock("../sync-policy", () => ({ tableSyncAllowed: (table: string) => table === "products" }));
vi.mock("../sync-progress", () => ({
  beginSyncRun: vi.fn(),
  endSyncRun: vi.fn(),
  markTableSync: vi.fn(),
}));
vi.mock("../sync-log", () => ({ logSync: vi.fn() }));
vi.mock("../sync-audit", () => ({ recordSync: vi.fn() }));
vi.mock("../session-expiry", async (loadOriginal) => ({
  ...(await loadOriginal<typeof import("../session-expiry")>()),
  notifySessionExpired: mocks.expired,
}));

import { pullDelta } from "../sync-engine";
import { db } from "@/core/api/pos-db";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.staff.mockReturnValue(false);
  mocks.local.mockReturnValue(null);
  mocks.relayAllowed.mockReturnValue(true);
  mocks.relay.mockResolvedValue({ ok: true });
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "staff-1" } }, error: null });
  mocks.getSession.mockResolvedValue({
    data: { session: { access_token: "staff-jwt" } },
    error: null,
  });
  const query = {
    select: vi.fn(),
    gt: vi.fn(),
    lte: vi.fn(),
    order: vi.fn(),
    range: mocks.range,
    upsert: mocks.upsert,
  };
  for (const method of [query.select, query.gt, query.lte, query.order])
    method.mockReturnValue(query);
  mocks.from.mockReturnValue(query);
});

describe("protected background table access", () => {
  it("does not send anonymous delta reads or advance their checkpoints", async () => {
    await expect(pullDelta()).resolves.toEqual({ merged: 0 });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.checkpoint).not.toHaveBeenCalled();
  });

  it("leaves Electron pulls to its worker even with a staff session", async () => {
    mocks.staff.mockReturnValue(true);
    mocks.local.mockReturnValue({});
    await pullDelta();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("does not retry a permission denial against another timestamp column", async () => {
    mocks.staff.mockReturnValue(true);
    mocks.range.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "permission denied for table products" },
    });
    await pullDelta();
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("does not probe business tables after Supabase rejects a stale staff session", async () => {
    mocks.staff.mockReturnValue(true);
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { status: 403, message: "invalid token" },
    });
    await expect(pullDelta()).resolves.toEqual({ merged: 0 });
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.expired).toHaveBeenCalledTimes(1);
  });

  it("does not sign staff out for a temporary auth network failure", async () => {
    mocks.staff.mockReturnValue(true);
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { status: 0, message: "Failed to fetch" },
    });
    await expect(pullDelta()).resolves.toEqual({ merged: 0 });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.expired).not.toHaveBeenCalled();
  });

  it("does not sign staff out when the auth request rejects", async () => {
    mocks.staff.mockReturnValue(true);
    mocks.getUser.mockRejectedValue(new TypeError("network unavailable"));
    await expect(pullDelta()).resolves.toEqual({ merged: 0 });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.expired).not.toHaveBeenCalled();
  });

  it("still falls back for a genuinely missing timestamp column", async () => {
    mocks.staff.mockReturnValue(true);
    mocks.range
      .mockResolvedValueOnce({
        data: null,
        error: { code: "42703", message: "column products.updated_at does not exist" },
      })
      .mockResolvedValueOnce({ data: [], error: null });
    await pullDelta();
    expect(mocks.from).toHaveBeenCalledTimes(2);
  });
});

const auditRows = [
  {
    id: "entry-1",
    at: "2026-09-29T14:02:00Z",
    staffName: "Cashier",
    category: "Sales",
    action: "Sale",
    module: "POS",
    details: { storeId: "branch-1" },
  },
];

describe("PIN audit uploads", () => {
  it("sends audit rows through the proven relay", async () => {
    await expect(db.pushAuditLogs(auditRows)).resolves.toEqual(["entry-1"]);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.relay).toHaveBeenCalledWith(
      expect.objectContaining({
        table: "audit_logs",
        rows: [expect.objectContaining({ id: "entry-1", store_id: "branch-1" })],
      }),
    );
  });

  it("does not acknowledge failed relay uploads or fall back to anonymous writes", async () => {
    mocks.relay.mockResolvedValue({ ok: false, error: "Unavailable" });
    await expect(db.pushAuditLogs(auditRows)).rejects.toThrow("Unavailable");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("keeps unsigned audit entries pending without a database request", async () => {
    mocks.relayAllowed.mockReturnValue(false);
    await expect(db.pushAuditLogs(auditRows)).rejects.toThrow("Sign in");
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.relay).not.toHaveBeenCalled();
  });
});

describe("signed-in audit uploads", () => {
  it("preserves branch ownership on direct Supabase writes", async () => {
    mocks.staff.mockReturnValue(true);

    await expect(db.pushAuditLogs(auditRows)).resolves.toEqual(["entry-1"]);

    expect(mocks.from).toHaveBeenCalledWith("audit_logs");
    expect(mocks.upsert).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "entry-1", store_id: "branch-1" })],
      { onConflict: "id", ignoreDuplicates: true },
    );
    expect(mocks.relay).not.toHaveBeenCalled();
  });

  it("does not probe protected tables when Auth has no bearer session", async () => {
    mocks.staff.mockReturnValue(true);
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(pullDelta()).resolves.toEqual({ merged: 0 });
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
