'use strict';
// Owned in-memory/loopback SQL composition only. The business delegate below
// is deliberately synthetic; genuine canonical writer acceptance is separate.
const {PGlite}=require('@electric-sql/pglite');
const {readFileSync}=require('node:fs');
const {randomUUID,generateKeyPairSync,sign}=require('node:crypto');
const contract=require('../../electron/db/stock-history-contract.cjs');
const protocol=require('../../electron/security/stock-event-author-protocol.cjs');
async function createStockSourceAdmissionCloud({db=new PGlite()}={}){
 const author=randomUUID(),terminal=randomUUID(),key=randomUUID(),product=randomUUID(),database=randomUUID();
 const pair=generateKeyPairSync('ed25519'),project='https://stock.fixture';
 try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA pos_sync_private;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT COALESCE(current_setting('request.jwt.claim.role',true),'service_role')$$;
 CREATE TABLE app_users(id uuid PRIMARY KEY,user_id text,role text,role_slug text,store_id text,is_active boolean,permissions jsonb);
 CREATE TABLE terminal_tokens(id uuid PRIMARY KEY,location_id text,status text,revoked_at timestamptz,platform text,is_claimed boolean,claimed_at timestamptz,management_sync_enabled boolean);
 CREATE TABLE stores(id text PRIMARY KEY);CREATE TABLE shifts(id uuid PRIMARY KEY,store_id text,status text,closed_at timestamptz);
 CREATE TABLE products(id uuid PRIMARY KEY,name text,sku text,barcode text,owner_store_id text,stock_by_store jsonb,stock_quantity integer,price numeric);
 CREATE TABLE stock_delta_applied(movement_id uuid PRIMARY KEY,product_id uuid,store_id text,delta integer);
 CREATE TABLE item_activity_logs(id uuid PRIMARY KEY,product_id uuid,store_id text,quantity_delta integer,activity_type text,reference text);
 CREATE TABLE stock_adjustments(id uuid PRIMARY KEY,product_id uuid,store_id text,delta integer,previous_stock integer,updated_stock integer);
 CREATE TABLE purchase_orders(id uuid PRIMARY KEY,store_id text,status text,reference text,po_number text);
 CREATE TABLE pos_sync_private.shift_author_keys(key_id uuid PRIMARY KEY,author_id uuid,terminal_id text,project_origin text,public_key text,subject text,revoked_at timestamptz);
 CREATE TABLE sync_idempotency_receipts(batch_id uuid PRIMARY KEY,payload_hash text);
 CREATE FUNCTION public.pos_sync_validate_scope(text,text,text) RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$BEGIN
  IF $1<>'default' OR NOT EXISTS(SELECT 1 FROM terminal_tokens WHERE id::text=$3 AND location_id=$2 AND revoked_at IS NULL)
   THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN';END IF;END$$;
 CREATE FUNCTION public.pos_sync_push_aggregate(uuid,text,text,text,jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
 DECLARE prior text;part jsonb;r jsonb;BEGIN
  PERFORM pos_sync_validate_scope($2,$3,$4);PERFORM pg_advisory_xact_lock(hashtextextended('fixture-source-business:'||$1::text,0));
  SELECT payload_hash INTO prior FROM sync_idempotency_receipts WHERE batch_id=$1;
  IF FOUND THEN IF prior<>md5($5::text) THEN RAISE EXCEPTION 'SYNC_IDEMPOTENCY_MISMATCH';END IF;RETURN jsonb_build_object('ok',true,'replayed',true);END IF;
  FOR part IN SELECT value FROM jsonb_array_elements($5) LOOP
   FOR r IN SELECT value FROM jsonb_array_elements(part->'rows') LOOP
    IF part->>'table'='stock_adjustments' THEN
     INSERT INTO stock_adjustments SELECT * FROM jsonb_populate_record(NULL::stock_adjustments,r) ON CONFLICT DO NOTHING;
    ELSIF part->>'table'='purchase_orders' THEN
     INSERT INTO purchase_orders SELECT * FROM jsonb_populate_record(NULL::purchase_orders,r) ON CONFLICT DO NOTHING;
    ELSIF part->>'table'='item_activity_logs' THEN
     IF NOT EXISTS(SELECT 1 FROM item_activity_logs WHERE id=(r->>'id')::uuid) THEN
      INSERT INTO item_activity_logs SELECT * FROM jsonb_populate_record(NULL::item_activity_logs,r);
      INSERT INTO stock_delta_applied VALUES((r->>'id')::uuid,(r->>'product_id')::uuid,r->>'store_id',(r->>'quantity_delta')::integer);
      UPDATE products SET stock_by_store=jsonb_set(stock_by_store,ARRAY[$3],to_jsonb((stock_by_store->>$3)::integer+(r->>'quantity_delta')::integer)) WHERE id=(r->>'product_id')::uuid;
     END IF;
    ELSE RAISE EXCEPTION 'FIXTURE_UNSUPPORTED_BUSINESS_TABLE';END IF;
   END LOOP;
  END LOOP;
  INSERT INTO sync_idempotency_receipts VALUES($1,md5($5::text));RETURN jsonb_build_object('ok',true,'batch_id',$1);
 END$$;
 INSERT INTO stores VALUES('a'),('A'),('b');
 INSERT INTO app_users VALUES('${author}','original-cashier','staff','cashier','a',true,'{"can_adjust_stock":true,"can_receive_purchase_order":true}');
 INSERT INTO terminal_tokens VALUES('${terminal}','a','used',NULL,'pc',true,now(),false);
 INSERT INTO products VALUES('${product}','Fixture','0001','00001','a','{"a":3,"b":2}',5,19.95);`);
 await db.query("INSERT INTO pos_sync_private.shift_author_keys VALUES($1,$2,$3,$4,$5,'original-cashier',NULL)",[key,author,terminal,project,pair.publicKey.export({type:'spki',format:'der'}).toString('base64url')]);
 for(const name of['20261105113916_stock_history_effective_ledger.sql','20261105172030_stock_history_accepted_effect_capture.sql',
  '20261105232647_stock_history_author_claim_admission.sql','20261106035442_stock_history_original_source_receipts.sql',
  '20261106042742_stock_history_verified_source_membership.sql'])await db.exec(readFileSync('supabase/migrations/'+name,'utf8'));
 const scalar=async(sql,args=[])=>(Object.values((await db.query(sql,args)).rows[0]))[0];
 async function operation({action='ADJUST',quantity='-1',sequence='1',predecessor=null}={}){
  const operationId=randomUUID(),activity=randomUUID(),document=randomUUID(),batch=randomUUID(),at='2026-11-06T01:02:03.1234567Z';
  const before=await scalar("SELECT stock_by_store->>'a' FROM products WHERE id=$1",[product]),after=String(BigInt(before)+BigInt(quantity));
  const refs=[{table:'item_activity_logs',id:activity,productId:product,branchId:'a',delta:quantity},
   ...(action==='ADJUST'?[{table:'stock_adjustments',id:document,productId:product,branchId:'a',delta:quantity}]:[])];
  const row=contract.changes(contract.normalizeContext({operationId,branchId:'a',terminalId:terminal,actorId:author,kind:action==='ADJUST'?'stock':'receiving'},at),
   [{id:product,name:'Fixture',stock_by_store:{a:before}}],[{id:product,name:'Fixture',stock_by_store:{a:after}}],refs)[0];
  const operations=[...(action==='ADJUST'?[{table:'stock_adjustments',rows:[{id:document,product_id:product,store_id:'a',delta:Number(quantity),previous_stock:Number(before),updated_stock:Number(after)}],changes:[]}]:
   [{table:'purchase_orders',rows:[{id:document,store_id:'a',status:'posted',reference:'RECEIPT-FIXTURE',po_number:'PO-FIXTURE'}],changes:[]}]),
   {table:'item_activity_logs',rows:[{id:activity,product_id:product,store_id:'a',quantity_delta:Number(quantity),activity_type:action==='ADJUST'?'adjustment':'receive',reference:action==='ADJUST'?'COUNT-FIXTURE':'RECEIPT-FIXTURE'}],changes:[]}];
  const source={version:1,operationId,action,document:{type:action==='ADJUST'?'stock_adjustments':'receivings',id:document},authorId:author,terminalId:terminal,
   branchId:'a',productId:product,delta:quantity,effectiveAt:row.effective_at_raw,recordedAt:row.recorded_at_raw,sourceRefs:row.source_refs};
  const{buildStockSourceCohort}=require('../../electron/shared/stock-source-cohort.mjs'),cohort=await buildStockSourceCohort([source]);
  const common={version:1,algorithm:'Ed25519',keyId:key,projectOrigin:project,terminalId:terminal,authorId:author,subject:'original-cashier',branchId:'a',operationId,action};
  const headerFields={...common,sourceDatabaseId:database,sourceSequence:sequence,sourcePredecessorRoot:predecessor,sourceRoot:cohort.root,sourceCount:1};
  const header={...headerFields,signature:sign(null,Buffer.from(protocol.stockSourceCohortMessage(headerFields)),pair.privateKey).toString('base64url')};
  const proofFields={...common,movementId:row.id,payloadHash:row.payload_hash,sourceManifestJson:cohort.members[0].manifestJson};
  const proof={...proofFields,signature:sign(null,Buffer.from(protocol.stockEventMessage(proofFields)),pair.privateKey).toString('base64url')};
  const sourceCohortJson=JSON.stringify({proofJson:JSON.stringify(header),member:cohort.members[0],sourceBatchId:batch});
  const submission={id:row.id,payloadHash:row.payload_hash,payloadJson:row.payload_json,authorProofJson:JSON.stringify(proof),sourceCohortJson,authorState:{allowed:true},
   sourceState:{verified:true,sourceBatchId:batch,proofJson:JSON.stringify(header),manifestJson:cohort.members[0].manifestJson,memberIndex:0,timeGrade:'author_claimed'}};
  const upload=()=>scalar('SELECT pos_sync_push_stock_source_aggregate($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb)',[batch,'default','a',terminal,JSON.stringify(operations),project,JSON.stringify([{proofJson:JSON.stringify(header)}])]);
  const accept=(rows=[submission])=>scalar('SELECT pos_stock_history_accept_claims($1,$2,$3,$4::jsonb)',[project,'a',terminal,JSON.stringify(rows)]);
  return{row,operations,source,header,proof,submission,batch,upload,accept,before,after};
 }
 return{db,author,terminal,key,product,database,project,scalar,operation};
 }catch(error){await db.close();throw error;}
}
module.exports={createStockSourceAdmissionCloud};
