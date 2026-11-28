import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

export async function verifyStoreSettingsEdit({
  sql, denySql, branch, other, terminal, mobile, proof, epoch, operationsActor, managementActor, unauthorizedActor,
  editGateway = false, keepActor = false,
}) {
  const inbox = await readFile(new URL("../preparation/pos-sync-inbox-v1.sql", import.meta.url), "utf8");
  const writer = await readFile(new URL("../preparation/pos-sync-store-settings-edit-v1.sql", import.meta.url), "utf8");
  const generation = randomUUID();
  const database = randomUUID();
  const operation = randomUUID();
  const staleOperation = randomUUID();
  const rejectedOperation = randomUUID();
  const machine = randomUUID();
  sql(`BEGIN;
    CREATE TABLE public.app_users (auth_user_id uuid PRIMARY KEY, is_active boolean NOT NULL, email text NOT NULL, store_id text);
    INSERT INTO public.app_users VALUES
      ('${operationsActor}',true,'operator@pos-internal.local','${branch}'),
      ('${managementActor}',true,'manager@pos-internal.local',NULL),
      ('${unauthorizedActor}',true,'unauthorized@pos-internal.local','${branch}'),
      ('${machine}',true,'terminal.${terminal}@pos.local','${branch}');
    ${inbox}
    ${writer}
    INSERT INTO pos_sync_feed_v1.settings_edit_enrollments VALUES ('default','${terminal}','${branch}','${generation}','${database}');
    COMMIT;`);

  const patch = { max_drawer_cash_limit: 7.125, block_shift_close_on_hold: false };
  const literal = value => `'${value.replaceAll("'", "''")}'`;
  const call = ({ actor = operationsActor, person = actor, terminalId = terminal, binding = proof,
    scope = branch, source = generation, db = database, selectedEpoch = epoch, id = operation, version = 3, fields = patch } = {}) =>
    `SET request.jwt.claims = '${JSON.stringify({ role: "authenticated", sub: actor })}';
     SELECT pos_sync_feed_v1.apply_store_settings_edit(${[
       "default", scope, terminalId, binding, source, db, selectedEpoch, person, id,
     ].map(literal).join(",")},${version},${literal(JSON.stringify(fields))}::jsonb);`;
  const apply = input => JSON.parse(sql(call(input)));
  const state = () => sql(`SELECT settings.row_version, settings.max_drawer_cash_limit, settings.block_shift_close_on_hold,
    head.head_seq FROM public.pos_store_settings settings JOIN pos_sync_feed_v1.feed_heads head ON head.scope_id=settings.store_id
    WHERE head.organization_id='default' AND settings.store_id='${branch}';`);

  const saved = apply();
  assert.deepEqual(saved, { status: "APPLIED", result: {
    scope_id: branch, terminal_id: terminal, person_id: operationsActor, epoch, operation_id: operation,
    installation_generation: generation, database_guid: database, expected_version: 3, row_version: 4, seq: "3",
  } });
  const applied = state();
  assert.equal(applied, "4|7.125|f|3");
  assert.equal(sql(`SELECT operation_id FROM pos_sync_feed_v1.feed_groups WHERE scope_id='${branch}' AND seq=3;`), operation);
  assert.deepEqual(apply(), { ...saved, status: "ALREADY_APPLIED" });
  assert.deepEqual(apply({ fields: { max_drawer_cash_limit: 8 } }), { status: "INTEGRITY_CONFLICT" });
  assert.deepEqual(apply({ actor: managementActor }), { status: "INTEGRITY_CONFLICT" });
  const stale = apply({ id: staleOperation });
  assert.equal(stale.status, "REVIEW_REQUIRED");
  assert.equal(stale.result.code, "STALE_RULES");
  assert.deepEqual(apply({ id: staleOperation }), stale);
  assert.equal(state(), applied);

  for (const role of ["anon", "authenticated", "service_role"])
    denySql(`SET ROLE ${role}; ${call()}`, /permission denied/);
  denySql(call({ id: rejectedOperation, person: managementActor }), /POS_SETTINGS_EDIT_V1_SCOPE_FORBIDDEN/);
  denySql(call({ id: rejectedOperation, terminalId: mobile }), /POS_SETTINGS_EDIT_V1_SCOPE_FORBIDDEN/);
  denySql(call({ id: rejectedOperation, binding: "b".repeat(64) }), /POS_SETTINGS_EDIT_V1_SCOPE_FORBIDDEN/);
  denySql(call({ id: rejectedOperation, scope: other }), /SYNC_TERMINAL_SCOPE_FORBIDDEN/);
  denySql(call({ id: rejectedOperation, source: randomUUID() }), /POS_SETTINGS_EDIT_V1_INSTALLATION_FORBIDDEN/);
  denySql(call({ id: rejectedOperation, db: randomUUID() }), /POS_SETTINGS_EDIT_V1_INSTALLATION_FORBIDDEN/);
  denySql(call({ id: rejectedOperation, selectedEpoch: randomUUID() }), /POS_SETTINGS_EDIT_V1_SCOPE_FORBIDDEN/);
  denySql(call({ id: rejectedOperation, actor: unauthorizedActor }), /POS_SETTINGS_EDIT_V1_PERSON_FORBIDDEN/);
  denySql(call({ id: rejectedOperation, actor: machine }), /POS_SETTINGS_EDIT_V1_PERSON_FORBIDDEN/);
  sql(`UPDATE public.app_users SET store_id='${other}' WHERE auth_user_id='${managementActor}';`);
  denySql(call({ id: rejectedOperation, actor: managementActor }), /POS_SETTINGS_EDIT_V1_PERSON_FORBIDDEN/);
  denySql(call({ id: rejectedOperation, fields: { require_counted_cash_on_close: false } }), /POS_SETTINGS_EDIT_V1_INVALID_PATCH/);
  denySql(call({ id: rejectedOperation, fields: { max_drawer_cash_limit: true } }), /POS_SETTINGS_EDIT_V1_INVALID_PATCH/);

  sql("ALTER TABLE public.pos_store_settings DISABLE TRIGGER pos_sync_v1_store_settings_pilot;");
  denySql(call({ id: rejectedOperation, version: 4 }), /POS_SETTINGS_EDIT_V1_PUBLICATION_UNVERIFIED/);
  sql("ALTER TABLE public.pos_store_settings ENABLE TRIGGER pos_sync_v1_store_settings_pilot;");
  denySql(`BEGIN; ${call({ id: rejectedOperation, version: 4, fields: { max_drawer_cash_limit: 9 } })}
    SELECT public.pos_rules_save('${branch}', '{"max_drawer_cash_limit":10}', 5); COMMIT;`, /POS_SETTINGS_V1_PUBLICATION_MISSING/);
  assert.equal(state(), applied);
  assert.equal(sql(`SELECT count(*) FROM pos_sync_inbox_v1.operation_receipts WHERE operation_id='${rejectedOperation}';`), "0");
  const lastSequence = editGateway ? await verifyGateway({
    sql, denySql, branch, terminal, proof, epoch, generation, database, operationsActor, unauthorizedActor, state, literal,
  }) : saved.result.seq;
  sql(`UPDATE public.app_users SET is_active=false WHERE auth_user_id='${operationsActor}';`);
  denySql(call(), /POS_SETTINGS_EDIT_V1_PERSON_FORBIDDEN/);
  if (keepActor) sql(`UPDATE public.app_users SET is_active=true WHERE auth_user_id='${operationsActor}';`);
  console.log("PASS prepared settings edit (canonical apply/replay, stale review, authorization, projection and atomic rollback)");
  return lastSequence;
}

