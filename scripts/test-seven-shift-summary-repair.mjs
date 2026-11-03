// Disposable PGlite only: no env, SQL Server profile or cloud connections.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const repository = fileURLToPath(new URL('../', import.meta.url));
const fixtureSource = readFileSync(new URL('./test-shift-reconciliation-summaries.mjs', import.meta.url),'utf8').replaceAll('\r\n','\n');
const prefix = fixtureSource.slice(0,fixtureSource.indexOf('const db = await fixture();')).replace("new URL('../', import.meta.url)","new URL('./', import.meta.url)");
const self = readFileSync(new URL(import.meta.url),'utf8').replaceAll('\r\n','\n');
const native=process.argv.includes('--native');
if(process.argv.slice(2).some(arg=>arg!=='--native')) throw new Error('Only --native is supported; never pass database URLs');
const nativePrelude=native?readFileSync(new URL('./test-seven-shift-summary-native.fixture.mjs',import.meta.url),'utf8'):'';
const child = spawnSync(process.execPath,['--input-type=module'],{cwd:repository,input:nativePrelude+(native?prefix.replace('const db = new PGlite();','const db = await createNativeFixture();'):prefix)+self.slice(self.indexOf('// CHILD_TEST_BODY\n')+19),encoding:'utf8',timeout:120000,maxBuffer:1024*1024});
process.stdout.write(child.stdout||''); process.stderr.write(child.stderr||'');
if(child.error) throw child.error;
process.exit(child.status??1);
// CHILD_TEST_BODY
const maintenance = await read('scripts/maintenance/repair-seven-shift-parent-summaries.sql');
const incident = JSON.parse(await read('docs/database/shift-summary-repair-evidence.json'));
const capturedTriggers = JSON.parse(await read('docs/database/shift-summary-repair-trigger-metadata.json'))[0].metadata.triggers;
const ids = incident.rows.filter(r=>!r.authority_repair_on_hold).map(r=>r.shift_id);
assert.equal(ids.length,7);
const heldId=incident.rows.find(r=>r.authority_repair_on_hold).shift_id;
const branch='a611a328-2217-4d77-944a-5f6a637d123b';
const db=await fixture();
let sql;
const allSnapshot=async()=> (await rows(db,`SELECT jsonb_build_object('shifts',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM shifts s),'counts',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM shift_cash_counts c),'recons',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM shift_reconciliations r),'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_logs a),'feed',(SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM sync_change_feed f),'stock',(SELECT jsonb_agg(to_jsonb(x)) FROM fixture_stock x),'sales',(SELECT jsonb_agg(to_jsonb(x)) FROM sales x)) AS value`))[0].value;
try {
 await db.exec(`SET timezone='UTC';`);
 await db.exec(`CREATE TABLE audit_logs(id uuid PRIMARY KEY,user_name text,action_category text NOT NULL,action_name text NOT NULL,target_module text,details jsonb,created_at timestamptz DEFAULT now(),user_id text,action text,entity text,before_state jsonb,after_state jsonb,store_id text);
 CREATE TABLE sync_change_feed(id bigint GENERATED ALWAYS AS IDENTITY,organization_id text,branch_id text,terminal_id text,table_name text,entity_id text,operation text,row_version bigint,tombstone boolean);
 CREATE TABLE held_orders(store_id text,shift_id text,status text);`);
 for(const table of ['shift_cash_counts','shift_reconciliations','shift_close_events','shift_notifications','shift_variance_alerts']){
  const foreign=await rows(db,`SELECT conname FROM pg_constraint WHERE conrelid='${table}'::regclass AND confrelid='shifts'::regclass`);
  for(const fk of foreign)await db.exec(`ALTER TABLE ${table} DROP CONSTRAINT ${fk.conname};`);
  await db.exec(`ALTER TABLE ${table} ADD CONSTRAINT fixture_${table}_parent FOREIGN KEY(shift_id) REFERENCES shifts(id) ON DELETE CASCADE NOT DEFERRABLE;`);
 }
 // Seed all eight with the real old writer. Incident identifiers only; amounts
 // are deliberately synthetic and never copied from private business records.
 await db.exec(`SELECT set_config('fixture.branch','${branch}',false);`);
 for(const id of [...ids,heldId]) {
  await db.exec(`INSERT INTO shifts(id,store_id) VALUES('${id}','${branch}'); INSERT INTO fixture_expected VALUES('${id}',100,20,5);`);
  await asCashier(db,()=>db.query(`SELECT public.shift_cash_count_submit('${id}',103,NULL,NULL,'fixture-${id}','fixture-terminal')`),'can_close_shift,can_shift_cash_recount',branch);
 }
 for(const t of capturedTriggers) {
  await db.exec(`CREATE OR REPLACE FUNCTION public.${t.function} RETURNS trigger LANGUAGE plpgsql AS $captured$${t.source}$captured$; ${t.definition};`);
 }
 const actualTriggers=await rows(db,`SELECT t.tgname AS name,c.relname AS "table",pg_get_triggerdef(t.oid) AS definition,md5(p.prosrc) AS body_md5 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid WHERE c.relname IN('shifts','audit_logs') AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`);
 const fixtureEvidence=[];
 for(const id of ids) {
  const item=(await rows(db,`SELECT s.id AS shift_id,s.store_id,s.row_version,md5(to_jsonb(s)::text) AS parent_fingerprint,md5(pos_sync_private.shift_graph(s.id)::text) AS entire_graph_fingerprint,r.id AS reconciliation_id,r.count_id,md5(to_jsonb(r)::text) AS reconciliation_fingerprint,md5(jsonb_build_array(to_jsonb(c))::text) AS counts_fingerprint,false AS authority_repair_on_hold FROM shifts s JOIN shift_reconciliations r ON r.shift_id=s.id JOIN shift_cash_counts c ON c.id=r.count_id WHERE s.id='${id}'`))[0];
  fixtureEvidence.push(item);
 }
 sql=maintenance.replace(/\$evidence\$[\s\S]*?\$evidence\$/,`$evidence$${JSON.stringify(fixtureEvidence)}$evidence$`).replace(/\$triggers\$[\s\S]*?\$triggers\$/,`$triggers$${JSON.stringify(actualTriggers)}$triggers$`);
 // Preserve guard/body identity; only disposable database name differs.
 sql=sql.replace("current_database()<>'postgres'",`current_database()<>current_database()`);
 const before=await allSnapshot();
 await db.exec(sql);
 const after=await allSnapshot();
 check(after.audit.length,7); check(after.feed.length,14);
 check(after.feed.filter(f=>f.table_name==='shifts').length,7);
 check(after.feed.filter(f=>f.table_name==='audit_logs').length,7);
 check(after.counts,before.counts);check(after.recons,before.recons);check(after.stock,before.stock);check(after.sales,before.sales);
 check(after.shifts.find(s=>s.id===heldId),before.shifts.find(s=>s.id===heldId));
 for(const id of ids) { await db.query(`SELECT pos_sync_private.validate_graph(pos_sync_private.shift_graph('${id}'),'${branch}','${id}',true)`);passed++; }
 await assert.rejects(db.query(`SELECT pos_sync_private.validate_graph(pos_sync_private.shift_graph('${heldId}'),'${branch}','${heldId}',true)`),/SYNC_SHIFT_GRAPH_CONFLICT/);passed++;
 check((await rows(db,`SELECT current_setting('pos.shift_fn',true) AS value`))[0].value,'');
 await db.exec(sql);check(await allSnapshot(),after);
 // Undo only synthetic test state between adversarial cases. No real database.
 const reset=async()=>{
  await db.exec(`TRUNCATE audit_logs,sync_change_feed; SELECT set_config('pos.shift_fn','on',false);`);
  for(const s of before.shifts.filter(s=>s.id!==heldId)) await db.exec(`UPDATE shifts SET expected_cash=NULL,expected_card=NULL,expected_digital=NULL,variance_cash=NULL,variance_total=NULL WHERE id='${s.id}';`);
  // Restore fixture timestamps/versions with triggers temporarily removed only
  // in this disposable harness; production artifact never disables triggers.
  for(const t of capturedTriggers.filter(t=>t.table==='shifts')) await db.exec(`ALTER TABLE shifts DISABLE TRIGGER ${t.name};`);
  for(const s of before.shifts) await db.query(`UPDATE shifts SET row_version=$1,updated_at=$2 WHERE id=$3`,[s.row_version,s.updated_at,s.id]);
  for(const t of capturedTriggers.filter(t=>t.table==='shifts')) await db.exec(`ALTER TABLE shifts ENABLE TRIGGER ${t.name};`);
  await db.exec(`TRUNCATE sync_change_feed; SELECT set_config('pos.shift_fn','',false);`);
 };
 await reset();
 const rejectsUnchanged=async(candidate,pattern)=>{const prior=await allSnapshot();await assert.rejects(db.exec(candidate),pattern);passed++;check(await allSnapshot(),prior);};
 await rejectsUnchanged(sql.replace(fixtureEvidence[0].parent_fingerprint,'00000000000000000000000000000000'),/before-image/);
 await rejectsUnchanged(sql.replace(fixtureEvidence[0].reconciliation_fingerprint,'00000000000000000000000000000000'),/reconciliation changed/);
 await rejectsUnchanged(sql.replace(fixtureEvidence[0].entire_graph_fingerprint,'00000000000000000000000000000000'),/before-image/);
 await rejectsUnchanged(sql.replace(ids[0],heldId),/invalid exact repair scope/);
 await rejectsUnchanged(sql.replace(actualTriggers[0].body_md5,'00000000000000000000000000000000'),/trigger definition/);
 await db.exec(`CREATE FUNCTION fixture_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'fixture audit failure'; END$$; CREATE TRIGGER fixture_audit_fail BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fixture_audit_fail();`);
 await rejectsUnchanged(sql,/trigger set changed/);
 // Include an injected existing trigger in disposable expected metadata so
 // audit failure itself (not metadata detection) proves whole-batch rollback.
 const failTrigger=(await rows(db,`SELECT t.tgname AS name,'audit_logs' AS "table",pg_get_triggerdef(t.oid) AS definition,md5(p.prosrc) AS body_md5 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgname='fixture_audit_fail'`))[0];
 const failSql=sql.replace(/\$triggers\$[\s\S]*?\$triggers\$/,`$triggers$${JSON.stringify([...actualTriggers,failTrigger])}$triggers$`);
 await rejectsUnchanged(failSql,/fixture audit failure/);
 await db.exec(`DROP TRIGGER fixture_audit_fail ON audit_logs; DROP FUNCTION fixture_audit_fail();`);
 // A late graph failure must roll back earlier successfully repaired rows.
 const late=ids.toSorted().at(-1);
 const lateSql=sql.replace(`PERFORM pos_sync_private.validate_graph(after_graph,branch,parent.id,true);`,`IF parent.id='${late}'::uuid THEN RAISE EXCEPTION 'fixture late graph failure'; END IF; PERFORM pos_sync_private.validate_graph(after_graph,branch,parent.id,true);`);
 await rejectsUnchanged(lateSql,/fixture late graph failure/);
 // Existing receipts must be all-or-none and replay must detect tampering.
 await db.exec(`INSERT INTO audit_logs(id,action_category,action_name) VALUES(md5('SHIFT49-seven-null-parent-summaries-20261103:${ids[0]}')::uuid,'fixture','partial');`);
 await rejectsUnchanged(sql,/partial audit receipt set/);
 await db.exec(`TRUNCATE audit_logs,sync_change_feed;`);
 // A trigger that silently suppresses the parent UPDATE cannot count as success.
 await db.exec(`CREATE FUNCTION fixture_suppress() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NULL; END$$; CREATE TRIGGER fixture_suppress BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION fixture_suppress();`);
 const suppressedTrigger=(await rows(db,`SELECT t.tgname AS name,'shifts' AS "table",pg_get_triggerdef(t.oid) AS definition,md5(p.prosrc) AS body_md5 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgname='fixture_suppress'`))[0];
 await rejectsUnchanged(sql.replace(/\$triggers\$[\s\S]*?\$triggers\$/,`$triggers$${JSON.stringify([...actualTriggers,suppressedTrigger])}$triggers$`),/update not acknowledged/);
 await db.exec(`DROP TRIGGER fixture_suppress ON shifts; DROP FUNCTION fixture_suppress();`);
 await db.exec(sql);check((await allSnapshot()).audit.length,7);
 // A forged complete receipt set must not bless a valid but different graph.
 const accepted=await allSnapshot();
 const changedId=ids[0];
 await db.exec(`UPDATE shift_cash_counts SET counted_cash=counted_cash+1 WHERE shift_id='${changedId}'; UPDATE shift_reconciliations SET counted_cash=counted_cash+1,variance_cash=variance_cash+1,variance_total=variance_total+1 WHERE shift_id='${changedId}'; SELECT set_config('pos.shift_fn','on',false); UPDATE shifts SET counted_cash=counted_cash+1,final_counted_cash=final_counted_cash+1,variance_cash=variance_cash+1,variance_total=variance_total+1 WHERE id='${changedId}'; SELECT set_config('pos.shift_fn','',false); UPDATE audit_logs SET after_state=(SELECT to_jsonb(s) FROM shifts s WHERE id='${changedId}'),details=jsonb_set(details,'{after_graph_fingerprint}',to_jsonb(md5(pos_sync_private.shift_graph('${changedId}')::text))) WHERE id=md5('SHIFT49-seven-null-parent-summaries-20261103:${changedId}')::uuid;`);
 await db.query(`SELECT pos_sync_private.validate_graph(pos_sync_private.shift_graph('${changedId}'),'${branch}','${changedId}',true)`);passed++;
 await rejectsUnchanged(sql,/replay facts changed/);
 check(accepted.audit.length,7);
 if(db.testContention){await db.testContention(sql,ids[1]);passed++;}
 await db.exec(`UPDATE audit_logs SET details=details||'{"after_graph_fingerprint":"tampered"}'::jsonb WHERE id=md5('SHIFT49-seven-null-parent-summaries-20261103:${ids[0]}')::uuid;`);
 await rejectsUnchanged(sql,/replay facts changed/);
 console.log(`PASS ${passed} isolated seven-shift repair scenarios; real captured triggers, rollback, replay and held exclusion`);
} finally { await db.close(); }
