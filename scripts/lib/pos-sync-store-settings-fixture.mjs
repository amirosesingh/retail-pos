import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);

export async function verifyStoreSettingsPilot({ sql, denySql, session, waitFor, applyNative }) {
  const read = async path => (await readFile(new URL(path, import.meta.url), "utf8")).replaceAll("\r\n", "\n");
  const schema = await read("../../supabase/schema.sql");
  const table = schema.match(/CREATE TABLE IF NOT EXISTS public\.pos_store_settings \([\s\S]*?\n\);/)?.[0];
  assert(table, "The current canonical settings table is required");
  const amendments = schema.match(/ALTER TABLE public\.pos_store_settings\s+ADD COLUMN IF NOT EXISTS [^;]+;/g) ?? [];
  const preparation = await read("../preparation/pos-sync-store-settings-v1.sql");
  const columns = require("../../database/sqlserver/schema-registry.json").tables
    .find(entry => entry.cloudTable === "pos_store_settings").columns.map(column => column.cloudColumn).sort();
  const epoch = randomUUID();
  const branch = "fixture-settings-a";
  const unrelatedBranch = "fixture-settings-b";
  const settings = "public.pos_store_settings";
  const feed = "pos_sync_feed_v1";
  const pinCall = `SELECT ${feed}.create_snapshot_pin('default', '${branch}', '${epoch}', 60);`;
  const pull = (after = "0") => JSON.parse(sql(`SELECT ${feed}.pull_groups('default', '${branch}', '${epoch}', '${after}');`));
  const exportSnapshot = (pin, requestedBranch = branch) => JSON.parse(sql(
    `SELECT ${feed}.export_store_settings_snapshot('default', '${requestedBranch}', '${epoch}', '${pin}');`,
  ));

  sql(`SET client_min_messages = warning;
    ${table}\n${amendments.join("\n")}
    ALTER TABLE ${settings} ADD COLUMN fixture_private_value text;
    INSERT INTO ${settings} (store_id, max_drawer_cash_limit, updated_at, fixture_private_value)
      VALUES ('${branch}', 9007199254740993.000000000001, '2026-11-07 09:30:00.123456+08', 'local-only-marker'),
             ('${unrelatedBranch}', 10, '2026-11-07 01:30:00+00', 'other-store-marker');
    BEGIN; ${preparation} COMMIT;
    INSERT INTO ${feed}.feed_heads (organization_id, scope_id, epoch) VALUES ('default', '${branch}', '${epoch}');
    INSERT INTO ${feed}.settings_pilots VALUES ('default', '${branch}', '${epoch}');`);

  const pin = JSON.parse(sql(pinCall));
  assert.equal(pin.status, "OK");
  assert.equal(pin.protected_seq, "0");
  const baseline = exportSnapshot(pin.pin_id);
  assert.equal(baseline.status, "OK");
  assert.equal(baseline.seq, "0");
  assert.equal(baseline.manifest_sha256, createHash("sha256").update(baseline.manifest_json).digest("hex"));
  const manifest = JSON.parse(baseline.manifest_json);
  const [before] = manifest.changes;
  assert.equal(manifest.scope_id, branch);
  assert.equal(manifest.epoch, epoch);
  assert.equal(before.table_name, "pos_store_settings");
  assert.deepEqual(JSON.parse(before.entity_id), { store_id: branch });
  assert.deepEqual(Object.keys(before.row_data).sort(), columns);
  assert.equal(before.row_data.max_drawer_cash_limit, "9007199254740993.000000000001");
  assert.equal(before.row_data.updated_at, "2026-11-07T01:30:00.1234560Z");
  assert(!baseline.manifest_json.includes("local-only-marker"));
  assert.deepEqual(exportSnapshot(pin.pin_id, unrelatedBranch), { status: "SCOPE_UNAVAILABLE" });

  const holder = session();
  holder.child.stdin.write(`BEGIN;
    UPDATE ${settings} SET block_shift_close_on_hold=true, row_version=2 WHERE store_id='${branch}';
    \\echo SETTINGS_WRITE_READY\n`);
  await waitFor(() => holder.stdout.includes("SETTINGS_WRITE_READY"), "The staged settings write did not begin");
  assert.equal(exportSnapshot(pin.pin_id).manifest_json, baseline.manifest_json);
  assert.equal(pull().groups.length, 0);
  holder.child.stdin.end("COMMIT;\n");
  assert.equal(await holder.finished, 0, holder.stderr);

  const update = pull();
  assert.equal(update.next_seq, "1");
  assert.equal(update.groups[0].changes[0].row_version, "2");
  assert.equal(update.groups[0].changes[0].row_data.block_shift_close_on_hold, true);
  const after = exportSnapshot(pin.pin_id);
  assert.equal(after.seq, "1");
  assert.deepEqual(JSON.parse(after.manifest_json).changes, update.groups[0].changes);
  await applyNative?.({ baseline, page: update });

  sql(`UPDATE ${settings} SET max_drawer_cash_limit=200, row_version=2 WHERE store_id='${unrelatedBranch}';
    UPDATE ${settings} SET fixture_private_value='new-private-value' WHERE store_id='${branch}';
    BEGIN;
      UPDATE ${settings} SET block_shift_close_on_hold=false, row_version=3 WHERE store_id='${branch}';
    ROLLBACK;`);
  assert.equal(pull().next_seq, "1");
  assert.equal(exportSnapshot(pin.pin_id).manifest_json, after.manifest_json);
  denySql(`DELETE FROM ${settings} WHERE store_id='${branch}';`, /POS_SETTINGS_V1_DELETE_UNSUPPORTED/);
  denySql(`UPDATE ${settings} SET store_id='another' WHERE store_id='${branch}';`, /POS_SETTINGS_V1_SCOPE_MOVE_UNSUPPORTED/);
  denySql(`UPDATE ${settings} SET block_shift_close_on_hold=false WHERE store_id='${branch}';`, /POS_SETTINGS_V1_REVISION_NOT_ADVANCED/);
  denySql(`UPDATE ${settings} SET max_drawer_cash_limit=0.0000000000001, row_version=3 WHERE store_id='${branch}';`,
    /POS_SETTINGS_V1_PROJECTION_UNAVAILABLE/);
  assert.equal(pull().next_seq, "1");

  const retire = `SELECT ${feed}.retire_groups('default', '${branch}', '${epoch}', '1');`;
  assert.equal(JSON.parse(sql(retire)).replay_floor, "0");
  sql(`UPDATE ${feed}.snapshot_pins SET expires_at=now()-interval '1 second' WHERE pin_id='${pin.pin_id}';`);
  assert.deepEqual(exportSnapshot(pin.pin_id), { status: "SNAPSHOT_REQUIRED", reason: "PIN_UNAVAILABLE" });
  assert.equal(JSON.parse(sql(retire)).replay_floor, "1");
  assert.deepEqual(pull(), { status: "SNAPSHOT_REQUIRED", reason: "REPLAY_EXPIRED" });
  const replacementPin = JSON.parse(sql(pinCall));
  assert.equal(exportSnapshot(replacementPin.pin_id).seq, "1");
  assert.equal(pull("1").groups.length, 0);

  for (const role of ["anon", "authenticated", "service_role"]) {
    denySql(`SET ROLE ${role}; SELECT ${feed}.export_store_settings_snapshot('default','${branch}','${epoch}','${pin.pin_id}');`, /permission denied/);
  }
  console.log("PASS isolated settings publication and snapshot (scope, exact fields, atomicity, retention and recovery)");
}
