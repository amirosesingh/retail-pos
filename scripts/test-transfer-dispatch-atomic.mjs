// In-memory PostgreSQL only. Never reads a connection profile or contacts a live project.
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import {fixtureSql,migration,ids,quote,lineSql,dispatchSql,seedSql,nativeIdentity,webIdentity,triggerNames,liveOverlaySql} from './fixtures/transfer-dispatch-fixture.mjs';
const db=new PGlite();let passed=0;
const exec=sql=>db.exec(sql);
const query=async sql=>(await db.query(sql)).rows;
const proof=async(sql=dispatchSql())=>(await query(sql))[0].proof;
const state=async()=>({product:(await query(`SELECT stock_quantity,stock_by_store,owner_store_id,sku,cost_price,selling_price FROM products WHERE id='${ids.product}'`))[0],
 child:(await query(`SELECT status,dispatched_at,dispatched_by,fulfilment FROM stock_transfers WHERE id='${ids.child}'`))[0],
 parent:(await query(`SELECT status,closed_at,fulfilment FROM stock_transfers WHERE id='${ids.parent}'`))[0],
 movements:Number((await query('SELECT count(*) n FROM item_activity_logs'))[0].n)});
async function test(name,work,seed={}){await exec(seedSql(seed));await work();passed++;console.log(`PASS ${name}`);}
const refuses=async(sql,message)=>assert.rejects(()=>db.query(sql),error=>error.message.includes(message));
try{
 await exec(fixtureSql);
 let actualTriggers=triggerNames;
 const live=process.argv.indexOf('--live-definitions');
 if(live>=0){const overlay=await liveOverlaySql(process.argv[live+1],process.argv[live+2]);await exec(overlay.sql);actualTriggers=overlay.names;}
 await exec(seedSql());
 await exec(`SELECT public.stock_transfer_dispatch('${ids.child}','Old caller',${lineSql(2)});`);
 await refuses(`UPDATE stock_transfers SET status='completed',fulfilment='partial',closed_at=now() WHERE id='${ids.parent}'`,'cannot go from approved to completed');
 assert.equal((await state()).product.stock_by_store.A,8);
 assert.equal((await state()).parent.status,'approved');
 console.log('REPRODUCED baseline dispatch committed before rejected separate request closure');
 await exec(seedSql());await exec(nativeIdentity);
 await refuses(`SELECT public.stock_transfer_dispatch('${ids.child}','Dispatcher',${lineSql()});`,'cannot dispatch');
 console.log('REPRODUCED baseline native service call lacks JWT staff context');
 const legacyAcl=(await query("SELECT proacl::text acl FROM pg_proc WHERE oid='private.stock_transfer_dispatch(uuid,text,jsonb)'::regprocedure"))[0].acl;
 await exec('BEGIN;'+migration+'COMMIT;');await exec('BEGIN;'+migration+'COMMIT;');
 assert.equal((await query("SELECT proacl::text acl FROM pg_proc WHERE oid='private.stock_transfer_dispatch(uuid,text,jsonb)'::regprocedure"))[0].acl,legacyAcl);
 await test('linked full dispatch atomically closes request and preserves product identity/prices',async()=>{
  const before=await state(),p=await proof(dispatchSql(3)),after=await state();
  assert.equal(p.version,1);assert.equal(p.request_closed,true);assert.equal(p.request_fulfilment,'full');assert.equal(p.replayed,false);
  assert.equal(p.dispatched_by,'Authorized Dispatcher');assert.match(p.dispatched_at,/^\d{4}-\d{2}-\d{2}T/);
  const history=await query(`SELECT actor_name FROM entity_status_history WHERE entity_id='${ids.parent}' AND new_status='completed'`);assert.equal(history.length,2);assert(history.every(row=>row.actor_name==='Authorized Dispatcher'));assert.equal(p.request_closed_at,p.dispatched_at);
  assert.equal(p.lines[0].source_stock,7);assert.equal(p.lines[0].qty,3);
  assert.equal(after.parent.status,'completed');assert.equal(after.child.status,'dispatched');assert.equal(after.movements,1);
  for(const name of ['owner_store_id','sku','cost_price','selling_price'])assert.deepEqual(after.product[name],before.product[name]);
 });
 await test('partial send closes original requested quantity without carrying remainder',async()=>{
  const p=await proof(dispatchSql(1));assert.equal(p.fulfilment,'partial');assert.equal(p.request_fulfilment,'partial');assert.equal((await state()).parent.status,'completed');
 });
 await test('zero send closes request as none without stock movement',async()=>{
  const p=await proof(dispatchSql(0));assert.equal(p.fulfilment,'none');assert.equal(p.request_fulfilment,'none');assert.equal((await state()).product.stock_by_store.A,10);assert.equal((await state()).movements,0);
 });
 await test('direct transfer returns no request closure proof',async()=>{
  const p=await proof();assert.equal(p.source_request_id,null);assert.equal(p.request_closed,false);assert.equal(p.request_closed_at,null);assert.equal((await state()).product.stock_by_store.A,8);
 },{request:false});
 await test('shortage rolls back quantities, child, request and activity together',async()=>{
  const before=await state();await refuses(dispatchSql(1),'Short by 1');assert.deepEqual(await state(),before);
 },{stock:0});
 await test('active sub-warehouse picking is preserved; proof reports root bucket absolutely',async()=>{
  const p=await proof();assert.equal(p.lines[0].source_stock,0);const s=await state();assert.equal(s.product.stock_by_store['A-W'],3);assert.equal(s.product.stock_quantity,3);
 },{stock:0,extra:`INSERT INTO stores(id,code,name,parent_id,location_type,is_primary_sub) VALUES('A-W','AW','Source warehouse','A','sub_warehouse',true);UPDATE products SET stock_by_store='{"A":0,"A-W":5,"B":0}',stock_quantity=5;`});
 await test('existing approved quantity clamp is preserved',async()=>{
  const before=await state();await refuses(dispatchSql(99),'TRANSFER_DISPATCH_CONFLICT');assert.deepEqual(await state(),before);
  await exec(`SELECT public.stock_transfer_dispatch('${ids.child}',NULL,${lineSql(99)})`);assert.equal((await state()).product.stock_by_store.A,7);
 });
 await test('lost response exact retry returns proof without a second stock deduction',async()=>{
  await proof();const before=await state();const p=await proof();assert.equal(p.replayed,true);assert.deepEqual(await state(),before);
 });
 await test('replay after receipt does not rewind the current status',async()=>{
  await proof();await exec(`UPDATE stock_transfers SET status='received',received_by='Destination',received_at=now() WHERE id='${ids.child}'`);
  const before=await state();const p=await proof();assert.equal(p.status,'received');assert.equal(p.replayed,true);assert.deepEqual(await state(),before);
 });
 await test('changed quantities after a successful dispatch fail without another stock write',async()=>{
  await proof();const before=await state();await refuses(dispatchSql(1),'TRANSFER_DISPATCH_CONFLICT');assert.deepEqual(await state(),before);
 });
 await test('forged request-completion settings cannot close an undispatched child',async()=>{
  await exec(`SELECT set_config('pos.dispatch_request','${ids.parent}',false),set_config('pos.dispatch_child','${ids.child}',false)`);
  await refuses(`UPDATE stock_transfers SET status='completed',fulfilment='partial',closed_at=now() WHERE id='${ids.parent}'`,'cannot go from approved to completed');
  await exec(`SELECT set_config('pos.dispatch_request','',false),set_config('pos.dispatch_child','',false)`);
 });
 for(const [name,extra]of[
  ['wrong parent branch',`UPDATE stock_transfers SET to_store_id='C' WHERE id='${ids.parent}';`],
  ['parent is not a request',`UPDATE stock_transfers SET kind='transfer' WHERE id='${ids.parent}';`],
  ['child exceeds approved parent quantity',`UPDATE stock_transfer_items SET quantity_approved=1 WHERE transfer_id='${ids.parent}';`],
  ['child product is not on parent',`UPDATE stock_transfer_items SET product_id='${ids.product2}' WHERE transfer_id='${ids.parent}';`],
 ])await test(name,async()=>{const before=await state();await refuses(dispatchSql(),'TRANSFER_REQUEST_INVALID');assert.deepEqual(await state(),before);},{extra});
 await test('duplicate stored product rows fail before stock mutation',async()=>{
  const before=await state();await refuses(dispatchSql(),'TRANSFER_DISPATCH_CONFLICT');assert.deepEqual(await state(),before);
 },{request:false,extra:`INSERT INTO stock_transfer_items(transfer_id,product_id,quantity,quantity_approved) VALUES('${ids.child}','${ids.product}',1,1);`});
 await test('duplicate submitted product rows fail before stock mutation',async()=>{
  const before=await state();await refuses(`SELECT stock_transfer_dispatch_atomic('${ids.child}',NULL,'[{"product_id":"${ids.product}","qty":1},{"product_id":"${ids.product}","qty":2}]')`,'TRANSFER_DISPATCH_CONFLICT');assert.deepEqual(await state(),before);
 });
 await test('parent closure failure rolls back an otherwise successful stock pick',async()=>{
  await exec(`CREATE FUNCTION public.fixture_reject_parent() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.kind='request' AND NEW.status='completed' THEN RAISE EXCEPTION 'fixture parent rejection'; END IF;RETURN NEW;END$$;CREATE TRIGGER zz_fixture_reject_parent BEFORE UPDATE ON stock_transfers FOR EACH ROW EXECUTE FUNCTION fixture_reject_parent();`);
  const before=await state();await refuses(dispatchSql(),'fixture parent rejection');assert.deepEqual(await state(),before);
  await exec('DROP TRIGGER zz_fixture_reject_parent ON stock_transfers;DROP FUNCTION fixture_reject_parent();');
 });
 await test('same-cluster direct dispatch and independently approved cross-cluster dispatch remain valid',async()=>{
  assert.equal((await proof()).status,'dispatched');
 },{cross:true});
 await test('invalid cross-cluster self approval still rolls back stock',async()=>{
  const before=await state();await refuses(dispatchSql(),'no valid approval');assert.deepEqual(await state(),before);
 },{cross:true,extra:`UPDATE stock_transfers SET approved_by=created_by WHERE id='${ids.child}';`});
 await test('a competing second child cannot fulfil a request already closed by another child',async()=>{
  await proof();const before=await state();await refuses(dispatchSql(2,ids.child2),'TRANSFER_REQUEST_INVALID');assert.deepEqual(await state(),before);
 },{extra:`INSERT INTO stock_transfers(id,ref,kind,status,from_store_id,to_store_id,source_request_id,created_by,approved_by,approved_at) SELECT '${ids.child2}','ST-SECOND',kind,status,from_store_id,to_store_id,source_request_id,created_by,approved_by,approved_at FROM stock_transfers WHERE id='${ids.child}';INSERT INTO stock_transfer_items(transfer_id,product_id,quantity,quantity_approved) VALUES('${ids.child2}','${ids.product}',3,3);`});
 await test('verified native cashier dispatch works without changing JWT identity',async()=>{
  await exec(nativeIdentity);const p=await proof(dispatchSql(2,ids.child,true));assert.equal(p.dispatched_by,'Authorized Dispatcher');assert.equal(p.request_closed,true);
  assert.equal((await query('SELECT auth.uid() uid'))[0].uid,null);
  assert.equal((await query("SELECT current_setting('pos.native_dispatch_staff',true) actor"))[0].actor,'');
 });
 for(const[name,extra]of[
  ['revoked action',`UPDATE app_users SET permissions='{}' WHERE user_id='dispatcher';`],
  ['inactive account',`UPDATE app_users SET is_active=false WHERE user_id='dispatcher';`],
  ['all applicable pages denied',`UPDATE app_users SET permissions='{"can_create_transfer":true,"page:requests":false,"page:transfers":false,"page:approvals":false,"page:verifications":false}' WHERE user_id='dispatcher';`],
 ])await test('native '+name+' is denied',async()=>{await exec(nativeIdentity);const before=await state();await refuses(dispatchSql(2,ids.child,true),'permission required');assert.deepEqual(await state(),before);},{extra});
 await test('native administrator default authority matches ordinary password permission checks',async()=>{
  await exec(nativeIdentity);assert.equal((await proof(dispatchSql(2,ids.child,true))).status,'dispatched');
 },{extra:`UPDATE app_users SET role='admin',role_slug='admin',permissions='{}' WHERE user_id='dispatcher';`});
 await test('native branch binding remains restrictive for a wider administrator',async()=>{
  await exec(nativeIdentity);const before=await state();await refuses(`SELECT stock_transfer_dispatch_atomic_for_staff('${ids.child}','dispatcher','B',${lineSql()})`,'sending location');assert.deepEqual(await state(),before);
 },{extra:`UPDATE app_users SET role='admin',role_slug='admin',store_id=NULL,permissions='{}' WHERE user_id='dispatcher';`});
 await test('native assigned staff cannot request a foreign branch through a forged actor label',async()=>{
  await exec(nativeIdentity);await refuses(`SELECT stock_transfer_dispatch_atomic_for_staff('${ids.child}','foreign','A',${lineSql()})`,'sending location');assert.equal((await state()).child.status,'approved');
 });
 await test('authenticated clients cannot execute the service-only native adapter',async()=>{
  const allowed=(await query("SELECT has_function_privilege('authenticated','public.stock_transfer_dispatch_atomic_for_staff(uuid,text,text,jsonb,boolean)','execute') allowed"))[0].allowed;assert.equal(allowed,false);
  await refuses(`SELECT stock_transfer_dispatch_atomic_for_staff('${ids.child}','dispatcher','A',${lineSql()})`,'Verified native staff session required');
 });
 await test('revoked browser operator cannot replay an earlier successful dispatch',async()=>{
  await proof();await exec("UPDATE app_users SET permissions='{}' WHERE user_id='dispatcher'");await refuses(dispatchSql(),'cannot dispatch');assert.equal((await state()).product.stock_by_store.A,8);
 });
 await test('legacy void dispatch followed by old request-close update remains compatible',async()=>{
  await exec(`SELECT public.stock_transfer_dispatch('${ids.child}','Legacy label',${lineSql(2)});UPDATE stock_transfers SET status='completed',fulfilment='partial',closed_at='2026-10-31T01:02:03.000Z' WHERE id='${ids.parent}';`);
  assert.equal((await state()).product.stock_by_store.A,8);assert.equal(Date.parse((await proof()).request_closed_at),Date.parse('2026-10-31T01:02:03Z'));
 });
 await test('new RPC rejects missing or extra cached lines before stock mutation',async()=>{
  const before=await state();
  for(const lines of [[],[{product_id:ids.product,qty:2},{product_id:ids.product2,qty:1}]])await refuses(`SELECT stock_transfer_dispatch_atomic('${ids.child}',NULL,${quote(JSON.stringify(lines))}::jsonb)`,'TRANSFER_DISPATCH_CONFLICT');
  assert.deepEqual(await state(),before);
 });
 await test('new RPC rejects fractional input before stock mutation',async()=>{const before=await state();await refuses(dispatchSql(1.5),'TRANSFER_DISPATCH_CONFLICT');assert.deepEqual(await state(),before);});
 await test('historical dispatched rows without immutable intent fail closed on retry',async()=>{
  const before=await state();await refuses(dispatchSql(),'TRANSFER_DISPATCH_CONFLICT');assert.deepEqual(await state(),before);
 },{request:false,extra:`UPDATE stock_transfers SET status='dispatched',dispatched_at=now() WHERE id='${ids.child}';UPDATE stock_transfer_items SET quantity_dispatched=2 WHERE transfer_id='${ids.child}';`});
 await test('private dispatch receipt is append-only and has no direct role grants',async()=>{
  await proof();
  await refuses('UPDATE private.transfer_dispatch_receipts SET actor_name=actor_name','append-only');
  await refuses('DELETE FROM private.transfer_dispatch_receipts','append-only');
  for(const role of ['anon','authenticated','service_role'])for(const access of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])assert.equal((await query(`SELECT has_table_privilege('${role}','private.transfer_dispatch_receipts','${access}') allowed`))[0].allowed,false);
  const before=await query('SELECT * FROM private.transfer_dispatch_receipts');await exec('BEGIN;'+migration+'COMMIT;');assert.deepEqual(await query('SELECT * FROM private.transfer_dispatch_receipts'),before);
 });
 await test('native dispatch needs create permission but does not inherit approval authority',async()=>{
  await exec(nativeIdentity);const p=await proof(dispatchSql(2,ids.child,true));assert.equal(p.request_closed,true);
  const history=await query(`SELECT actor_name FROM entity_status_history WHERE entity_id='${ids.parent}' AND new_status='completed'`);assert.equal(history.length,2);assert(history.every(row=>row.actor_name==='Authorized Dispatcher'));
  assert.equal((await query(`SELECT verified_by FROM stock_transfers WHERE id='${ids.parent}'`))[0].verified_by,null);
 },{cross:true,extra:`UPDATE app_users SET permissions='{"can_create_transfer":true}' WHERE user_id='dispatcher';`});
 await test('all new private routines remain owner-only and public entry points retain minimal roles',async()=>{
  const helpers=await query("SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND (p.proname LIKE 'transfer_dispatch_%' OR p.proname IN('native_transfer_dispatcher','stock_transfer_dispatch_atomic_core','stock_transfer_dispatch_stock_only'))");
  assert(helpers.length>=6);for(const routine of helpers)for(const role of ['anon','authenticated','service_role'])assert.equal((await query(`SELECT has_function_privilege('${role}',${routine.oid},'EXECUTE') allowed`))[0].allowed,false,routine.proname+':'+role);
  assert.equal((await query("SELECT has_function_privilege('authenticated','public.stock_transfer_dispatch_atomic(uuid,text,jsonb)','EXECUTE') allowed"))[0].allowed,true);
  assert.equal((await query("SELECT has_function_privilege('service_role','public.stock_transfer_dispatch_atomic(uuid,text,jsonb)','EXECUTE') allowed"))[0].allowed,false);
  assert.equal((await query("SELECT has_function_privilege('service_role','public.stock_transfer_dispatch_atomic_for_staff(uuid,text,text,jsonb,boolean)','EXECUTE') allowed"))[0].allowed,true);
 });
 for(const[name,ddl]of[
  ['unknown collision',`CREATE TABLE private.transfer_dispatch_receipts(id text);`],
  ['wrong column type',`CREATE TABLE private.transfer_dispatch_receipts(transfer_id uuid PRIMARY KEY,intent text NOT NULL,actor_id uuid NOT NULL,actor_name text NOT NULL,dispatched_at timestamptz NOT NULL,created_at timestamptz NOT NULL);COMMENT ON TABLE private.transfer_dispatch_receipts IS 'Retail POS TRF15 dispatch intent v1';`],
  ['wrong owner',`CREATE ROLE operator_owner;CREATE TABLE private.transfer_dispatch_receipts(transfer_id uuid PRIMARY KEY,intent jsonb NOT NULL,actor_id uuid NOT NULL,actor_name text NOT NULL,dispatched_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());COMMENT ON TABLE private.transfer_dispatch_receipts IS 'Retail POS TRF15 dispatch intent v1';ALTER TABLE private.transfer_dispatch_receipts OWNER TO operator_owner;`],
  ['missing timestamp default',`CREATE TABLE private.transfer_dispatch_receipts(transfer_id uuid PRIMARY KEY,intent jsonb NOT NULL,actor_id uuid NOT NULL,actor_name text NOT NULL,dispatched_at timestamptz NOT NULL,created_at timestamptz NOT NULL);COMMENT ON TABLE private.transfer_dispatch_receipts IS 'Retail POS TRF15 dispatch intent v1';`],
  ['missing primary key',`CREATE TABLE private.transfer_dispatch_receipts(transfer_id uuid NOT NULL,intent jsonb NOT NULL,actor_id uuid NOT NULL,actor_name text NOT NULL,dispatched_at timestamptz NOT NULL,created_at timestamptz NOT NULL);COMMENT ON TABLE private.transfer_dispatch_receipts IS 'Retail POS TRF15 dispatch intent v1';`],
 ]){
  const collision=new PGlite();try{await collision.exec(fixtureSql);await collision.exec(ddl);const before=(await collision.query("SELECT relacl::text acl,relowner FROM pg_class WHERE oid='private.transfer_dispatch_receipts'::regclass")).rows;
   await assert.rejects(()=>collision.exec('BEGIN;'+migration+'COMMIT;'),/Unrecognized existing dispatch proof table/);await collision.exec('ROLLBACK;');
   assert.deepEqual((await collision.query("SELECT relacl::text acl,relowner FROM pg_class WHERE oid='private.transfer_dispatch_receipts'::regclass")).rows,before);passed++;console.log('PASS receipt '+name+' aborts transaction before taking over table/ACL');
  }finally{await collision.close();}
 }
 await test('NEW UUID identity normalization accepts uppercase and refuses case-alias duplicates',async()=>{
  const p=await proof(dispatchSql().replace(ids.product,ids.product.toUpperCase()));assert.equal(p.lines[0].qty,2);
  await exec(seedSql());const before=await state();
  await refuses(`SELECT stock_transfer_dispatch_atomic('${ids.child}',NULL,'[{"product_id":"${ids.product}","qty":1},{"product_id":"${ids.product.toUpperCase()}","qty":1}]')`,'TRANSFER_DISPATCH_CONFLICT');assert.deepEqual(await state(),before);
 });
 await test('post-commit product mutation cannot fabricate a replay proof',async()=>{
  await proof();await exec(`UPDATE stock_transfer_items SET product_id='${ids.product2}' WHERE transfer_id='${ids.child}'`);
  const before=await state();await refuses(dispatchSql(2,ids.child).replace(ids.product,ids.product2),'TRANSFER_DISPATCH_CONFLICT');assert.deepEqual(await state(),before);
 },{request:false});
 if(process.argv.includes('--write-protocol-proof')){
  const {writeFile}=await import('node:fs/promises');const examples=[];
  for(const native of [false,true]){await exec(seedSql());if(native)await exec(nativeIdentity);examples.push({expected:{id:ids.child,fromStoreId:'A',toStoreId:'B',sourceRequestId:ids.parent},lines:[{productId:ids.product,qty:2}],proof:await proof(dispatchSql(2,ids.child,native))});}
  await writeFile(new URL('../node_modules/.cache/trf15-protocol-proof.json',import.meta.url),JSON.stringify(examples,null,2));
 }
 console.log(JSON.stringify({passed,actualTriggerNames:actualTriggers,externalDatabaseAccess:false},null,2));
}catch(error){console.error(error.message);if(error.cause)console.error(error.cause.message);process.exitCode=1;}finally{await db.close();}
