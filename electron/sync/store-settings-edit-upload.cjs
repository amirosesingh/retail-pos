"use strict";

// Called only by the trusted enrolled pilot under the existing sync lease.
// A network request never holds the local settings or journal transaction.
async function runStoreSettingsEditUpload({ coordinator, connectionManager, outbox, cloud, personId }) {
  return coordinator.withExclusive(async () => {
    if (coordinator.paused) return { status: "PAUSED" };
    const source = cloud.requestContext(true);
    const assertCurrent = () => {
      cloud.assertRequestContext(source, true);
      if (!source.pool || source.pool !== connectionManager.pool)
        throw Object.assign(new Error("The SQL Server connection changed."), { code: "ESYNC_SETTINGS_EDIT_SCOPE" });
    };
    const transact = async work => {
      assertCurrent();
      const sql = connectionManager.sql();
      const transaction = new sql.Transaction(source.pool);
      await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      try {
        const result = await work(transaction);
        assertCurrent();
        if (coordinator.paused) {
          await transaction.rollback();
          return null;
        }
        await transaction.commit();
        return result;
      } catch (error) {
        await Promise.resolve(transaction.rollback()).catch(() => undefined);
        throw error;
      }
    };

    const command = await transact(transaction => outbox.readPending(transaction, { personId }));
    if (coordinator.paused) return { status: "PAUSED" };
    if (!command) return { status: "EMPTY" };
    const witness = await cloud.submitStoreSettingsEdit(source, command);
    if (coordinator.paused) return { status: "PAUSED" };
    const result = await transact(transaction => outbox.acknowledge(transaction, {
      personId, operationId: command.operationId, witness,
    }));
    return result ? { status: result.disposition, operationId: command.operationId } : { status: "PAUSED" };
  });
}

module.exports = { runStoreSettingsEditUpload };
