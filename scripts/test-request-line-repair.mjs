// Isolated PostgreSQL only: no connection profiles, network or live mutations.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {fixtureSql,migration,seedSql,ids,quote,sourceFunction,liveOverlaySql,webIdentity} from './fixtures/transfer-dispatch-fixture.mjs';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const repair=await read('scripts/maintenance/restore-sr-bet2-20261031-request-line.sql');
const guard=await read('supabase/migrations/20261031080149_prevent_transfer_line_reparenting.sql');
const schema=await read('supabase/schema.sql');
const deltaStart=schema.indexOf('CREATE TABLE IF NOT EXISTS public.stock_delta_applied (');
const deltaSql=schema.slice(deltaStart,schema.indexOf(';',deltaStart)+1);
const requestRef='SR-BET2-WEB01-20261031-0001',childRef='ST-STR1-WEB01-20261031-0001';
let passed=0;
const live=process.argv.indexOf('--live-definitions');
async function create(){
 const db=new PGlite();
 await db.exec(fixtureSql);
 if(live>=0)await db.exec((await liveOverlaySql(process.argv[live+1],process.argv[live+2])).sql);
 await db.exec(deltaSql+' ALTER TABLE public.stock_delta_applied ADD PRIMARY KEY(movement_id);');
 await db.exec(sourceFunction('public.change_history_immutable')+` CREATE TRIGGER change_history_no_change BEFORE UPDATE OR DELETE ON public.change_history FOR EACH ROW EXECUTE FUNCTION public.change_history_immutable();`);
 await db.exec(migration);await db.exec(guard);
 await db.exec(seedSql({stock:0,quantity:1,approved:1,childQuantity:1}));
 await db.exec(`SET session_replication_role=replica;
 DELETE FROM stock_transfer_items WHERE transfer_id='${ids.parent}';
 UPDATE stores SET code=CASE id WHEN 'A' THEN 'STR1' WHEN 'B' THEN 'BET2' ELSE code END,group_id=CASE WHEN id IN('A','B') THEN '361-degree-sports' ELSE group_id END;
 UPDATE stock_transfers SET ref=CASE id WHEN '${ids.parent}' THEN ${quote(requestRef)} ELSE ${quote(childRef)} END,
  transfer_scope='INTRA_GROUP',approved_by='Original approver',
  approved_at=CASE id WHEN '${ids.parent}' THEN '2026-10-31T03:36:02.185748Z'::timestamptz ELSE '2026-10-31T03:36:01.064Z'::timestamptz END,
  created_at=CASE id WHEN '${ids.parent}' THEN '2026-10-31T03:34:55.852Z'::timestamptz ELSE '2026-10-31T03:36:01.064Z'::timestamptz END,
  row_version=CASE id WHEN '${ids.parent}' THEN 2 ELSE 1 END;
 UPDATE stock_transfer_items SET sku='SKU-000000178020',barcode='6927050888645',
  product_name='W572511105-3-8 M''s Signature Basketbal Shoes',unit_cost=49,quantity_approved=NULL,
  created_at='2026-10-31T03:34:58.557726Z',row_version=3;
 UPDATE products SET sku='SKU-000000178020',barcode='6927050888645',cost_price=49,selling_price=69.50,
  stock_by_store='{"A":0,"B":7,"C":13}',stock_quantity=20 WHERE id='${ids.product}';
 INSERT INTO stock_delta_applied(movement_id,product_id,store_id,delta) VALUES(gen_random_uuid(),'${ids.product}','B',7);
 SET session_replication_role=origin;
 SELECT set_config('test.uid','',false),set_config('test.role','',false),set_config('test.email','',false);`);
 return db;
}
const tables=['stock_transfers','stock_transfer_items','products','change_history','item_activity_logs','stock_delta_applied','entity_status_history','sync_change_feed','private.transfer_dispatch_receipts'];
async function snapshot(db){
 const result={};for(const table of tables)result[table]=(await db.query(`SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]'::jsonb) value FROM ${table} x`)).rows[0].value;return result;
}
async function caseTest(name,work){const db=await create();try{await work(db);passed++;console.log('PASS '+name);}finally{await db.close();}}
async function rejectUnchanged(db,pattern=/TRF16/){const before=await snapshot(db);await assert.rejects(()=>db.exec(repair),pattern);await db.exec('ROLLBACK;');assert.deepEqual(await snapshot(db),before);}
const setup=(db,sql)=>db.exec('SET session_replication_role=replica;'+sql+';SET session_replication_role=origin;');
try{
 await caseTest('one new parent line and genuine append-only maintenance audit; all business data unchanged',async db=>{
  const before=await snapshot(db);await db.exec(repair);const after=await snapshot(db);
  const lines=after.stock_transfer_items;assert.equal(lines.length,2);
  const parent=lines.find(row=>row.transfer_id===ids.parent),child=lines.find(row=>row.transfer_id===ids.child);
  assert.notEqual(parent.id,child.id);assert.equal(parent.quantity,1);assert.equal(parent.quantity_approved,1);
  assert.equal(parent.unit_cost,49);assert.equal(parent.quantity_dispatched,null);assert.equal(parent.quantity_received,0);
  assert.deepEqual(child,before.stock_transfer_items[0]);assert.deepEqual(after.products,before.products);assert.deepEqual(after.stock_transfers,before.stock_transfers);
  for(const table of ['item_activity_logs','stock_delta_applied','private.transfer_dispatch_receipts'])assert.deepEqual(after[table],before[table]);
  const audit=after.change_history.filter(row=>row.source_application==='maintenance');assert.equal(audit.length,1);
  assert.equal(audit[0].changed_by,'postgres');assert.equal(audit[0].entity_id,parent.id);assert.equal(audit[0].revision,parent.row_version);
  assert.equal(audit[0].old_value,null);assert.equal(audit[0].new_value._maintenance.owner_confirmed_requested_quantity,1);
  assert.equal(audit[0].id,(await db.query("SELECT md5('TRF16:SR-BET2-WEB01-20261031-0001:restore-request-line:v1')::uuid id")).rows[0].id);
  assert.deepEqual(audit[0].new_value._maintenance.original_child_line,child);
  const feed=after.sync_change_feed.filter(row=>!before.sync_change_feed.some(old=>old.id===row.id));
  assert.equal(feed.length,2);assert.deepEqual(feed.map(row=>row.branch_id).sort(),['A','B']);
  assert(feed.every(row=>row.table_name==='stock_transfer_items'&&row.operation==='insert'&&JSON.parse(row.entity_id).id===parent.id));
  await assert.rejects(()=>db.exec(`UPDATE change_history SET changed_by='forged' WHERE id='${audit[0].id}'`),/append-only/);
  await assert.rejects(()=>db.exec(`DELETE FROM change_history WHERE id='${audit[0].id}'`),/append-only/);
 });
 await caseTest('same-facts retry is a complete no-op',async db=>{await db.exec(repair);const before=await snapshot(db);await db.exec(repair);assert.deepEqual(await snapshot(db),before);});
 await caseTest('same-facts retry from another session time zone preserves timestamp identity',async db=>{
  await db.exec("SET TIME ZONE 'UTC';");await db.exec(repair);await db.exec("SET TIME ZONE 'Asia/Brunei';");
  const before=await snapshot(db);await db.exec(repair);assert.deepEqual(await snapshot(db),before);
 });
 await caseTest('timeout settings are local to success and failed/cleaned-up transactions',async db=>{
  const settings=async()=> (await db.query("SELECT current_setting('statement_timeout') statement,current_setting('lock_timeout') lock")).rows[0];
  const before=await settings();await db.exec(repair);assert.deepEqual(await settings(),before);
  await setup(db,`UPDATE stock_transfers SET status='cancelled' WHERE id='${ids.child}'`);
  await rejectUnchanged(db);assert.deepEqual(await settings(),before);
 });
 await caseTest('synthetic UUIDs prove lookup uses refs and branch codes, not generated incident IDs',async db=>{assert.notEqual(ids.parent,'ffc1465d-eb97-42d5-98ae-b937fb90b708');await db.exec(repair);assert.equal((await db.query(`SELECT count(*)::int n FROM stock_transfer_items WHERE transfer_id='${ids.parent}'`)).rows[0].n,1);});
 const mutations=[
  ['foreign branch',`UPDATE stock_transfers SET from_store_id='C' WHERE id='${ids.child}'`],
  ['foreign cluster',`UPDATE stores SET group_id='other' WHERE id='B'`],
  ['ambiguous branch code',`UPDATE stores SET code='STR1' WHERE id='C'`],
  ['changed child quantity',`UPDATE stock_transfer_items SET quantity=2 WHERE transfer_id='${ids.child}'`],
  ['changed child approval',`UPDATE stock_transfer_items SET quantity_approved=1 WHERE transfer_id='${ids.child}'`],
  ['changed snapshot',`UPDATE stock_transfer_items SET unit_cost=48 WHERE transfer_id='${ids.child}'`],
  ['changed SKU',`UPDATE stock_transfer_items SET sku='other' WHERE transfer_id='${ids.child}'`],
  ['changed barcode',`UPDATE stock_transfer_items SET barcode='other' WHERE transfer_id='${ids.child}'`],
  ['changed approved header',`UPDATE stock_transfers SET approved_at=now() WHERE id='${ids.parent}'`],
  ['wrong kind',`UPDATE stock_transfers SET kind='transfer' WHERE id='${ids.parent}'`],
  ['already dispatched header',`UPDATE stock_transfers SET dispatched_at=now() WHERE id='${ids.child}'`],
  ['already dispatched item',`UPDATE stock_transfer_items SET quantity_dispatched=1 WHERE transfer_id='${ids.child}'`],
  ['already received item',`UPDATE stock_transfer_items SET quantity_dispatched=1,quantity_received=1 WHERE transfer_id='${ids.child}'`],
  ['unexpected second child',`INSERT INTO stock_transfers(id,ref,kind,status,from_store_id,to_store_id,source_request_id) VALUES('${ids.child2}','OTHER','transfer','approved','A','B','${ids.parent}')`],
  ['unexpected second child line',`INSERT INTO stock_transfer_items(transfer_id,product_id,quantity) VALUES('${ids.child}','${ids.product2}',1)`],
  ['existing unaudited parent line',`INSERT INTO stock_transfer_items(transfer_id,product_id,quantity,quantity_approved) VALUES('${ids.parent}','${ids.product}',1,1)`],
  ['existing duplicate ref',`INSERT INTO stock_transfers(ref,kind,status,from_store_id,to_store_id) VALUES(${quote(requestRef)},'request','approved','A','B')`],
  ['existing movement evidence',`INSERT INTO item_activity_logs(product_id,activity_type,reference,quantity_delta) VALUES('${ids.product}','transfer_out',${quote(childRef)},-1)`],
  ['existing immutable dispatch receipt',`INSERT INTO private.transfer_dispatch_receipts(transfer_id,intent,actor_id,actor_name,dispatched_at) VALUES('${ids.child}','{}','${ids.actor}','Fixture',now())`],
 ];
 for(const [name,sql] of mutations)await caseTest(name+' refuses without changing any rows',async db=>{await setup(db,sql);await rejectUnchanged(db,/TRF16|query returned no rows/);});
 // The deployed nullable/default shape can differ from a baseline export. Even
 // if a future schema permits NULL, captured facts must fail closed, not SQL-NULL
 // their way through a <> guard. Relax only this disposable table's constraint.
 for(const [table,column,where] of [
  ['stock_transfer_items','unit_cost',`transfer_id='${ids.child}'`],
  ['stock_transfer_items','quantity_received',`transfer_id='${ids.child}'`],
  ['stock_transfer_items','row_version',`transfer_id='${ids.child}'`],
  ['stock_transfers','row_version',`id='${ids.parent}'`],
 ])await caseTest('NULL captured '+table+'.'+column+' refuses without repair',async db=>{
  await db.exec(`ALTER TABLE ${table} ALTER COLUMN ${column} DROP NOT NULL;`);
  await setup(db,`UPDATE ${table} SET ${column}=NULL WHERE ${where}`);await rejectUnchanged(db);
 });
 await caseTest('app identity cannot execute owner maintenance',async db=>{await db.exec(`SELECT set_config('test.uid','${ids.actor}',false)`);await rejectUnchanged(db,/maintenance owner/);});
 await caseTest('later edited restored line is not silently overwritten',async db=>{await db.exec(repair);await setup(db,`UPDATE stock_transfer_items SET quantity=2 WHERE transfer_id='${ids.parent}'`);await rejectUnchanged(db,/audit\/line/);});
 await caseTest('deterministic audit UUID collision refuses instead of adopting unrelated history',async db=>{
  await db.exec("INSERT INTO change_history(id,entity_type,entity_id,action,revision,new_value) VALUES(md5('TRF16:SR-BET2-WEB01-20261031-0001:restore-request-line:v1')::uuid,'other','other','insert',1,'{}');");
  await rejectUnchanged(db,/unexpected existing/);
 });
 for(const change of ["stock_by_store=jsonb_set(stock_by_store,'{A}','1')",'selling_price=selling_price+1',"sku='UNEXPECTED'"])await caseTest('post-insert '+change+' rolls back repair and audit',async db=>{
  await db.exec(`CREATE FUNCTION fixture_unexpected_product_change() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN UPDATE products SET ${change} WHERE id=NEW.product_id;RETURN NEW;END$$;
   CREATE TRIGGER zz_fixture_side_effect AFTER INSERT ON stock_transfer_items FOR EACH ROW EXECUTE FUNCTION fixture_unexpected_product_change();`);
  await rejectUnchanged(db,/repair invariant/);
 });
 await caseTest('audit insertion failure rolls back the new parent line',async db=>{
  await db.exec(`CREATE FUNCTION fixture_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'fixture audit unavailable';END$$;CREATE TRIGGER fixture_audit_failure BEFORE INSERT ON change_history FOR EACH ROW EXECUTE FUNCTION fixture_audit_failure();`);
  await rejectUnchanged(db,/fixture audit unavailable/);
 });
 await caseTest('silent audit suppression rolls back the restored line and derived feed',async db=>{
  await db.exec(`CREATE FUNCTION fixture_audit_suppressed() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NULL;END$$;CREATE TRIGGER fixture_audit_suppressed BEFORE INSERT ON change_history FOR EACH ROW EXECUTE FUNCTION fixture_audit_suppressed();`);
  await rejectUnchanged(db,/audit insertion was not acknowledged/);
 });
 await caseTest('changed persisted audit content rolls back the restored line and derived feed',async db=>{
  await db.exec(`CREATE FUNCTION fixture_audit_changed() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.changed_by:='forged';RETURN NEW;END$$;CREATE TRIGGER fixture_audit_changed BEFORE INSERT ON change_history FOR EACH ROW EXECUTE FUNCTION fixture_audit_changed();`);
  await rejectUnchanged(db,/persisted audit/);
 });
 await caseTest('unexpected trigger-generated movement rolls back every repair effect',async db=>{
  await db.exec(`CREATE FUNCTION fixture_movement() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN INSERT INTO item_activity_logs(product_id,activity_type,reference,quantity_delta) VALUES(NEW.product_id,'transfer_out',${quote(childRef)},-1);RETURN NEW;END$$;CREATE TRIGGER zz_fixture_movement AFTER INSERT ON stock_transfer_items FOR EACH ROW EXECUTE FUNCTION fixture_movement();`);
  await rejectUnchanged(db,/repair invariant/);
 });
 await caseTest('immutable parent guard rejects reparenting but permits the reviewed fresh INSERT',async db=>{
  await db.exec(repair);const before=await snapshot(db);const line=before.stock_transfer_items.find(row=>row.transfer_id===ids.child);
  await assert.rejects(()=>db.exec(`UPDATE stock_transfer_items SET transfer_id='${ids.parent}' WHERE id='${line.id}'`),/TRANSFER_LINE_PARENT_IMMUTABLE/);
  assert.deepEqual(await snapshot(db),before);
 });
 await caseTest('restored paperwork never bypasses real zero-source-stock dispatch protection',async db=>{
  await db.exec(repair);await db.exec(webIdentity);const before=await snapshot(db);
  await assert.rejects(()=>db.query(`SELECT public.stock_transfer_dispatch_atomic('${ids.child}',NULL,'[{"product_id":"${ids.product}","qty":1}]')`),/Short by 1/);
  assert.deepEqual(await snapshot(db),before);
 });
 console.log(`${passed} request-line repair scenarios passed (${live>=0?'captured installed 25-trigger overlay':'canonical trigger fixture'}); no live database accessed.`);
}catch(error){console.error(error);process.exitCode=1;}
