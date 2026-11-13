"use strict";
// Explicitly owned disposable fixture only. No operator connection arguments.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createOwnedUpgradeFixture } = require("./lib/owned-upgrade-fixture.cjs");
const { capture } = require("./lib/local-upgrade-catalogue.cjs");
const { digest, canonical } = require("./lib/existing-local-upgrade.cjs");
const { runtimeParity } = require("./capture-existing-upgrade-manifest.cjs");
const { sourceModules, coreSources, manifestPath } = require("./lib/beta-local-upgrade.cjs");

async function main() {
  assert.deepEqual(process.argv.slice(2), ["--run"], "Only --run is accepted; no connection arguments");
  const f = await createOwnedUpgradeFixture();
  try {
    await f.installCore();
    const tables = (await f.pool.request().query("SELECT name FROM sys.tables WHERE schema_id=SCHEMA_ID('dbo') ORDER BY name;")).recordset.map(r => r.name);
    // The refund module validates this full existing table after adding its
    // columns/check/index, so the core fingerprint leaves it to that module.
    const selectors = { tables: tables.filter(t => t !== "local_operation_receipts"),
      ignoreColumns: [{ table: "pos_store_settings", column: "allow_branch_shift_sharing" }], normalizeSystemNames: true };
    const core = await capture(f.pool, selectors, f.collation);
    const modules = [];
    for (const module of sourceModules()) {
      await f.pool.request().batch(module.sql);
      if (module.id < "040") await runtimeParity(f, module.id);
      modules.push({ id: module.id, source: module.file, originalSha256: module.originalSha256,
        adapter: module.adapter, adaptedCanonicalSha256: digest(canonical(module.sql)),
        shape: await capture(f.pool, module.selectors, f.collation) });
      console.log("Captured " + module.id);
    }
    const manifest = { format: 1, capturedOn: "2026-11-13", sourceRevision: "71022a12d677ae3cba61427ea93819e1697e2479",
      applicationVersion: require("../package.json").version, coreVersion: 24, targetDatabase: "POS_Local_Beta",
      sourceKind: "uniquely-owned-disposable-LocalDB", collation: f.collation,
      coreSources: coreSources(), core, modules };
    fs.mkdirSync(require("node:path").dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    console.log(JSON.stringify({ manifest: manifestPath, modules: modules.length }));
  } finally { await f.close(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
