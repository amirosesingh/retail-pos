"use strict";
// Deterministic files only. No connection, application or live migration.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { packageLocal, outputPath: localPath } = require("./lib/beta-local-upgrade.cjs");
const { packageCloud, outputPath: cloudPath } = require("./lib/beta-cloud-upgrade.cjs");
const { packageFreshLocal, outputPath: freshPath } = require("./lib/beta-local-fresh.cjs");
const { packageSetupLocal, outputPath: setupPath } = require("./lib/beta-local-setup.cjs");
const { digest } = require("./lib/existing-local-upgrade.cjs");
const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "database/beta/prepared/current-upgrade-package.manifest.json");
function build() {
  const cloud = packageCloud(), local = packageLocal(), fresh = packageFreshLocal(), setup = packageSetupLocal();
  const manifest = { format: 1, preparedOn: "2026-11-14", sourceRevision: "5d49f01087d1fc3c281819d6a4f936d7a5e3a206",
    scope: "Beta only; no application or production approval", coreVersion: 24,
    cloud: { file: path.relative(root, cloudPath).replaceAll('\\','/'), sha256: cloud.sha256,
      sourceSha256: cloud.sourceSha256, bodySha256: cloud.bodySha256,
      project: "irjkmhgrjgcaoixcixut", systemIdentifier: "7703759698107299042",
      behavior: "Verify/no-op if current; exact prior baseline upgrade otherwise; reject unknown" },
    local: { file: path.relative(root, localPath).replaceAll('\\','/'), sha256: local.sha256,
      database: "POS_Local_Beta", requiredCore: 24,
      modules: local.sources.map(m => ({ id: m.id, source: m.file, originalSha256: m.originalSha256, adapter: m.adapter, adaptedSha256: digest(m.sql) })) },
    freshLocal: { file:path.relative(root,freshPath).replaceAll('\\','/'),sha256:fresh.sha256,
      sourceSha256:fresh.sourceSha256,upgradeSha256:fresh.upgradeSha256,database:"POS_Local_Beta",
      prerequisite:"Pre-create an empty isolated database; selected target is never created/switched by this file" },
    localSetup: { file:path.relative(root,setupPath).replaceAll('\\','/'),sha256:setup.sha256,
      freshSha256:setup.freshSha256,database:"POS_Local_Beta",
      behavior:"Create if missing and select internally; install only into empty target; refuse populated targets" },
    readme: { file:"database/beta/README-existing-upgrade.md",sha256:digest(fs.readFileSync(path.join(root,"database/beta/README-existing-upgrade.md"),"utf8")) },
    notIncluded: ["Supabase fresh replay on an existing project", "Supabase project creation", "Production delta/application", "New documentation-only C17/C18 implementation", "Pilot activation", "Operator settings or credential changes"] };
  return { cloud, local, fresh, setup, manifest };
}
if (require.main === module) {
  assert(["--write", "--check"].includes(process.argv[2]) && process.argv.length === 3, "Use --write or --check; no connection arguments");
  const result = build();
  const files = [[cloudPath,result.cloud.sql],[localPath,result.local.sql],[freshPath,result.fresh.sql],[setupPath,result.setup.sql],[manifestPath,JSON.stringify(result.manifest,null,2)+"\n"]];
  for (const [file, text] of files) {
    if (process.argv[2] === "--write") fs.writeFileSync(file,text,"utf8");
    else assert.equal(fs.readFileSync(file,"utf8"),text,"Reviewed output changed: "+path.relative(root,file));
  }
  console.log(JSON.stringify({ cloud: result.manifest.cloud.sha256, local: result.manifest.local.sha256,
    localModules: result.manifest.local.modules.length, connectionOpened: false }));
}
module.exports = { build, manifestPath };
