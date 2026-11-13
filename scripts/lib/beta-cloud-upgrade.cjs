"use strict";
// Offline distribution wrapper. It never opens a Supabase connection.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { digest } = require("./existing-local-upgrade.cjs");
const root = path.resolve(__dirname, "../..");
const baselinePath = path.join(root, "database/beta/prepared/current-cloud-upgrade-baseline.json");
const sourcePath = path.join(root, "database/beta/retail-pos-supabase-beta-sync-upgrade.sql");
const queryPath = path.join(root, "database/beta/prepared/cloud-upgrade-fingerprint.readonly.sql");
const outputPath = path.join(root, "database/beta/retail-pos-supabase-beta-upgrade.sql");
const literal = text => "'" + String(text).replaceAll("'", "''") + "'";
function dollar(text, tag) {
  const delimiter = "$" + tag + "$";
  assert(!text.includes(delimiter), "SQL delimiter collision");
  return delimiter + text + delimiter;
}
function reviewedBody(source) {
  assert.equal([...source.matchAll(/^BEGIN;\r?$/gm)].length, 1, "Unexpected cloud transaction start");
  assert.equal([...source.matchAll(/^COMMIT;\r?$/gm)].length, 1, "Unexpected cloud transaction end");
  // Record both hashes. Only the standalone transaction delimiters are removed;
  // the original target, writer-shape and grant checks remain inside the body.
  return source.replace(/^BEGIN;\r?\n/m, "").replace(/^COMMIT;\s*$/m, "");
}

function renderCloud({ snapshot, source, query }) {
  const expected = snapshot.fingerprint;
  assert(expected && Array.isArray(expected.migrations) && expected.migrations.length);
  const last = expected.migrations.at(-1), before = expected.migrations.slice(0, -1);
  assert(/^\d{14}$/.test(last.version));
  const body = reviewedBody(source), read = query.trim().replace(/;$/, "");
  assert(/^SELECT\s/i.test(read), "Catalogue fingerprint must be read-only");
  const sql = [
    "-- Retail POS: existing Retail POS Beta upgrade. PREPARATION; exact-target approval required.",
    "-- Supabase/PostgreSQL only. Never run in production or in SQL Server.",
    "-- Current matching beta is a verified no-op; known prior beta uses the reviewed payload.",
    "-- Run as one standalone SQL Editor transaction, not inside another migration wrapper.",
    "-- No reset, fresh schema replay, user creation, pilot enrollment or business backfill.",
    "-- Source SHA256 " + digest(source),
    "-- Adapted body SHA256 " + digest(body),
    "BEGIN;",
    "SET LOCAL lock_timeout='5s';",
    "SET LOCAL statement_timeout='60s';",
    "SET LOCAL search_path=public,pg_catalog;",
    "DO $retail_beta_upgrade$",
    "DECLARE current_fingerprint jsonb;",
    "BEGIN",
    " SELECT catalogue.fingerprint INTO current_fingerprint FROM (" + read + ") catalogue;",
    " IF current_fingerprint->>'database_name' IS DISTINCT FROM " + literal(expected.database_name) +
      " OR current_fingerprint->>'database_role' IS DISTINCT FROM " + literal(expected.database_role) +
      " OR current_fingerprint->>'system_identifier' IS DISTINCT FROM " + literal(expected.system_identifier) + " THEN",
    "  RAISE EXCEPTION 'RETAIL_POS_BETA_WRONG_CLUSTER';",
    " END IF;",
    " PERFORM pg_catalog.pg_advisory_xact_lock(1907170937,451);",
    " SELECT catalogue.fingerprint INTO current_fingerprint FROM (" + read + ") catalogue;",
    " IF current_fingerprint=" + dollar(JSON.stringify(expected), "retail_expected") + "::jsonb THEN",
    "  RAISE NOTICE 'Retail POS Beta already matches this release; no upgrade was replayed.'; RETURN;",
    " END IF;",
    " IF current_fingerprint->'migrations' IS DISTINCT FROM " + dollar(JSON.stringify(before), "retail_prior_ledger") + "::jsonb THEN",
    "  RAISE EXCEPTION 'RETAIL_POS_BETA_UNRECOGNIZED_BASELINE';",
    " END IF;",
    " EXECUTE " + dollar(body, "retail_reviewed_payload") + ";",
    " INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(" +
      literal(last.version) + "," + literal(last.name) + ",ARRAY[" + dollar(source, "retail_ledger_source") + "]::text[]);",
    " SELECT catalogue.fingerprint INTO current_fingerprint FROM (" + read + ") catalogue;",
    " IF current_fingerprint IS DISTINCT FROM " + dollar(JSON.stringify(expected), "retail_postflight") + "::jsonb THEN",
    "  RAISE EXCEPTION 'RETAIL_POS_BETA_POSTFLIGHT_MISMATCH';",
    " END IF;",
    "END $retail_beta_upgrade$;",
    "COMMIT;",
    "SELECT " + literal(expected.project_ref) + " AS project_ref,'Verified current beta schema; no activation performed' AS result;",
    "",
  ].join("\n");
  return { sql, sha256: digest(sql), sourceSha256: digest(source), bodySha256: digest(body) };
}

function packageCloud() {
  const snapshot = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  assert.equal(snapshot.fingerprint.project_ref, "irjkmhgrjgcaoixcixut");
  assert.equal(snapshot.fingerprint.system_identifier, "7703759698107299042");
  assert.equal(snapshot.fingerprint.functions.length, 12);
  assert.equal(snapshot.fingerprint.migrations.at(-1).version, "20261110031005");
  return renderCloud({ snapshot, source: fs.readFileSync(sourcePath, "utf8"), query: fs.readFileSync(queryPath, "utf8") });
}
module.exports = { baselinePath, sourcePath, queryPath, outputPath, reviewedBody, renderCloud, packageCloud };
