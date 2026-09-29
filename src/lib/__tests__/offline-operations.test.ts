import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createLocalStaffStore } = require("../../../electron/local-staff-store.cjs");
const { listSyncedStaff, verifySyncedStaffPin } = require("../../../electron/synced-staff-login.cjs");
const bcrypt = require("bcryptjs");

function fixture() {
  const values = new Map<string, unknown>();
  const config = {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: unknown) => { values.set(key, value); return { ok: true }; },
  };
  return { values, store: createLocalStaffStore(config) };
}

describe("offline terminal operations", () => {
  it("connects a configured local database before loading the terminal route", () => {
    const main = readFileSync("electron/main.cjs", "utf8");
    expect(main.indexOf("await databaseService.restore()")).toBeLessThan(
      main.indexOf("createWindows(initialRoute)"),
    );
    expect(main).toMatch(/!restoredDatabase\.tradingReady\s*\? "\/database-startup"/);
    expect(main).toContain('function createWindows(initialRoute = "/")');
    expect(main).toContain("scheduleAutomaticSync(5_000)");
    expect(main).toContain("AUTO_SYNC_OK_MS = 15_000");
    expect(main).toContain("scheduleAutomaticSync(250)");
    expect(main).toContain('result.code === "ECHANGEGAP"');
    expect(main).toContain("prepareLocalData({ force: true })");
    const health = readFileSync("src/core/activation/connection-health.ts", "utf8");
    expect(health).toContain("bridge.database?.getState");
  });

  it("stores only a salted verifier and verifies a cached manager PIN", () => {
    const { values, store } = fixture();
    expect(store.cache([{ id: "m1", user_id: "manager", full_name: "Manager", role_slug: "manager", store_id: "s1", is_active: true }])).toMatchObject({ ok: true });
    expect(store.remember("manager", "2468")).toMatchObject({ ok: true });
    const serialized = JSON.stringify(values.get("offlineStaffCredentials"));
    expect(serialized).not.toContain("2468");
    expect(serialized).toContain("scrypt:");
    expect(store.verify("manager", "2468")).toMatchObject({
      ok: true,
      staff: { id: "m1", role_slug: "manager", store_id: "s1" },
    });
  });

  it("locks repeated wrong offline PIN attempts", () => {
    const { store } = fixture();
    store.cache([{ id: "a1", user_id: "admin", role_slug: "admin", is_active: true }]);
    store.remember("admin", "1357");
    for (let attempt = 0; attempt < 5; attempt += 1) store.verify("admin", "0000");
    expect(store.verify("admin", "1357")).toMatchObject({ ok: false, reason: "locked" });
  });

  it("accepts the same PIN for a user synchronized into local SQL", async () => {
    const pinHash = bcrypt.hashSync("2468", 4);
    const pool = {
      request: () => ({
        input() { return this; },
        query: async () => ({ recordset: [{
          id: "a1", username: "admin", full_name: "Administrator",
          store_id: "s1", role: "admin", role_slug: "admin",
          permissions: '{"can_manage_database":true}', is_active: true, pin_hash: pinHash,
        }] }),
      }),
    };
    await expect(verifySyncedStaffPin(pool, "admin", "2468", "s1")).resolves.toMatchObject({
      ok: true,
      staff: { username: "admin", role_slug: "admin", permissions: { can_manage_database: true } },
    });
    await expect(verifySyncedStaffPin(pool, "admin", "0000", "s1")).resolves.toMatchObject({ ok: false, reason: "invalid" });
  });

  it("wires reconnect sync and local approval through Electron", () => {
    const main = readFileSync("electron/main.cjs", "utf8");
    const preload = readFileSync("electron/preload.cjs", "utf8");
    const dialog = readFileSync("src/platforms/web/components/pos/AuthorizationDialog.tsx", "utf8");
    expect(main).toContain('ipcMain.handle("sync:auto"');
    expect(main).toContain("synchronization:{ok:false,pending:true");
    expect(main).toContain('databaseService.markReady({phase:"sync_pending"');
    expect(preload).toContain('auto: () => invoke("sync:auto")');
    expect(preload).toContain('verifyStaffPin: (username, pin) => invoke("staff:verify-pin"');
    expect(preload).toContain('rememberStaffPin: (username, pin) => invoke("staff:enroll"');
    expect(main).toContain('/api/public/cashier-login');
    const auth = readFileSync("src/lib/pos-auth.tsx", "utf8");
    expect(auth).toContain("role: offlineAppRole(local.staff.roleSlug)");
    expect(auth).toContain("roleSlug: local.staff.roleSlug");
    expect(dialog).toContain("await verifyLocalPin(authorizerId.trim(), pin)");
    expect(dialog).toContain('mode_used: "offline_pin"');
  });

  it("loads the complete active offline roster from synchronized SQL", async () => {
    const pool = {
      request: () => ({
        input() { return this; },
        query: async () => ({ recordset: [{
          id: "a1", username: "admin", full_name: "Administrator",
          store_id: "s1", role: "admin", role_slug: "admin",
          permissions: '{"can_manage_staff":true}', is_active: true,
        }] }),
      }),
    };
    await expect(listSyncedStaff(pool, "s1")).resolves.toEqual({
      ok: true,
      rows: [expect.objectContaining({
        username: "admin",
        role_slug: "admin",
        permissions: { can_manage_staff: true },
      })],
    });
    const main = readFileSync("electron/main.cjs", "utf8");
    expect(main).toContain("await listSyncedStaff(databaseManager.pool,branchId)");
  });

  it("bounds the sealed fallback cache instead of duplicating the full staff roster", () => {
    const { values, store } = fixture();
    store.cache(Array.from({ length: 40 }, (_, index) => ({
      id: `u${index}`,
      user_id: `user${index}`,
      full_name: `User ${index}`,
      role_slug: "staff",
      store_id: "s1",
      is_active: true,
    })));
    expect(Object.keys(values.get("offlineStaffCredentials") as object)).toHaveLength(12);
  });

  it("checks the synchronized SQL PIN before accepting a device-cached verifier", () => {
    const main = readFileSync("electron/main.cjs", "utf8");
    const handler = main.slice(
      main.indexOf('ipcMain.handle("staff:verify-pin"'),
      main.indexOf('ipcMain.handle("app:ready"'),
    );
    expect(handler.indexOf("verifySyncedStaffPin")).toBeLessThan(
      handler.indexOf('if (cached.reason === "locked")'),
    );
    expect(handler).toContain('["inactive", "invalid", "missing"].includes(synced.reason)');
  });

  it("does not serialize the complete POS state into encrypted device configuration", () => {
    const store = readFileSync("src/lib/pos-store.tsx", "utf8");
    expect(store).toContain("setSetting?.(LEGACY_STATE_KEY, null)");
    expect(store).not.toContain("setSetting?.(KEY, JSON.stringify(state))");
  });

  it("wakes synchronization after every local write and on reconnect", () => {
    const main = readFileSync("electron/main.cjs", "utf8");
    const writeHandler = main.slice(
      main.indexOf('ipcMain.handle("business:write-batch"'),
      main.indexOf('ipcMain.handle("business:commit-aggregate"'),
    );
    const aggregateHandler = main.slice(
      main.indexOf('ipcMain.handle("business:commit-aggregate"'),
      main.indexOf('ipcMain.handle("business:snapshot"'),
    );
    expect(writeHandler).toContain("scheduleAutomaticSync(250)");
    expect(aggregateHandler).toContain("scheduleAutomaticSync(250)");

    const rendererSync = readFileSync("src/lib/sync-engine.ts", "utf8");
    expect(rendererSync).toContain("subscribeConnectivity");
    expect(rendererSync).toContain('runExclusive("network")');
    expect(rendererSync).toContain('next.on("postgres_changes"');
  });

  it("keeps a dirty sync wake-up and performs a bounded final flush before SQL closes", () => {
    const main = readFileSync("electron/main.cjs", "utf8");
    expect(main).toContain("automaticSyncQueued = true");
    expect(main).toContain("automaticSyncQueued ? 250");
    expect(main).toContain("SHUTDOWN_SYNC_TIMEOUT_MS = 8_000");
    expect(main).toContain("async function flushSyncBeforeShutdown()");
    expect(main).toContain("event.preventDefault()");
    const shutdown = main.slice(main.indexOf('app.on("before-quit"'));
    expect(shutdown.indexOf("flushSyncBeforeShutdown()")).toBeLessThan(
      shutdown.indexOf("await databaseManager.close()"),
    );
    expect(shutdown).toContain("pending SQL changes remain durable for next launch");
  });

  it("uses a short-lived durable browser outbox for web and Android writes", () => {
    const outbox = readFileSync("src/lib/browser-sync-outbox.ts", "utf8");
    const commits = readFileSync("src/core/api/pos-db.ts", "utf8");
    const sync = readFileSync("src/lib/sync-engine.ts", "utf8");
    expect(outbox).toContain('indexedDB.open(DATABASE, 1)');
    expect(outbox).toContain("transaction.oncomplete");
    expect(outbox).toContain("MAX_BATCH_BYTES = 6 * 1024 * 1024");
    expect(outbox).toContain('.index("createdAt").openCursor()');
    expect(outbox).not.toContain(".getAll()");
    expect(outbox).not.toContain("localStorage");
    expect(commits.indexOf("persistBrowserBatch(context, ops")).toBeLessThan(
      commits.indexOf("await runBatchLive(context, cloudOps)"),
    );
    expect(commits).toContain("await acknowledgeBrowserBatch(pendingId)");
    expect(sync).toContain("await pendingBrowserBatches(25)");
    expect(sync).toContain('runExclusive("local-write")');
    expect(sync).toContain('runExclusive("background")');
  });

  it("binds renderer aggregates to the verified terminal branch", () => {
    const main = readFileSync("electron/main.cjs", "utf8");
    const aggregates = readFileSync("electron/db/repositories/aggregates.cjs", "utf8");
    const privilege = readFileSync("electron/ipc-privilege.cjs", "utf8");
    expect(main).toContain("const trustedAggregate={...aggregate,operations,branchId}");
    expect(main).toContain('branchStampedTables=new Set(["audit_logs","activity_events"');
    expect(main).toContain("String(row?.store_id??\"\").trim()?row:{...row,store_id:branchId}");
    expect(main).toContain("adminSession.branchId()");
    expect(main).toContain('code:"SYNC_BRANCH_FORBIDDEN"');
    expect(aggregates).toContain("async assertBranch(transaction, table, record, match, branchId)");
    expect(aggregates).toContain('code: "SYNC_BRANCH_FORBIDDEN"');
    expect(privilege).toContain('"business:write-batch": SUPERVISOR');
    expect(privilege).toContain('channel === "business:commit-aggregate"');
  });
});
