import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { listSyncedStaff, verifySyncedStaffPin, verifySyncedApprovalPin } = require("../../../electron/synced-staff-login.cjs");
const bcrypt = require("bcryptjs");

describe("offline terminal operations", () => {
  it("shows database startup before waiting for a configured local database", () => {
    const main = readFileSync("electron/main.cjs", "utf8");
    const startup = main.slice(main.indexOf("app.whenReady().then"));
    expect(startup.indexOf("createWindows(initialRoute)")).toBeLessThan(
      startup.indexOf("await databaseService.restore()"),
    );
    expect(startup).toContain('initialDatabase.enabled && initialDatabase.configured');
    expect(startup).toContain('const initialRoute = initialDatabase.enabled && initialDatabase.configured');
    expect(main).toContain('function createWindows(initialRoute = "/")');
    const recovery = readFileSync("src/routes/database-startup.tsx", "utf8");
    expect(recovery).toContain("api?.subscribe(applyState)");
    expect(recovery).toContain("if (next.tradingReady)");
    expect(main).toContain("scheduleAutomaticSync(5_000)");
    expect(main).toContain("AUTO_SYNC_OK_MS = ACTIVITY_INTERVAL_MS");
    expect(main).toContain("scheduleAutomaticSync(250)");
    expect(main).toContain('result.code === "ECHANGEGAP"');
    expect(main).toContain("prepareLocalData({ force: true })");
    const health = readFileSync("src/core/activation/connection-health.ts", "utf8");
    expect(health).toContain("bridge.database?.getState");
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
    await expect(verifySyncedApprovalPin(pool, "a1", "2468", "s1")).resolves.toMatchObject({ ok: true });
  });

  it("wires reconnect sync and local approval through Electron", () => {
    const main = readFileSync("electron/main.cjs", "utf8");
    const preload = readFileSync("electron/preload.cjs", "utf8");
    const dialog = readFileSync("src/platforms/web/components/pos/AuthorizationDialog.tsx", "utf8");
    expect(main).toContain('ipcMain.handle("sync:auto"');
    expect(main).toContain("synchronization:{ok:true,pending:true");
    expect(main).toContain('databaseService.markReady({phase:"sync_pending"');
    expect(preload).toContain('auto: () => invoke("sync:auto")');
    expect(preload).toContain('verifyStaffPin: (username, pin) => invoke("staff:verify-pin"');
    expect(preload).toContain('verifyApprovalPin: (username, pin) => invoke("staff:verify-approval-pin"');
    expect(preload).toContain('rememberStaffPin: (username, pin) => invoke("staff:enroll"');
    expect(main).toContain('/api/public/cashier-login');
    const auth = readFileSync("src/lib/pos-auth.tsx", "utf8");
    expect(auth).toContain("role: offlineAppRole(local.staff.roleSlug)");
    expect(auth).toContain("roleSlug: local.staff.roleSlug");
    expect(dialog).toContain("await verifyLocalApprovalPin(expectedId, pin)");
    expect(dialog).toContain("self_authorization: !!prompt.selfAuthorizer");
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

  it("uses synchronized SQL as the only Electron staff credential source", () => {
    const main = readFileSync("electron/main.cjs", "utf8");
    const handler = main.slice(
      main.indexOf('ipcMain.handle("staff:verify-pin"'),
      main.indexOf('ipcMain.handle("app:ready"'),
    );
    expect(handler).toContain("verifySyncedStaffPin(databaseManager.pool");
    expect(main).not.toContain("localStaffStore");
    expect(main).not.toContain("offlineStaffCredentials");
    expect(main).toContain('source:"sql-sync"');
  });

  it("keeps PIN throttling in local SQL instead of a renderer credential cache", () => {
    const login = readFileSync("electron/synced-staff-login.cjs", "utf8");
    expect(login).toContain("FROM dbo.pin_attempts");
    expect(login).toContain("MERGE dbo.pin_attempts WITH (HOLDLOCK)");
    expect(login).toContain("MAX_PIN_ATTEMPTS = 5");
    expect(login).toContain("await bcrypt.compare(secret, hash)");
    expect(login).toContain("WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544)");
    expect(login).toContain("OUTER APPLY (");
    expect(login).toContain("ORDER BY candidate.updated_at DESC,candidate.id DESC");
    expect(login).toContain("String(row.id).toLowerCase()");
    expect(login).not.toContain("offlineStaffCredentials");
  });

  it("passes the sealed branch and terminal scope to trusted shift and drawer writes", () => {
    const main = readFileSync("electron/main.cjs", "utf8");
    for (const context of [
      "Starting shift close",
      "Closing shift cash count",
      "Saving shift recount",
      "Approving shift variance",
      "Recording cash drawer request",
      "Recording cash drawer result",
    ]) {
      const start = main.indexOf(`operationsRepository.apply("${context}"`);
      expect(start, context).toBeGreaterThan(-1);
      expect(main.slice(start, start + 4_000), context).toContain("{ branchId, terminalId }");
    }
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
    expect(writeHandler).toContain("scheduleLocalChanges(operations)");
    expect(aggregateHandler).toContain("scheduleLocalChanges(operations)");

    const rendererSync = readFileSync("src/lib/sync-engine.ts", "utf8");
    expect(rendererSync).toContain("subscribeConnectivity");
    expect(rendererSync).toContain('runExclusive("network")');
    expect(rendererSync).toContain('next.on("postgres_changes"');
  });

  it("keeps a dirty sync wake-up and performs a bounded final flush before SQL closes", () => {
    const main = readFileSync("electron/main.cjs", "utf8");
    expect(main).toContain("automaticSyncQueued = true");
    expect(main).toContain("automaticSyncQueued ? 250");
    expect(main).toContain("SHUTDOWN_SYNC_TIMEOUT_MS = 120_000");
    expect(main).toContain("SHUTDOWN_RESOURCE_TIMEOUT_MS = 12_000");
    expect(main).toContain("function settleWithin(");
    expect(main).toContain("async function flushSyncBeforeShutdown()");
    expect(main).toContain("event.preventDefault()");
    const shutdown = main.slice(main.indexOf('app.on("before-quit"'));
    expect(shutdown.indexOf("prepareApplicationClose()")).toBeLessThan(
      shutdown.indexOf("settleWithin(() => databaseManager.close())"),
    );
    expect(shutdown).toContain("settleWithin(() => stopAppServer())");
    expect(shutdown).toContain("app.exit(0)");
    expect(shutdown).toContain("if (result?.ok === false)");
    expect(main).toContain("settleWithin(() => closeWriteBarrier.sealAndDrain(), SHUTDOWN_SYNC_TIMEOUT_MS)");
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
    expect(main).toContain("const trustedAggregate={");
    expect(main).toContain("branchId,");
    expect(main).toContain("terminalId:terminal.tokenId??terminal.terminalId??null");
    expect(main).toContain('branchStampedTables=new Set(["audit_logs","shift_sessions","activity_events"');
    expect(main).toContain('verifiedBranchTables=new Set(["audit_logs","shift_sessions"]');
    expect(main).toContain('aggregateKind==="receiving"&&operation.table==="purchase_orders"');
    expect(main).toContain("receivingFields.reduce");
    expect(main).toContain('!String(row?.store_id??"").trim()');
    expect(main).toContain("adminSession.branchId()");
    expect(main).toContain('code:"SYNC_BRANCH_FORBIDDEN"');
    expect(aggregates).toContain("async assertBranch(transaction, table, record, match, branchId)");
    expect(aggregates).toContain("branchId: aggregate.branchId");
    expect(aggregates).toContain("terminalId: aggregate.terminalId");
    expect(aggregates).toContain('code: "SYNC_BRANCH_FORBIDDEN"');
    expect(aggregates).toContain('"held_order", "general", "branch"');
    expect(aggregates).toContain('"shift", "product", "receiving"');
    expect(privilege).toContain('product: [');
    expect(privilege).toContain('"can_add_new_product"');
    expect(readFileSync("electron/ipc-guard.cjs", "utf8")).toContain('"branch",');
    expect(privilege).toContain('"business:write-batch": SUPERVISOR');
    expect(privilege).toContain('channel === "business:commit-aggregate"');
  });
});
