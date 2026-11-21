const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const contract = require("./stock-history-contract.cjs");
const { StockHistoryStore } = require("./stock-history.cjs");
const installSql = readFileSync(join(__dirname, "stock-history-download-install.sql"), "utf8");

function createStockHistoryInstaller(manager, databaseGuid) {
  async function current(manifest, scope, assertCurrent) {
    const store = new StockHistoryStore(manager, { assertCurrent, expectedDatabaseGuid: databaseGuid });
    const pool = manager.pool;
    if (!(await store.capability(pool)).available) contract.fail("ESTOCK_HISTORY_SCHEMA_UNAVAILABLE");
    const { recordset } = await store.request(pool).input("branch", manager.sql().NVarChar(128), scope.branchId).query(`
      SELECT store_id, JSON_VALUE(terminal_watermarks,'$.stockHistoryDownload.projectOrigin') project_origin,
       JSON_VALUE(terminal_watermarks,'$.stockHistoryDownload.terminalId') terminal_id,
       JSON_VALUE(terminal_watermarks,'$.stockHistoryDownload.revision') revision,
       JSON_VALUE(terminal_watermarks,'$.stockHistoryDownload.coverageGeneration') generation
      FROM dbo.stock_history_heads WHERE store_id=@branch;`);
    assertCurrent();
    const row = recordset?.[0];
    if (!row) return false;
    if (row.store_id !== scope.branchId || (row.generation !== null &&
        (row.project_origin !== scope.projectOrigin || row.terminal_id !== scope.terminalId))) contract.fail("ESTOCK_HISTORY_CONTEXT_CHANGED");
    if (row.generation !== null && (BigInt(row.generation) > BigInt(manifest.coverageGeneration) ||
        (row.generation === manifest.coverageGeneration && row.revision !== manifest.revision)))
      contract.fail("ESTOCK_HISTORY_DOWNLOAD_STALE");
    return row.revision === manifest.revision && row.generation === manifest.coverageGeneration;
  }

  async function apply(staged, scope, generation, assertCurrent) {
    const sql = manager.sql(), pool = manager.pool;
    const guard = () => {
      assertCurrent();
      if (manager.pool !== pool) contract.fail("ESTOCK_HISTORY_CONTEXT_CHANGED");
    };
    const store = new StockHistoryStore(manager, { assertCurrent: guard, expectedDatabaseGuid: databaseGuid });
    guard();
    const tx = new sql.Transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);
    try {
      if (!(await store.capability(tx)).available) contract.fail("ESTOCK_HISTORY_SCHEMA_UNAVAILABLE");
      guard();
      const manifest = staged?.manifest, revision = manifest?.revision ?? null;
      const request = new sql.Request(tx, { requestTimeout: 10_000 });
      const text = (name, value, size = 128) => request.input(name, sql.NVarChar(size), value);
      text("branch", scope.branchId);
      text("terminal", scope.terminalId);
      text("project", scope.projectOrigin, 400);
      text("generation", generation, 19);
      text("revision", revision, 64);
      text("provenance", JSON.stringify({ projectOrigin: scope.projectOrigin, terminalId: scope.terminalId,
        coverageGeneration: generation, revision, snapshotId: manifest?.snapshotId ?? null }), sql.MAX);
      if (manifest) {
        const [baselineId, cutoffAt, capturedAt, sourceCursor, kind, expectedPairs, verifiedBy, evidenceHash, watermarks] = manifest.baseline;
        text("baseline", baselineId, 36);
        text("cutoff_at", cutoffAt, 28);
        text("cutoff_ticks", String(contract.instant(cutoffAt)), 20);
        text("captured_at", capturedAt, 28);
        text("captured_ticks", String(contract.instant(capturedAt)), 20);
        text("source_cursor", sourceCursor, 19);
        text("head_cursor", manifest.headCursor, 19);
        text("opening_kind", kind, 20);
        request.input("expected_pairs", sql.Int, expectedPairs);
        text("verified_by", verifiedBy);
        text("evidence_hash", evidenceHash, 64);
        text("baseline_watermarks", watermarks, sql.MAX);
        text("coverage_state", manifest.coverageState, 16);
        text("coverage_from", manifest.coverageFrom, 21);
        text("coverage_through", manifest.coverageThrough, 21);
        text("openings", JSON.stringify(staged.openings), sql.MAX);
        text("movements", JSON.stringify(staged.movements), sql.MAX);
      }
      // T-SQL compiles all statements in a batch even for a withdrawal. The
      // absent snapshot still binds inert parameters for that unreachable block.
      if (!manifest) {
        for (const key of ["baseline", "cutoff_at", "cutoff_ticks", "captured_at", "captured_ticks", "source_cursor", "head_cursor",
          "opening_kind", "expected_pairs", "verified_by", "evidence_hash", "baseline_watermarks", "coverage_state", "coverage_from",
          "coverage_through", "openings", "movements"]) text(key, null);
      }
      const { recordset } = await request.query(installSql);
      const status = recordset?.[0]?.status;
      if (recordset?.length !== 1 || !["installed", "unchanged", "withdrawn"].includes(status))
        contract.fail("ESTOCK_HISTORY_DOWNLOAD_UNVERIFIED");
      guard();
      await tx.commit();
      return status;
    } catch (error) {
      await Promise.resolve(tx.rollback()).catch(() => undefined);
      throw error;
    }
  }

  return {
    current,
    install: (staged, scope, assertCurrent) => apply(staged, scope, staged.manifest.coverageGeneration, assertCurrent),
    withdraw: (generation, scope, assertCurrent) => apply(null, scope, generation, assertCurrent),
  };
}

module.exports = { createStockHistoryInstaller };