async function verifyGateway({
  sql, denySql, branch, terminal, proof, epoch, generation, database, operationsActor, unauthorizedActor, state, literal,
}) {
  const gateway = await readFile(new URL("../preparation/pos-sync-store-settings-edit-gateway-v1.sql", import.meta.url), "utf8");
  sql(`BEGIN;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
        nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role');
    $$;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
        nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
    $$;
    GRANT USAGE ON SCHEMA auth TO service_role;
    ${gateway}
    COMMIT;`);

  const operation = randomUUID();
  const serviceSubject = randomUUID();
  const serviceClaims = JSON.stringify({ role: "service_role", sub: serviceSubject, fixture: "modern" });
  const legacyClaim = JSON.stringify({ role: "service_role", sub: serviceSubject, fixture: "legacy" });
  const service = `SET ROLE service_role;
    SET request.jwt.claims = '${serviceClaims}'; SET request.jwt.claim = '${legacyClaim}';
    SET request.jwt.claim.sub = '${serviceSubject}'; SET request.jwt.claim.role = 'service_role';`;
  const decimal = "9007199254740993.125000000001";
  const call = ({ id = operation, person = operationsActor, fields = { max_drawer_cash_limit: decimal },
    source = generation } = {}) => `public.pos_sync_apply_store_settings_edit_v1(${[
    "default", branch, terminal, proof, source, database, epoch, person, id,
  ].map(literal).join(",")},4,${literal(JSON.stringify(fields))}::jsonb)`;
  const claims = `SELECT jsonb_build_object('role', auth.role(), 'sub', auth.uid(),
    'claims', current_setting('request.jwt.claims'), 'legacy', current_setting('request.jwt.claim'),
    'legacy_sub', current_setting('request.jwt.claim.sub'), 'legacy_role', current_setting('request.jwt.claim.role'));`;
  const initial = { role: "service_role", sub: serviceSubject, claims: serviceClaims, legacy: legacyClaim,
    legacy_sub: serviceSubject, legacy_role: "service_role" };
  const [saved, claimsAfterSuccess] = sql(`${service} BEGIN; SELECT ${call()}; ${claims} COMMIT;`).split("\n").map(JSON.parse);
  assert.equal(saved.status, "APPLIED");
  assert.equal(saved.result.person_id, operationsActor);
  assert.equal(saved.result.operation_id, operation);
  assert.equal(saved.result.row_version, 5);
  assert.equal(saved.result.seq, "4");
  assert.deepEqual(claimsAfterSuccess, initial);
  assert.equal(state(), `5|${decimal}|f|4`);
  assert.deepEqual(JSON.parse(sql(`${service} SELECT ${call()};`)), { ...saved, status: "ALREADY_APPLIED" });

  for (const role of ["anon", "authenticated"])
    denySql(`SET ROLE ${role}; SELECT ${call()};`, /permission denied/);
  denySql(`SET ROLE service_role; SET request.jwt.claims = '{"role":"authenticated"}'; SELECT ${call()};`, /POS_SETTINGS_EDIT_GATEWAY_V1_FORBIDDEN/);
  denySql(`${service} SELECT ${call({ fields: { max_drawer_cash_limit: 10 } })};`, /POS_SETTINGS_EDIT_GATEWAY_V1_INVALID_PATCH/);
  denySql(`${service} SELECT ${call({ fields: { max_drawer_cash_limit: "0.0000000000001" } })};`, /POS_SETTINGS_EDIT_GATEWAY_V1_INVALID_PATCH/);
  denySql(`${service} SELECT ${call({ id: randomUUID(), person: unauthorizedActor })};`, /POS_SETTINGS_EDIT_V1_PERSON_FORBIDDEN/);
  const claimsAfterDenial = JSON.parse(sql(`${service} BEGIN;
    DO $$ BEGIN
      BEGIN
        PERFORM ${call({ id: randomUUID(), source: randomUUID() })};
        RAISE EXCEPTION 'The invalid installation unexpectedly applied';
      EXCEPTION WHEN insufficient_privilege THEN
        IF SQLERRM <> 'POS_SETTINGS_EDIT_V1_INSTALLATION_FORBIDDEN' THEN RAISE; END IF;
      END;
    END $$;
    ${claims} COMMIT;`));
  assert.deepEqual(claimsAfterDenial, initial);
  assert.equal(state(), `5|${decimal}|f|4`);
  console.log("PASS prepared settings edit gateway (service-only, exact decimal, person attribution, replay and claims restoration)");
  return saved.result.seq;
}
