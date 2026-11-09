import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createLocal } = require("./shift-protocol-integration-fixture.cjs");
const { StoreSettingsEditOutbox } = require("../../electron/db/store-settings-edit-outbox.cjs");
const { CloudClient, assertStoreSettingsEditReceipt } = require("../../electron/sync/cloud-client.cjs");
const { readDatabaseGuid } = require("../../electron/sync/grouped-store-settings.cjs");
const { runStoreSettingsEditUpload } = require("../../electron/sync/store-settings-edit-upload.cjs");
const { SyncCoordinator } = require("../../electron/sync/coordinator.cjs");

export async function uploadSettingsFromLocal({ branchId, terminalId, personId, feedEpoch, expectedVersion,
  deviceBindingProof, backend, project, accessToken, enroll }) {
  const local = await createLocal(branchId);
  try {
    const { manager } = local;
    manager.profile = { id: "owned-settings-sender", host: "owned-private-pipe", database: "owned-settings-sender" };
    await manager.pool.request().batch(await readFile(new URL("../preparation/pos-store-settings-edit-outbox-v1.sql", import.meta.url), "utf8"));
    await local.insert("pos_store_settings", { store_id: branchId, row_version: expectedVersion, block_shift_close_on_hold: false });
    const scope = { branchId, terminalId, feedEpoch, installationGeneration: randomUUID(),
      databaseGuid: await readDatabaseGuid(manager.pool.request()) };
    enroll(scope);
    const cloud = new CloudClient({ connectionManager: manager,
      configStore: { get: () => backend }, terminalStore: { read: () => ({
        tokenId: terminalId, locationId: branchId, deviceUse: "operations", deviceType: "pc", deviceBindingProof,
      }) }, financialBasisContext: () => ({ branchId, projectOrigin: project }) });
    cloud.setAuthorizationProof({ accessToken, sessionToken: "fixture-unused-raw-session" });
    const outbox = new StoreSettingsEditOutbox({ connectionManager: manager, scope,
      assertContext: (_transaction, candidate, person) => person === personId &&
        Object.entries(scope).every(([key, value]) => candidate[key] === value),
      assertReceipt: assertStoreSettingsEditReceipt });
    const sql = manager.sql();
    const transaction = new sql.Transaction(manager.pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const operationId = randomUUID();
    const patch = { block_shift_close_on_hold: true, max_drawer_cash_limit: "9007199254740993.125000000002" };
    try {
      await outbox.capture(transaction, { personId, operationId, expectedVersion, patch });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback().catch(() => undefined);
      throw error;
    }
    const coordinator = new SyncCoordinator({ pushWorker: {}, pullWorker: {} });
    const upload = () => runStoreSettingsEditUpload({ coordinator, connectionManager: manager, outbox, cloud, personId });
    await assert.rejects(upload(), /fixture lost the committed response/);
    assert.equal((await manager.pool.request().query("SELECT COUNT(*) AS n FROM dbo.pos_store_settings_edit_receipts;")).recordset[0].n, 0);
    assert.deepEqual(await upload(), { status: "APPLIED", operationId });
    assert.deepEqual(await upload(), { status: "AWAITING_DOWNLOAD" });
    assert.equal((await manager.pool.request().query("SELECT COUNT(*) AS n FROM dbo.pos_store_settings_edit_receipts;")).recordset[0].n, 1);
    return { operationId, patch };
  } finally { await local.close(); }
}
