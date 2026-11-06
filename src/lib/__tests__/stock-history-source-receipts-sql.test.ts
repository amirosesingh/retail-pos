import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest';
const migration=readFileSync('supabase/migrations/20261106035442_stock_history_original_source_receipts.sql','utf8');
const receiptDefinition=migration.slice(migration.indexOf('CREATE FUNCTION private.stock_history_original_source_receipts('),migration.indexOf('REVOKE ALL ON FUNCTION private.stock_history_original_source_receipts'))
 .replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
const author=randomUUID(),key=randomUUID(),terminal=randomUUID(),product=randomUUID(),database=randomUUID();
let db:PGlite;
// Actual PostgreSQL source-witness SQL with an explicit synthetic delegation
// boundary. Full canonical business-writer admission has a separate fixture.
beforeAll(async()=>{
 db=new PGlite();await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA private;CREATE SCHEMA pos_sync_private;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT coalesce(current_setting('request.jwt.claim.role',true),'service_role')$$;
 CREATE TABLE app_users(id uuid PRIMARY KEY,user_id text,role text,role_slug text,store_id text,is_active boolean,permissions jsonb);
 CREATE TABLE terminal_tokens(id uuid PRIMARY KEY,location_id text,status text,revoked_at timestamptz,platform text,is_claimed boolean,claimed_at timestamptz);
 CREATE TABLE pos_sync_private.shift_author_keys(key_id uuid PRIMARY KEY,author_id uuid,terminal_id text,project_origin text,public_key text,subject text,revoked_at timestamptz);
 CREATE TABLE products(id uuid PRIMARY KEY,stock numeric);CREATE TABLE business_calls(batch uuid,operations jsonb);
 CREATE TABLE sync_idempotency_receipts(batch_id uuid PRIMARY KEY,payload_hash text);
 CREATE TABLE private.stock_history_accepted_effects(id uuid PRIMARY KEY,transaction_id bigint,store_id text);
 CREATE FUNCTION private.stock_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'STOCK_HISTORY_IMMUTABLE';END$$;
 CREATE FUNCTION private.stock_history_action_flag(text,text,jsonb,text) RETURNS boolean LANGUAGE sql AS $$SELECT $1='admin' OR $3->>'can_adjust_stock'='true'$$;
 CREATE FUNCTION public.pos_sync_push_aggregate(uuid,text,text,text,jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
 DECLARE hash text:=md5($5::text);old text;BEGIN
  IF $2<>'default' OR $3<>'a' OR $4<>'${terminal}' THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN';END IF;
  IF $5->0->>'table'='denied' THEN RAISE EXCEPTION 'BUSINESS_DENIED';END IF;
  SELECT payload_hash INTO old FROM sync_idempotency_receipts WHERE batch_id=$1;
  IF FOUND THEN IF old<>hash THEN RAISE EXCEPTION 'SYNC_IDEMPOTENCY_MISMATCH';END IF;RETURN jsonb_build_object('ok',true,'replayed',true,'batch_id',$1);END IF;
  INSERT INTO business_calls VALUES($1,$5);UPDATE products SET stock=stock-1;
  IF $5->0->>'table'='cancel_business' THEN RAISE EXCEPTION USING ERRCODE='57014',MESSAGE='synthetic business cancellation';END IF;
  INSERT INTO private.stock_history_accepted_effects VALUES(gen_random_uuid(),txid_current(),$3);
  INSERT INTO sync_idempotency_receipts VALUES($1,hash);RETURN jsonb_build_object('ok',true,'batch_id',$1,'applied',1);END$$;
 INSERT INTO app_users VALUES('${author}','original-user','staff','cashier','a',true,'{"can_adjust_stock":true}');
 INSERT INTO terminal_tokens VALUES('${terminal}','a','used',NULL,'pc',true,now());
 INSERT INTO pos_sync_private.shift_author_keys VALUES('${key}','${author}','${terminal}','https://stock.fixture','fixture-only-public','original-user',NULL);
 INSERT INTO products VALUES('${product}',10);`);
 await db.exec(migration);
},30000);
afterAll(async()=>db?.close());
beforeEach(async()=>{
 await db.exec(`RESET ROLE;SELECT set_config('request.jwt.claim.role','service_role',false);
 TRUNCATE private.stock_history_original_sources,private.stock_history_accepted_effects,business_calls,sync_idempotency_receipts;
 UPDATE products SET stock=10;UPDATE app_users SET is_active=true,store_id='a',permissions='{"can_adjust_stock":true}';
 UPDATE pos_sync_private.shift_author_keys SET revoked_at=NULL;UPDATE terminal_tokens SET location_id='a',status='used',revoked_at=NULL;`);
});
const operations=[{table:'products',rows:[{id:product,stock_by_store:{a:9}}],changes:[]}];
function source(patch:Record<string,unknown>={}){
 const proof={version:1,algorithm:'Ed25519',keyId:key,projectOrigin:'https://stock.fixture',terminalId:terminal,authorId:author,subject:'original-user',branchId:'a',
  operationId:randomUUID(),sourceDatabaseId:database,sourceSequence:'1',sourcePredecessorRoot:null,action:'ADJUST',sourceRoot:'a'.repeat(64),sourceCount:1,
  signature:'synthetic-sql-boundary-only',...patch};
 return{proofJson:JSON.stringify(proof)};
}
async function upload({batch=randomUUID(),rows=operations,sources=[source()],branch='a',till=terminal}:{batch?:string;rows?:unknown;sources?:unknown;branch?:string;till?:string}={}){
 return(await db.query<{ack:Record<string,unknown>}>(`SELECT pos_sync_push_stock_source_aggregate($1,'default',$2,$3,$4::jsonb,'https://stock.fixture',$5::jsonb) ack`,
  [batch,branch,till,JSON.stringify(rows),JSON.stringify(sources)])).rows[0]!.ack;
}
const number=async(sql:string)=>Number(Object.values((await db.query<Record<string,unknown>>(sql)).rows[0]!)[0]);
describe('optional original source witness does not replace business acceptance',()=>{
 it('delegates unchanged operations and captures only same-transaction effects',async()=>{
  const batch=randomUUID(),candidate=source(),ack=await upload({batch,sources:[candidate]});
  expect(ack).toMatchObject({ok:true,applied:1,stockSourceStatus:'captured_unverified'});expect((ack.stockSourceReceipts as unknown[]).length).toBe(1);
  const witness=(await db.query<Record<string,unknown>>('SELECT *,capture_xid::text xid FROM private.stock_history_original_sources')).rows[0]!;
  expect(witness.operations).toEqual(operations);expect(witness.headers).toEqual([candidate]);expect(witness.verification_state).toBe('unverified');expect(witness.batch_id).toBe(batch);
  const effect=(await db.query<Record<string,unknown>>('SELECT id,transaction_id::text xid FROM private.stock_history_accepted_effects')).rows[0]!;
  expect(witness.xid).toBe(effect.xid);expect(witness.effect_ids).toEqual([effect.id]);expect(await number('SELECT stock FROM products')).toBe(9);
 });
 it('replays lost ACK without a second stock write or rewritten witness',async()=>{
  const batch=randomUUID(),sources=[source()],first=await upload({batch,sources}),second=await upload({batch,sources});
  expect(second).toMatchObject({ok:true,replayed:true,stockSourceStatus:'captured_unverified',stockSourceReceipts:first.stockSourceReceipts});
  expect(await number('SELECT count(*) FROM business_calls')).toBe(1);expect(await number('SELECT stock FROM products')).toBe(9);
  expect(await number('SELECT count(*) FROM private.stock_history_original_sources')).toBe(1);
 });
 it.each(['bad-json','wrong-author','wrong-key','wrong-terminal','wrong-branch','bad-predecessor','bad-count','bad-action'])('retains %s only as raw UNVERIFIED evidence without granting authority',async(mode)=>{
  const candidate=source();const proof=JSON.parse(candidate.proofJson);
  if(mode==='bad-json')candidate.proofJson='{';
  if(mode==='wrong-author')proof.authorId=randomUUID();if(mode==='wrong-key')proof.keyId=randomUUID();
  if(mode==='wrong-terminal')proof.terminalId=randomUUID();if(mode==='wrong-branch')proof.branchId='A';
  if(mode==='bad-predecessor'){proof.sourceSequence='2';proof.sourcePredecessorRoot=null;}
  if(mode==='bad-count')proof.sourceCount=2001;if(mode==='bad-action')proof.action='SALE';

  if(mode!=='bad-json')candidate.proofJson=JSON.stringify(proof);
  const ack=await upload({sources:[candidate]});expect(ack).toMatchObject({ok:true,applied:1,stockSourceStatus:'captured_unverified'});
  expect(await number('SELECT stock FROM products')).toBe(9);expect(await number('SELECT count(*) FROM sync_idempotency_receipts')).toBe(1);
  expect(await number("SELECT count(*) FROM private.stock_history_original_sources WHERE verification_state='unverified'")).toBe(1);
 });
 it('rolls back the entire optional cohort set if any member header fails',async()=>{
  const ack=await upload({sources:[source(),{proofJson:'bounded',unapprovedExtraField:true}]});expect(ack).toMatchObject({ok:true,stockSourceStatus:'held',stockSourceReceipts:[]});
  expect(await number('SELECT count(*) FROM private.stock_history_original_sources')).toBe(0);expect(await number('SELECT stock FROM products')).toBe(9);
 });
 it('retains raw original proof during registry outage without attributing or verifying its actor',async()=>{
  await db.exec('ALTER TABLE pos_sync_private.shift_author_keys RENAME TO fixture_offline_registry;');
  try{
   const ack=await upload();expect(ack).toMatchObject({ok:true,stockSourceStatus:'captured_unverified'});
   expect(await number("SELECT count(*) FROM private.stock_history_original_sources WHERE verification_state='unverified'")).toBe(1);
  }finally{await db.exec('ALTER TABLE pos_sync_private.fixture_offline_registry RENAME TO shift_author_keys;');}
 });
 it('preserves missing proof as unverified accepted-business evidence without a forged author or claim receipt',async()=>{
  const ack=await upload({sources:[{proofJson:null}]});expect(ack).toMatchObject({ok:true,stockSourceStatus:'captured_unverified'});
  expect((ack.stockSourceReceipts as {proofHash:unknown}[])[0]!.proofHash).toBeNull();
  const witness=(await db.query<Record<string,unknown>>('SELECT headers,verification_state FROM private.stock_history_original_sources')).rows[0]!;
  expect(witness).toEqual({headers:[{proofJson:null}],verification_state:'unverified'});
 });
 it('bounded evidence failure leaves ordinary business data and its idempotency receipt accepted',async()=>{
  const ack=await upload({sources:[{proofJson:'x'.repeat(8193)}]});expect(ack).toMatchObject({ok:true,stockSourceStatus:'held',stockSourceReceipts:[]});
  expect(await number('SELECT stock FROM products')).toBe(9);expect(await number('SELECT count(*) FROM private.stock_history_original_sources')).toBe(0);
 });
 it.each(['57014','P0004'])('isolates optional metadata SQLSTATE%s without rolling back accepted business',async(code)=>{
  await db.exec(`CREATE OR REPLACE FUNCTION private.stock_history_original_source_receipts(p_source private.stock_history_original_sources) RETURNS jsonb
   LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION USING ERRCODE='${code}',MESSAGE='synthetic optional evidence cancellation';END$$;`);
  try{
   const ack=await upload();expect(ack).toMatchObject({ok:true,applied:1,stockSourceStatus:'held',stockSourceReceipts:[]});
   expect(await number('SELECT stock FROM products')).toBe(9);expect(await number('SELECT count(*) FROM sync_idempotency_receipts')).toBe(1);
   expect(await number('SELECT count(*) FROM private.stock_history_original_sources')).toBe(0);
  }finally{await db.exec(receiptDefinition);}
 });
 it('does not catch cancellation inside the ordinary business writer or preserve its unaccepted partial effects',async()=>{
  await expect(upload({rows:[{table:'cancel_business',rows:[]}]})).rejects.toMatchObject({code:'57014'});
  expect(await number('SELECT stock FROM products')).toBe(10);expect(await number('SELECT count(*) FROM sync_idempotency_receipts')).toBe(0);
 });
 it.each([{branch:'A'},{till:randomUUID()}])('does not use header claims to bypass the actual registered business scope: %s',async(scope)=>{
  await expect(upload(scope)).rejects.toThrow('SYNC_BRANCH_FORBIDDEN');expect(await number('SELECT stock FROM products')).toBe(10);
  expect(await number('SELECT count(*) FROM private.stock_history_original_sources')).toBe(0);
 });
 it('cannot reconstruct an original from a previously accepted receipt or later rows',async()=>{
  const batch=randomUUID();await upload({batch,sources:[]});const candidate=source();
  await db.exec('UPDATE products SET stock=2;');const retry=await upload({batch,sources:[candidate]});
  expect(retry).toMatchObject({ok:true,replayed:true,stockSourceStatus:'held',stockSourceReceipts:[]});
  expect(await number('SELECT stock FROM products')).toBe(2);expect(await number('SELECT count(*) FROM private.stock_history_original_sources')).toBe(0);
 });
 it('retains original accepted evidence after later business changes and authority revocation',async()=>{
  const batch=randomUUID(),sources=[source()],first=await upload({batch,sources});await upload({sources:[source({sourceSequence:'2',sourcePredecessorRoot:'a'.repeat(64)})]});
  await db.exec('UPDATE app_users SET is_active=false;UPDATE pos_sync_private.shift_author_keys SET revoked_at=now();');
  expect(await upload({batch,sources})).toMatchObject({ok:true,replayed:true,stockSourceStatus:'captured_unverified',stockSourceReceipts:first.stockSourceReceipts});
  expect(await number('SELECT stock FROM products')).toBe(8);
 });
 it('changed sidecars cannot replace the original witness even on a real business replay',async()=>{
  const batch=randomUUID(),candidate=source(),first=await upload({batch,sources:[candidate]});
  const changed=source({...JSON.parse(candidate.proofJson),sourceRoot:'b'.repeat(64)});
  expect(await upload({batch,sources:[changed]})).toMatchObject({ok:true,replayed:true,stockSourceStatus:'held',stockSourceReceipts:[]});
  const original=(await upload({batch,sources:[candidate]})).stockSourceReceipts;expect(original).toEqual(first.stockSourceReceipts);
  expect(await number('SELECT stock FROM products')).toBe(9);
 });
 it('preserves business rejection and payload idempotency mismatch unchanged',async()=>{
  await expect(upload({rows:[{table:'denied',rows:[]}]})).rejects.toThrow('BUSINESS_DENIED');expect(await number('SELECT stock FROM products')).toBe(10);
  const batch=randomUUID();await upload({batch});await expect(upload({batch,rows:[{...operations[0],rows:[]}]})).rejects.toThrow('SYNC_IDEMPOTENCY_MISMATCH');
  expect(await number('SELECT stock FROM products')).toBe(9);
 });
 it.each(['anon','authenticated'])('denies %s callers before the ordinary writer',async(role)=>{
  await db.query<Record<string,unknown>>("SELECT set_config('request.jwt.claim.role',$1,false)",[role]);await expect(upload()).rejects.toThrow('SYNC_FORBIDDEN');
  expect(await number('SELECT count(*) FROM business_calls')).toBe(0);
 });
 it('protects witness rows from update, delete and API-role reads',async()=>{
  await upload();await expect(db.exec("UPDATE private.stock_history_original_sources SET terminal_id='forged-till'")).rejects.toThrow('STOCK_HISTORY_IMMUTABLE');
  await expect(db.exec("UPDATE private.stock_history_original_sources SET verification_state='verified'")).rejects.toThrow();
  await expect(db.exec('DELETE FROM private.stock_history_original_sources')).rejects.toThrow('STOCK_HISTORY_IMMUTABLE');
  expect(await number("SELECT count(*) FROM pg_class WHERE oid='private.stock_history_original_sources'::regclass AND relrowsecurity")).toBe(1);
  expect((await db.query<Record<string,unknown>>("SELECT has_table_privilege('service_role','private.stock_history_original_sources','SELECT') allowed")).rows[0]!.allowed).toBe(false);
 });
});
