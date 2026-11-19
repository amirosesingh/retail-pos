"use strict";
// Offline preparation only. The caller must select the verified beta project.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { MIGRATION, render: renderMigration } = require("./sale-item-sync-scope.cjs");
const root = path.resolve(__dirname, "..");
const PROJECT = "irjkmhgrjgcaoixcixut", SYSTEM = "7703759698107299042";
const outputPath = path.join(root, "database/beta/retail-pos-supabase-beta-sale-item-scope.sql");
const digest = text => createHash("sha256").update(text, "utf8").digest("hex");
function render(body, systemIdentifier = SYSTEM) {
  assert(/^[0-9]{1,20}$/.test(systemIdentifier), "Invalid cluster identity");
  assert(typeof body === "string" && body.trim(), "Missing reviewed migration");
  assert(!/^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;\s*$/im.test(body), "The caller owns the transaction");
  const delimiter = "$retail_reviewed_sale_item_scope$";
  assert(!body.includes(delimiter), "SQL delimiter collision");
  const bodySha256 = digest(body);
  const sql = [
    "-- Retail POS Beta sale-item scope repair. PostgreSQL only.",
    "-- Exact target: " + PROJECT + "; database postgres; system identifier " + systemIdentifier + ".",
    "-- No business rows, saved setup, pending work or cursors are rewritten.",
    "-- The single DO statement is atomic even when the caller has no outer transaction.",
    "-- Reviewed migration: " + MIGRATION,
    "-- Migration SHA256: " + bodySha256,
    "DO $retail_beta_sale_item_scope$",
    "BEGIN",
    " IF current_database()<>'postgres' OR current_user<>'postgres' OR",
    "    (SELECT system_identifier::text FROM pg_catalog.pg_control_system())<> '" + systemIdentifier + "' THEN",
    "  RAISE EXCEPTION 'RETAIL_POS_BETA_WRONG_CLUSTER';",
    " END IF;",
    " PERFORM set_config('lock_timeout','5s',true);",
    " PERFORM set_config('statement_timeout','60s',true);",
    " PERFORM pg_catalog.pg_advisory_xact_lock(1907170937,471);",
    " EXECUTE " + delimiter + body + delimiter + ";",
    "END $retail_beta_sale_item_scope$;",
    "",
  ].join("\n");
  return { sql, sha256: digest(sql), bodySha256, project: PROJECT, systemIdentifier };
}
function build() {
  const sourcePath = path.join(root, "supabase/migrations", MIGRATION);
  const body = fs.readFileSync(sourcePath, "utf8");
  assert.equal(body, renderMigration(), "Regenerate the reviewed scope migration before packaging");
  return render(body);
}
if (require.main === module) {
  assert.deepEqual(process.argv.slice(2), [process.argv[2]], "No connection arguments are accepted");
  assert(["--write", "--check"].includes(process.argv[2]), "Use --write or --check");
  const result = build();
  if (process.argv[2] === "--write") fs.writeFileSync(outputPath, result.sql, "utf8");
  else assert.equal(fs.readFileSync(outputPath, "utf8"), result.sql, "Prepared beta scope repair changed");
  console.log(JSON.stringify({ file: path.relative(root, outputPath), sha256: result.sha256,
    bodySha256: result.bodySha256, project: result.project, connectionOpened: false }));
}
module.exports = { PROJECT, SYSTEM, outputPath, render, build };
