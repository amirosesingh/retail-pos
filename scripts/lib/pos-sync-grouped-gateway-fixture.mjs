import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

async function applyThroughRelay({ sql, service, baseline, update, branch, terminal, sourceTerminal, personId }) {
  const { build } = await import("esbuild");
  const { postgresWire } = createRequire(import.meta.url)("../test-pos-sync-grouped-sqlserver.cjs");
  const project = "https://owned-project.invalid";
  const sourceBackend = "https://owned-settings-source.invalid";
  const sourceProof = "a".repeat(64);
  const accessToken = "fixture-verified-operator-token";
  const env = {
    POS_GROUPED_FEED_PILOT_PROJECT_URL: project,
    ...(sourceTerminal ? {
      POS_GROUPED_FEED_PILOT_TERMINAL_IDS: `${terminal},${sourceTerminal}`,
      POS_GROUPED_SETTINGS_EDIT_PILOT_ENABLED: "true",
    } : { POS_GROUPED_FEED_PILOT_TERMINAL_ID: terminal }),
    POS_SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
  };
  const bundled = await build({
    absWorkingDir: fileURLToPath(new URL("../../", import.meta.url)),
    entryPoints: ["src/lib/sync-endpoint.server.ts"],
    bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", external: ["node:*"],
    plugins: [{
      name: "disposable-grouped-relay",
      setup(build) {
        build.onResolve({ filter: /external-supabase-config$|commerce-sync-readiness\.server$/ }, args => ({
          path: args.path, namespace: "fixture",
        }));
        build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({
          contents: args.path.endsWith("external-supabase-config")
            ? `export const supabaseConfig=()=>({url:${JSON.stringify(project)},key:"fixture-public"});
               export const runtimeEnvValue=name=>(${JSON.stringify(env)})[name];`
            : "export const commerceSyncIsolationReady=async()=>true;",
        }));
      },
    }],
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`;
  const { handleSyncRequest } = await import(moduleUrl);
  const literal = value => value == null ? "NULL" : "'" + String(value).replaceAll("'", "''") + "'";
  const calls = [];
  const committedResponses = [];
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async (target, options) => {
    const url = new URL(target);
    if (sourceTerminal && url.origin === sourceBackend) {
      assert.equal(url.pathname, "/api/v1/pos/sync");
      const body = JSON.parse(options.body);
      assert.deepEqual(Object.keys(body).sort(), ["accessToken", "deviceBindingProof", "sqlServerSettingsEdit", "terminalToken"]);
      assert.equal(body.terminalToken, sourceTerminal);
      assert.equal(body.accessToken, accessToken);
      const response = await handleSyncRequest(new Request(target, options));
      assert.equal(response.status, 200, await response.clone().text());
      committedResponses.push(await response.clone().json());
      if (committedResponses.length === 1) throw new Error("fixture lost the committed response");
      return response;
    }
    assert.equal(url.origin, project);
    if (sourceTerminal && url.pathname === "/auth/v1/user") {
      assert.equal(new Headers(options?.headers).get("authorization"), `Bearer ${accessToken}`);
      return Response.json({ id: personId, email: "operator@pos-internal.local" });
    }
    assert.equal(new Headers(options?.headers).get("apikey"), env.POS_SUPABASE_SERVICE_ROLE_KEY);
    if (url.pathname === "/rest/v1/terminal_tokens") {
      const id = url.searchParams.get("id")?.slice(3);
      assert([terminal, sourceTerminal].includes(id));
      return Response.json(JSON.parse(sql(`SELECT coalesce(jsonb_agg(t), '[]') FROM public.terminal_tokens AS t WHERE id=${literal(id)};`)));
    }
    if (sourceTerminal && url.pathname === "/rest/v1/app_users") {
      assert.equal(url.searchParams.get("auth_user_id"), "eq." + personId);
      return Response.json(JSON.parse(sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('user_id','operator','full_name','Fixture operator',
        'role','staff','role_slug',NULL,'store_id',store_id,'is_active',is_active,
        'permissions','{"can_access_pos_settings":true}'::jsonb)), '[]')
        FROM public.app_users WHERE auth_user_id=${literal(personId)};`)));
    }
    if (url.pathname === "/rest/v1/stores") {
      assert.equal(url.searchParams.get("id"), "eq." + branch);
      return Response.json(JSON.parse(sql(`SELECT coalesce(jsonb_agg(s), '[]') FROM public.stores AS s WHERE id=${literal(branch)};`)));
    }
    const snapshot = url.pathname === "/rest/v1/rpc/pos_sync_snapshot_grouped_v1";
    const pull = url.pathname === "/rest/v1/rpc/pos_sync_pull_grouped_v1";
    const upload = sourceTerminal && url.pathname === "/rest/v1/rpc/pos_sync_apply_store_settings_edit_v1";
    assert(snapshot || pull || upload, "Unexpected isolated relay upstream request");
    const args = JSON.parse(options.body);
    const base = [args.p_organization_id, args.p_branch_id, args.p_terminal_id, args.p_binding_proof];
    if (upload) {
      calls.push("pos_sync_apply_store_settings_edit_v1");
      assert.equal(args.p_terminal_id, sourceTerminal);
      assert.equal(args.p_person_id, personId);
      const values = [...base, args.p_installation_generation, args.p_database_guid, args.p_epoch, args.p_person_id,
        args.p_operation_id, args.p_expected_version, JSON.stringify(args.p_patch)];
      return Response.json(JSON.parse(sql(`${service} SELECT public.pos_sync_apply_store_settings_edit_v1(${values.map(literal).join(",")});`)));
    }
    const extra = snapshot ? [] : [args.p_epoch, args.p_after_seq, args.p_upper_seq, args.p_limit];
    const rpc = snapshot ? "pos_sync_snapshot_grouped_v1" : "pos_sync_pull_grouped_v1";
    calls.push(rpc);
    return Response.json(JSON.parse(sql(`${service} SELECT public.${rpc}(${[...base, ...extra].map(literal).join(",")});`)));
  };
  try {
    const page = sourceTerminal ? async () => {
      const { uploadSettingsFromLocal } = await import("./pos-sync-settings-edit-roundtrip-fixture.mjs");
      const row = JSON.parse(baseline.manifest_json).changes[0].row_data;
      const { operationId, patch } = await uploadSettingsFromLocal({
        branchId: branch, terminalId: sourceTerminal, personId, feedEpoch: baseline.epoch,
        expectedVersion: Number(row.row_version), deviceBindingProof: sourceProof,
        backend: sourceBackend, project, accessToken, enroll: ({ installationGeneration, databaseGuid }) =>
          sql(`UPDATE pos_sync_feed_v1.settings_edit_enrollments SET installation_generation=${literal(installationGeneration)},
            database_guid=${literal(databaseGuid)} WHERE terminal_id=${literal(sourceTerminal)};`),
      });
      assert.equal(committedResponses[0].status, "APPLIED");
      assert.deepEqual(committedResponses[1], { ...committedResponses[0], status: "ALREADY_APPLIED" });
      const result = update();
      assert.equal(result.groups.length, 1);
      assert.equal(result.groups[0].operation_id, operationId);
      assert.equal(result.groups[0].changes[0].row_data.max_drawer_cash_limit, patch.max_drawer_cash_limit);
      return result;
    } : update;
    await postgresWire({ baseline, page, send: handleSyncRequest, terminalId: terminal,
      ...(sourceTerminal ? { deviceBindingProof: "b".repeat(64) } : {}) });
    assert.deepEqual(calls, ["pos_sync_snapshot_grouped_v1",
      ...(sourceTerminal ? ["pos_sync_apply_store_settings_edit_v1", "pos_sync_apply_store_settings_edit_v1"] : []),
      "pos_sync_pull_grouped_v1"]);
  } finally {
    globalThis.fetch = fetchBefore;
  }
}

