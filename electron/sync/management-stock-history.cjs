const { binding } = require("../verified-activation.cjs");
const { identifier, fail } = require("../db/stock-history-contract.cjs");
const { createStockHistoryInstaller } = require("../db/stock-history-download.cjs");
const { createStockHistoryDownloader } = require("./stock-history-download.cjs");

/** Reuse the pull coordinator and keep at most one bounded staged publication per Management replica. */
function createManagementStockHistory({ manager, cloud, ready }) {
  let sourceKey, sourcePool, staged, lastBranch, active;

  return async function download(runInstall) {
    if (active || !ready()) return;
    const source = cloud.verifiedManagementStockScope();
    const terminal = binding(source?.terminal);
    if (!source || source.pool !== manager.pool || terminal?.mode !== "management" || terminal.platform !== "pc") return;
    const project = new URL(source.project?.projectOrigin);
    if (project.protocol !== "https:" || project.username || project.password) return;
    const key = JSON.stringify([source.fingerprint, source.stamp]);
    if (key !== sourceKey || source.pool !== sourcePool) {
      sourceKey = key;
      sourcePool = source.pool;
      staged = null;
      lastBranch = null;
    }
    const branchId = staged?.branchId ?? source.branches.find(value => lastBranch === null || value > lastBranch) ?? source.branches[0];
    if (!branchId) return;

    const guard = () => {
      const current = cloud.verifiedManagementStockScope();
      if (!current || !ready() || manager.pool !== source.pool || current.fingerprint !== source.fingerprint ||
          current.stamp !== source.stamp || !current.branches.includes(branchId)) fail("ESTOCK_HISTORY_CONTEXT_CHANGED");
    };
    active = true;
    try {
      guard();
      if (!staged) {
        const result = await source.pool.request().query(`
          SELECT LOWER(CONVERT(nvarchar(36),database_guid)) database_guid
          FROM sys.database_recovery_status WHERE database_id=DB_ID();`);
        guard();
        if (result.recordset?.length !== 1) fail("ESTOCK_HISTORY_CONTEXT_CHANGED");
        const databaseGuid = identifier(result.recordset[0].database_guid, true);
        staged = {
          branchId,
          download: createStockHistoryDownloader({
            ...createStockHistoryInstaller(manager, databaseGuid),
            request: input => cloud.downloadStockHistory(input),
          }),
        };
      }
      const scope = { branchId, terminalId: terminal.id, projectOrigin: project.origin };
      return await staged.download(scope, guard, work => runInstall(assertLease => work(() => {
        guard();
        if (assertLease() !== true) fail("ESTOCK_HISTORY_CONTEXT_CHANGED");
      })));
    } finally {
      if (!staged?.download.hasPending()) {
        staged = null;
        lastBranch = branchId;
      }
      active = false;
    }
  };
}

module.exports = { createManagementStockHistory };
