"use strict";
// Deterministic files only. No connection, application or live migration.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { packageLocal, outputPath: localPath } = require("./lib/beta-local-upgrade.cjs");
const { packageCloud, outputPath: cloudPath } = require("./lib/beta-cloud-upgrade.cjs");
const { digest } = require("./lib/existing-local-upgrade.cjs");
const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "database/beta/prepared/current-upgrade-package.manifest.json");
function build() {
  const cloud = packageCloud(), local = packageLocal();
  const manifest = { format: 1, preparedOn: "2026-11-13", sourceRevision: "71022a12d677ae3cba61427ea93819e1697e2479",
    scope: "Beta only; no application or production approval", coreVersion: 24,
    cloud: { file: path.relative(root, cloudPath).replaceAll('\\','/'), sha256: cloud.sha256,
      sourceSha256: cloud.sourceSha256, bodySha256: cloud.bodySha256,
      project: "irjkmhgrjgcaoixcixut", systemIdentifier: "7703759698107299042",
      behavior: "Verify/no-op if current; exact prior baseline upgrade otherwise; reject unknown" },
    local: { file: path.relative(root, localPath).replaceAll('\\','/'), sha256: local.sha256,
      database: "POS_Local_Beta", requiredCore: 24,
      modules: local.sources.map(m => ({ id: m.id, source: m.file, originalSha256: m.originalSha256, adapter: m.adapter, adaptedSha256: digest(m.sql) })) },
    readme: { file:"database/beta/README-existing-upgrade.md",sha256:digest(fs.readFileSync(path.join(root,"database/beta/README-existing-upgrade.md"),"utf8")) },
    notIncluded: ["Fresh installation", "Production delta/application", "New documentation-only C17/C18 implementation", "Pilot activation", "Operator settings or credential changes"] };
  return { cloud, local, manifest };
}
if (require.main === module) {
  assert(["--write", "--check"].includes(process.argv[2]) && process.argv.length === 3, "Use --write or --check; no connection arguments");
  const result = build();
  const files = [[cloudPath,result.cloud.sql],[localPath,result.local.sql],[manifestPath,JSON.stringify(result.manifest,null,2)+"\n"]];
  for (const [file, text] of files) {
    if (process.argv[2] === "--write") fs.writeFileSync(file,text,"utf8");
    else assert.equal(fs.readFileSync(file,"utf8"),text,"Reviewed output changed: "+path.relative(root,file));
  }
  console.log(JSON.stringify({ cloud: result.manifest.cloud.sha256, local: result.manifest.local.sha256,
    localModules: result.manifest.local.modules.length, connectionOpened: false }));
}
module.exports = { build, manifestPath };
