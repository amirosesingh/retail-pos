import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export async function verifyInboxFoundation({ sql, denySql }) {
  const preparation = await readFile(new URL("../preparation/pos-sync-inbox-v1.sql", import.meta.url), "utf8");
  const org = "inbox-fixture";
  const scope = "till-a";
  const epoch = "40000000-0000-4000-8000-000000000001";
  const installation = "40000000-0000-4000-8000-000000000002";
  const otherInstallation = "40000000-0000-4000-8000-000000000003";
  const operation = "40000000-0000-4000-8000-000000000004";
  const rolledBack = "40000000-0000-4000-8000-000000000005";
  const unrecorded = "40000000-0000-4000-8000-000000000006";
  const schema = "pos_sync_inbox_v1";
  const claim = (id = operation, origin = installation, payload = '{"kind":"SaleCompleted","sale":"one"}') =>
    `${schema}.claim_operation('${org}', '${id}', '${origin}', '${payload}')`;
  const record = (id, status, result) =>
    `${schema}.record_disposition('${org}', '${id}', '${status}', '${JSON.stringify(result)}')`;
  const group = id => JSON.stringify([{ scope_id: scope, epoch, operation_id: id, changes: [{ entity: id }] }]);
  const effect = id => `INSERT INTO fixture_effects VALUES ('${id}');
    SELECT pos_sync_feed_v1.append_groups('${org}', '${group(id)}');`;
  const accept = id => `${record(id, "APPLIED", { receipt: id })}`;

  sql(`BEGIN; ${preparation} COMMIT;
       CREATE TABLE fixture_effects (operation_id uuid PRIMARY KEY);
       INSERT INTO pos_sync_feed_v1.feed_heads (organization_id, scope_id, epoch) VALUES ('${org}', '${scope}', '${epoch}');`);

  // A dependency wait stays bound to its operation and canonical content.
  assert.match(sql(`BEGIN; SELECT ${claim()}->>'status';
    SELECT ${claim()}->>'status';
    SELECT ${record(operation, "WAITING_DEPENDENCY", { missing: "shift" })}; COMMIT;`), /^PROCEED\nIN_PROGRESS$/);
  assert.equal(sql(`SELECT ${claim(operation, installation, '{"kind":"SaleCompleted","sale":"other"}')}->>'status';`), "INTEGRITY_CONFLICT");
  assert.equal(sql(`SELECT ${claim(operation, otherInstallation)}->>'status';`), "INTEGRITY_CONFLICT");
  assert.equal(sql(`SELECT disposition FROM ${schema}.operation_receipts WHERE operation_id='${operation}';`), "WAITING_DEPENDENCY");

  // The original payload can resume with a different key order. A lost reply
  // replays the durable result without applying the domain or feed again.
  assert.match(sql(`BEGIN; SELECT ${claim(operation, installation, '{"sale":"one","kind":"SaleCompleted"}')}->>'status';
    ${effect(operation)} SELECT ${accept(operation)}; COMMIT;`), /^PROCEED\n/);
  const replay = JSON.parse(sql(`SELECT ${claim()};`));
  assert.deepEqual(replay, { status: "ALREADY_APPLIED", result: { receipt: operation } });
  assert.equal(sql(`SELECT (SELECT count(*) FROM fixture_effects),
    (SELECT count(*) FROM pos_sync_feed_v1.feed_groups WHERE organization_id='${org}');`), "1|1");

  // Rolling back the domain transaction removes its effect, feed and receipt.
  sql(`BEGIN; SELECT ${claim(rolledBack)}; ${effect(rolledBack)} SELECT ${accept(rolledBack)}; ROLLBACK;`);
  assert.equal(sql(`SELECT (SELECT count(*) FROM fixture_effects),
    (SELECT count(*) FROM pos_sync_feed_v1.feed_groups WHERE organization_id='${org}'),
    (SELECT count(*) FROM ${schema}.operation_receipts WHERE operation_id='${rolledBack}');`), "1|1|0");

  assert.equal(sql(`SELECT ${claim(unrecorded)}->>'status';`), "PROCEED");
  denySql(`SELECT ${accept(unrecorded)};`, /POS_INBOX_V1_CLAIM_REQUIRED/);
  assert.match(sql(`BEGIN; SELECT ${claim(unrecorded)}->>'status';
    SELECT ${record(unrecorded, "REVIEW_REQUIRED", { reason: "fixture" })}; COMMIT;`), /^PROCEED$/);
  assert.deepEqual(JSON.parse(sql(`SELECT ${claim(unrecorded)};`)), { status: "REVIEW_REQUIRED", result: { reason: "fixture" } });

  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.equal(sql(`SELECT has_schema_privilege('${role}', '${schema}', 'USAGE'),
      has_table_privilege('${role}', '${schema}.operation_receipts', 'SELECT'),
      has_function_privilege('${role}', '${schema}.claim_operation(text,uuid,uuid,jsonb)', 'EXECUTE'),
      has_function_privilege('${role}', '${schema}.record_disposition(text,uuid,text,jsonb)', 'EXECUTE');`), "f|f|f|f");
    denySql(`SET ROLE ${role}; SELECT ${claim()};`, /permission denied/);
  }
  console.log("PASS 4 isolated inbox scenarios (dependency retry, lost acknowledgement, atomic rollback, transaction and role guards)");
}