export async function verifyGroupedGateway({ sql, denySql, native = false, settingsEdit = false, editGateway = false, editRelay = false,
  mixedGateway = false, pagedRecovery = false }) {
  const read = async path => (await readFile(new URL(path, import.meta.url), "utf8")).replaceAll("\r\n", "\n");
  const schema = await read("../../supabase/schema.sql");
  const table = schema.match(/CREATE TABLE IF NOT EXISTS public\.pos_store_settings \([\s\S]*?\n\);/)?.[0];
  const amendments = schema.match(/ALTER TABLE public\.pos_store_settings\s+ADD COLUMN IF NOT EXISTS [^;]+;/g) ?? [];
  const scope = schema.match(/CREATE OR REPLACE FUNCTION public\.pos_sync_validate_scope\([\s\S]*?END \$fn\$;/)?.[0];
  const save = schema.match(/CREATE OR REPLACE FUNCTION public\.pos_rules_save\([\s\S]*?\nEND \$\$;/)?.[0];
  assert(table && scope && save, "The current canonical settings table, scope and save routines are required");
  const settings = await read("../preparation/pos-sync-store-settings-v1.sql");
  const gateway = await read("../preparation/pos-sync-grouped-gateway-v1.sql");
  const branch = "fixture-settings-a";
  const other = "fixture-settings-b";
  const terminal = randomUUID();
  const receiver = randomUUID();
  const mobile = randomUUID();
  const managementActor = randomUUID();
  const operationsActor = randomUUID();
  const unauthorizedActor = randomUUID();
  const epoch = randomUUID();
  const proof = "a".repeat(64);
  const service = `SET ROLE service_role; SET request.jwt.claims = '{"role":"service_role"}';`;
  const pullCall = (scopeId = branch, terminalId = terminal, binding = proof, after = "0") =>
    `SELECT public.pos_sync_pull_grouped_v1('default','${scopeId}','${terminalId}','${binding}','${epoch}','${after}',NULL,10);`;
  const snapshotCall = (scopeId = branch) => `SELECT public.pos_sync_snapshot_grouped_v1('default','${scopeId}','${terminal}','${proof}');`;
  const saveAs = (actor, store, patch, version) => `SET ROLE authenticated;
    SET request.jwt.claims = '{"role":"authenticated","sub":"${actor}"}';
    SELECT public.pos_rules_save('${store}','${JSON.stringify(patch)}'::jsonb,${version});`;

  sql(`SET client_min_messages = warning;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'
    $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
    $$;
    CREATE TABLE public.stores (id text PRIMARY KEY);
    CREATE TABLE public.terminal_tokens (
      id uuid PRIMARY KEY, location_id text, platform text, status text, revoked_at timestamptz, is_claimed boolean,
      claimed_at timestamptz, claimed_platform text, claim_proof text, claimed_proof_hash text
    );
    ${scope}
    ${table}\n${amendments.join("\n")}
    CREATE FUNCTION public.is_supervisor_now() RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT auth.uid() = '${managementActor}'::uuid
    $$;
    CREATE FUNCTION public.has_perm(text) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT auth.uid() = '${operationsActor}'::uuid AND $1 = 'can_access_pos_settings'
    $$;
    CREATE FUNCTION public.store_visible(text) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT (auth.uid() = '${managementActor}'::uuid AND $1 IN ('${branch}','${other}'))
        OR (auth.uid() = '${operationsActor}'::uuid AND $1 = '${branch}')
    $$;
    CREATE FUNCTION public.pos_rules_defaults() RETURNS jsonb LANGUAGE sql AS $$
      SELECT '{"max_drawer_cash_limit":0,"block_shift_close_on_hold":true}'::jsonb
    $$;
    CREATE FUNCTION public.pos_rules_snapshot(text) RETURNS jsonb LANGUAGE sql AS $$
      SELECT to_jsonb(settings) FROM public.pos_store_settings AS settings WHERE store_id = $1
    $$;
    ${save}
    REVOKE ALL ON FUNCTION public.pos_rules_save(text,jsonb,integer) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.pos_rules_save(text,jsonb,integer) TO authenticated;
    INSERT INTO public.stores VALUES ('${branch}'),('${other}');
    INSERT INTO public.terminal_tokens (id,location_id,platform,status,is_claimed,claimed_platform,claim_proof)
      VALUES ('${terminal}','${branch}','pc','used',true,'electron','${proof}'),
             ('${receiver}','${branch}','pc','used',true,'electron','${"b".repeat(64)}'),
             ('${mobile}','${branch}','mobile','used',true,'android','${proof}');
    INSERT INTO public.pos_store_settings (store_id,max_drawer_cash_limit,block_shift_close_on_hold)
      VALUES ('${branch}',3.01,false),('${other}',4,false);
    BEGIN; ${settings}\n${gateway} COMMIT;
    INSERT INTO pos_sync_feed_v1.feed_heads (organization_id,scope_id,epoch)
      VALUES ('default','${branch}','${epoch}'),('default','${other}','${epoch}');
    INSERT INTO pos_sync_feed_v1.settings_pilots (organization_id, scope_id, epoch)
      VALUES ('default','${branch}','${epoch}'),('default','${other}','${epoch}');`);

  for (const role of ["anon", "authenticated"])
    denySql(`SET ROLE ${role}; ${pullCall()}`, /permission denied/);
  denySql(`SET ROLE service_role; ${pullCall()}`, /POS_GROUPED_GATEWAY_V1_SCOPE_FORBIDDEN/);
  denySql(`${service}${pullCall(other)}`, /SYNC_TERMINAL_SCOPE_FORBIDDEN/);
  denySql(`${service}${pullCall(branch, terminal, "b".repeat(64))}`, /POS_GROUPED_GATEWAY_V1_SCOPE_FORBIDDEN/);
  denySql(`${service}${pullCall(branch, mobile)}`, /POS_GROUPED_GATEWAY_V1_SCOPE_FORBIDDEN/);
  denySql(`${service}SELECT pos_sync_feed_v1.pull_groups('default','${branch}','${epoch}','0');`, /permission denied/);

  const snapshot = JSON.parse(sql(service + snapshotCall()));
  assert.equal(snapshot.status, "OK");
  assert.equal(snapshot.scope_id, branch);
  assert.equal(snapshot.seq, "0");
  assert.equal(snapshot.manifest_sha256, createHash("sha256").update(snapshot.manifest_json).digest("hex"));
  assert.equal(JSON.parse(snapshot.manifest_json).changes[0].row_data.max_drawer_cash_limit, "3.01");
  assert.equal(JSON.parse(sql(service + snapshotCall())).pin_id, snapshot.pin_id);
  const update = () => {
    const managementEdit = saveAs(managementActor, branch, { max_drawer_cash_limit: 5.01 }, 1);
    const managementRow = JSON.parse(sql(managementEdit));
    assert.equal(managementRow.row_version, 2);
    assert.equal(managementRow.updated_by, managementActor);
    denySql(managementEdit, /STALE_RULES/);
    denySql(saveAs(operationsActor, other, { block_shift_close_on_hold: true }, 1), /branch is not visible/);
    denySql(saveAs(unauthorizedActor, branch, { block_shift_close_on_hold: true }, 2), /POS settings permission required/);
    const tillRow = JSON.parse(sql(saveAs(operationsActor, branch, { block_shift_close_on_hold: true }, 2)));
    assert.equal(tillRow.row_version, 3);
    assert.equal(tillRow.updated_by, operationsActor);
    assert.equal(tillRow.max_drawer_cash_limit, 5.01);
    return JSON.parse(sql(service + pullCall()));
  };
  if (native) await applyThroughRelay({ sql, service, baseline: snapshot, update, branch, terminal });
  else update();
  const pull = JSON.parse(sql(service + pullCall()));
  assert.equal(pull.status, "OK");
  assert.equal(pull.next_seq, "2");
  const [managementChange, operationsChange] = pull.groups.map(group => group.changes[0].row_data);
  assert.deepEqual([managementChange.updated_by, operationsChange.updated_by], [managementActor, operationsActor]);
  assert.equal(managementChange.max_drawer_cash_limit, "5.01");
  assert.equal(operationsChange.block_shift_close_on_hold, true);
  assert.equal(sql(`SELECT head_seq FROM pos_sync_feed_v1.feed_heads WHERE scope_id='${other}';`), "0");
  assert.equal(JSON.parse(sql(service + snapshotCall())).seq, "2");

  if (mixedGateway) {
    sql(await read("../preparation/pos-sync-cash-settings-gateway-v1.sql"));
    const mixedPull = after => pullCall(branch, terminal, proof, after).replace("pos_sync_pull_grouped", "pos_sync_pull_cash_settings");
    const mixedSnapshot = snapshotCall().replace("pos_sync_snapshot_grouped", "pos_sync_snapshot_cash_settings");
    const operation = randomUUID(), generation = randomUUID(), database = randomUUID();
    const product = randomUUID(), movement = randomUUID();
    const cashHash = "a".repeat(64);
    const changes = [
      { table_name: "sales", row_data: { store_id: branch, branch_id: branch } },
      { table_name: "sale_items", row_data: { branch_id: branch, product_id: product } },
      { table_name: "payment_transactions", row_data: { store_id: branch, terminal_id: terminal } },
      { table_name: "item_activity_logs", row_data: { id: movement, store_id: branch, terminal_id: terminal,
        product_id: product, quantity_delta: -1 } },
    ];
    const append = `SELECT pos_sync_feed_v1.append_groups('default',
      '${JSON.stringify([{ scope_id: branch, epoch, operation_id: operation, changes }])}'::jsonb);`;
    assert.deepEqual(JSON.parse(sql(service + mixedSnapshot)), { status: "SCOPE_UNAVAILABLE" });
    denySql(`SET ROLE anon; ${mixedSnapshot}`, /permission denied/);
    sql(`SELECT pos_sync_feed_v1.arm_cash_settings_scope('default','${branch}','${epoch}');`);
    assert.deepEqual(JSON.parse(sql(service + snapshotCall())), { status: "SCOPE_UNAVAILABLE" });
    assert.deepEqual(JSON.parse(sql(service + pullCall())), { status: "SCOPE_UNAVAILABLE" });
    denySql(append, /POS_CASH_SETTINGS_V1_PUBLICATION_UNVERIFIED/);
    sql(`BEGIN; ${append}
      SELECT pos_sync_feed_v1.record_cash_publication('default','${branch}','${epoch}',3,'${operation}',
        '${terminal}','${generation}','${database}','${cashHash}');
      COMMIT;`);
    const mixed = JSON.parse(sql(service + mixedPull("0")));
    assert.deepEqual(mixed.groups.map(group => group.seq), ["1", "2", "3"]);
    assert.deepEqual(mixed.groups[2], { seq: "3", operation_id: operation, changes, acceptance: {
      terminal_id: terminal, installation_generation: generation, database_guid: database, checkout_sha256: cashHash,
    } });
    denySql(`UPDATE pos_sync_feed_v1.feed_groups SET changes=(SELECT changes FROM pos_sync_feed_v1.feed_groups
      WHERE scope_id='${branch}' AND seq=2) WHERE scope_id='${branch}' AND seq=3;`, /POS_CASH_SETTINGS_V1_PUBLICATION_UNVERIFIED/);
    sql(`DELETE FROM pos_sync_feed_v1.snapshot_pins WHERE scope_id='${branch}';
      SELECT pos_sync_feed_v1.retire_groups('default','${branch}','${epoch}','3');`);
    assert.deepEqual(JSON.parse(sql(service + mixedPull("0"))), { status: "SNAPSHOT_REQUIRED", reason: "REPLAY_EXPIRED" });
    const recovered = JSON.parse(sql(service + mixedSnapshot));
    const manifest = JSON.parse(recovered.manifest_json);
    assert.equal(manifest.seq, "3");
    assert.equal(manifest.changes[0].row_data.row_version, "3");
    assert.deepEqual(manifest.cash_groups, [mixed.groups[2]]);
    assert.equal(recovered.manifest_sha256, createHash("sha256").update(recovered.manifest_json).digest("hex"));
    denySql(service + mixedSnapshot.replace(`'${proof}'`, `'${"c".repeat(64)}'`), /SCOPE_FORBIDDEN/);
    if (pagedRecovery) {
      sql(`CREATE TABLE public.products (id uuid PRIMARY KEY, owner_store_id text NOT NULL, stock_by_store jsonb NOT NULL,
          row_version integer NOT NULL DEFAULT 1);
        CREATE TABLE public.stock_delta_applied (movement_id uuid PRIMARY KEY,product_id uuid NOT NULL,store_id text NOT NULL,delta integer NOT NULL);
        INSERT INTO public.products VALUES ('${product}','${branch}','{"${branch}":17,"${other}":99}'),
          (gen_random_uuid(),'${other}','{"${other}":91}');
        INSERT INTO public.products (id,owner_store_id,stock_by_store)
          SELECT gen_random_uuid(),'${branch}','{"${branch}":12}' FROM generate_series(1,30);
        INSERT INTO public.stock_delta_applied VALUES ('${movement}','${product}','${branch}',-1);`);
      sql(await read("../preparation/pos-sync-cash-settings-recovery-v1.sql"));
      const appendReceipts = count => sql(`DO $$
        DECLARE op uuid; movement_id uuid; new_changes jsonb; receipt_seq bigint;
        BEGIN FOR i IN 1..${count} LOOP
          op := gen_random_uuid(); movement_id := gen_random_uuid();
          new_changes := jsonb_set('${JSON.stringify(changes)}'::jsonb, '{3,row_data,id}', to_jsonb(movement_id));
          INSERT INTO public.stock_delta_applied VALUES (movement_id,'${product}','${branch}',-1);
          SELECT head_seq+1 INTO receipt_seq FROM pos_sync_feed_v1.feed_heads WHERE scope_id='${branch}';
          PERFORM pos_sync_feed_v1.append_groups('default',jsonb_build_array(jsonb_build_object(
            'scope_id','${branch}','epoch','${epoch}','operation_id',op,'changes',new_changes)));
          PERFORM pos_sync_feed_v1.record_cash_publication('default','${branch}','${epoch}',receipt_seq,op,
            '${terminal}','${generation}','${database}','${cashHash}');
        END LOOP; END $$;`);
      appendReceipts(104);
      const begin = () => `SELECT public.pos_sync_begin_cash_settings_recovery_v1('default','${branch}','${terminal}','${proof}');`;
      const pinned = JSON.parse(sql(service + begin()));
      const pinnedManifest = JSON.parse(pinned.manifest_json);
      assert.equal(pinnedManifest.cash_count, "105");
      assert.equal(pinnedManifest.stock_count, "31");
      assert.equal(pinnedManifest.seq, "107");
      assert.equal(pinned.manifest_sha256, createHash("sha256").update(pinned.manifest_json).digest("hex"));
      assert.equal(JSON.parse(sql(service + begin())).pin_id, pinned.pin_id);
      const pageCall = (kind, after = "0", terminalId = terminal, binding = proof) =>
        `SELECT public.pos_sync_page_cash_settings_recovery_v1('default','${branch}','${terminalId}',
          '${binding}','${pinned.pin_id}','${kind}','${after}',25);`;
      denySql(`SET ROLE authenticated; ${pageCall("cash")}`, /permission denied/);
      assert.deepEqual(JSON.parse(sql(service + pageCall("stock", "0", receiver, "b".repeat(64)))),
        { status: "SNAPSHOT_REQUIRED", reason: "PIN_UNAVAILABLE" });
      assert.deepEqual(JSON.parse(sql(service + pageCall("cash", "106"))), { status: "INVALID_CURSOR" });

      // Writers can proceed between requests. Every page still describes
      // the stock and cash frozen at the original protected sequence.
      sql(`UPDATE public.products SET stock_by_store='{"${branch}":3,"${other}":99}',row_version=row_version+1 WHERE id='${product}';`);
      appendReceipts(1);
      const all = kind => {
        let after = "0";
        const rows = [];
        while (after !== pinnedManifest[kind + "_count"]) {
          const page = JSON.parse(sql(service + pageCall(kind, after)));
          const payload = JSON.parse(page.payload_json);
          assert.equal(page.pin_id, pinned.pin_id);
          assert.equal(page.payload_sha256, createHash("sha256").update(page.payload_json).digest("hex"));
          assert.equal(payload.seq, pinned.seq);
          assert.equal(payload.after, after);
          assert.ok(payload.rows.length <= 25);
          rows.push(...payload.rows);
          after = payload.next;
        }
        return rows;
      };
      const cashRows = all("cash"), stockRows = all("stock");
      assert.equal(cashRows.length, 105);
      assert.equal(cashRows[0].seq, "3");
      assert.equal(cashRows.at(-1).seq, "107");
      assert.equal(stockRows.length, 31);
      assert.deepEqual(stockRows.find(row => row.product_id === product), { product_id: product, branch_balance: 17, row_version: 1 });
      assert.ok(stockRows.every(row => Object.keys(row).length === 3));
      denySql(`BEGIN; UPDATE pos_sync_feed_v1.cash_publications SET acceptance='{}' WHERE scope_id='${branch}' AND seq=3;
        ${service}${pageCall("cash")} COMMIT;`, /POS_CASH_RECOVERY_ARCHIVE_UNVERIFIED/);
      sql(`UPDATE pos_sync_feed_v1.snapshot_pins SET expires_at=clock_timestamp()-interval '1 second' WHERE pin_id='${pinned.pin_id}';`);
      assert.deepEqual(JSON.parse(sql(service + pageCall("stock"))), { status: "SNAPSHOT_REQUIRED", reason: "PIN_UNAVAILABLE" });
      denySql(`BEGIN; DELETE FROM public.stock_delta_applied WHERE movement_id='${movement}'; ${service}${begin()} COMMIT;`,
        /POS_CASH_RECOVERY_STOCK_UNVERIFIED/);
      console.log("PASS complete pinned paged cash archive and branch stock across intervening writes, cross-terminal refusal and expiry");
    }
    console.log("PASS scoped settings and cash gateway with atomic archive and recovery after live-feed retirement");
    return;
  }

  let lastSequence = "2";
  if (settingsEdit || editGateway) {
    const { verifyStoreSettingsEdit } = await import("./pos-sync-store-settings-edit-fixture.mjs");
    lastSequence = await verifyStoreSettingsEdit({
      sql, denySql, branch, other, terminal, mobile, proof, epoch, operationsActor, managementActor, unauthorizedActor,
      editGateway, keepActor: editRelay,
    });
  }
  if (editRelay) {
    const baseline = JSON.parse(sql(service + snapshotCall()));
    assert.equal(baseline.seq, lastSequence);
    await applyThroughRelay({ sql, service, baseline, branch, terminal: receiver, sourceTerminal: terminal, personId: operationsActor,
      update: () => JSON.parse(sql(service + pullCall(branch, terminal, proof, baseline.seq))) });
    lastSequence = (BigInt(baseline.seq) + 1n).toString();
    console.log("PASS two LocalDB tills through actual settings upload and grouped download relay handlers after a lost response");
  }

  // A branch feed can only emit its own complete settings changes.
  sql(`SELECT pos_sync_feed_v1.append_groups('default', jsonb_build_array(jsonb_build_object(
    'scope_id','${branch}','epoch','${epoch}','changes',jsonb_build_array(
      pos_sync_feed_v1.project_store_settings((SELECT row FROM public.pos_store_settings AS row WHERE store_id='${other}'))
    ))));`);
  denySql(`${service}${pullCall(branch, terminal, proof, lastSequence)}`, /POS_GROUPED_GATEWAY_V1_PROJECTION_UNVERIFIED/);
  sql(`UPDATE public.terminal_tokens SET revoked_at=now() WHERE id='${terminal}';`);
  denySql(`${service}${snapshotCall()}`, /SYNC_TERMINAL_SCOPE_FORBIDDEN/);
  console.log("PASS canonical Management and Operations settings saves (branch, permission, stale revision and grouped delivery)");
}
