'use strict';
// Genuine isolated canonical writers. No POS profiles, network or business DB.
const assert=require('node:assert/strict'),{readFileSync}=require('node:fs'),{resolve}=require('node:path'),{createHash,randomUUID,generateKeyPairSync,sign,verify}=require('node:crypto');
const{createFullFinancialCloud}=require('./financial-cloud-fixture.cjs');
const root=resolve(__dirname,'../..'),read=path=>readFileSync(resolve(root,path),'utf8');
const schema=()=>read('supabase/schema.sql').replaceAll('\r\n','\n');
function stockFunction(name){const source=schema(),start=source.lastIndexOf('CREATE OR REPLACE FUNCTION public.'+name+'(');assert(start>=0,name);
 const tail=source.slice(start),tag=tail.match(/\bAS\s+(\$[\w]*\$)/i)?.[1];assert(tag,name);const end=tail.indexOf(tag+';',tail.indexOf(tag)+tag.length);assert(end>0,name);return tail.slice(0,end+tag.length+1);}
function table(name){const source=schema(),start=source.indexOf('CREATE TABLE IF NOT EXISTS public.'+name+' (');assert(start>=0,name);return source.slice(start,source.indexOf('\n);',start)+3);}
async function createActualStockWriter({capturedAdjustment=false,sourceAdmission=false}={}){
 const f=await createFullFinancialCloud({actualSaleDefinition:true});
 try{
  const{db}=f;
  for(const name of ['stock_adjustments','purchase_orders','purchase_order_items']){await db.exec(table(name));await db.exec('ALTER TABLE '+name+' ADD PRIMARY KEY(id);');}
  for(const match of schema().matchAll(/ALTER TABLE public\.(?:stock_adjustments|purchase_orders|purchase_order_items|item_activity_logs)\b[^;]*;/g))if(/ADD COLUMN/.test(match[0]))await db.exec(match[0]);
  for(const name of ['products','stock_adjustments','stock_delta_applied','item_activity_logs','purchase_orders','purchase_order_items']){
   await db.exec(stockFunction('sync_apply_'+name));await db.exec(stockFunction('sync_delete_'+name));
  }
  if(capturedAdjustment){const actual=JSON.parse(read('scripts/fixtures/stock-adjustment-live-definition-20261106.json'));
   assert.equal(actual.definition_md5,'6a15a6bc26a10fad7a3cee04c2c47637');assert.equal(createHash('md5').update(actual.definition).digest('hex'),actual.definition_md5);
   assert.equal(actual.prosecdef,false);assert.equal(actual.acl,'{postgres=X/postgres,service_role=X/postgres}');await db.exec(actual.definition);
  }
  await db.exec('REVOKE ALL ON FUNCTION public.sync_apply_stock_adjustments(jsonb) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.sync_apply_stock_adjustments(jsonb) TO service_role;');
  for(const path of ['20261105113916_stock_history_effective_ledger.sql','20261105172030_stock_history_accepted_effect_capture.sql'])await db.exec(read('supabase/migrations/'+path));
  const scalar=async(sql,args=[])=>(Object.values((await db.query(sql,args)).rows[0]))[0];
  const push=(batch,operations,branch='A',terminal=f.terminal)=>scalar('SELECT public.pos_sync_push_aggregate($1,\'default\',$2,$3,$4::jsonb)',[batch,branch,terminal,JSON.stringify(operations)]);
  const productRow=async quantity=>({...await scalar('SELECT to_jsonb(p) FROM products p WHERE id=$1',[f.product]),stock_quantity:quantity,stock_by_store:{A:quantity},row_version:20});
  const adjustment=(before=10,after=7)=>({id:randomUUID(),product_id:f.product,store_id:'A',terminal_id:f.terminal,reason:'count',note:'Synthetic count',cost_impact:0,
   previous_stock:before,updated_stock:after,delta:after-before,created_at:'2026-11-06T00:00:00Z',row_version:1});
  const result={...f,scalar,push,productRow,adjustment,stock:()=>scalar('SELECT stock_by_store->>\'A\' FROM products WHERE id=$1',[f.product])};
  if(sourceAdmission)Object.assign(result,await installSourceAdmission(result));
  return result;
 }catch(error){await f.db.close();throw error;}
}
async function installSourceAdmission(f){
 const{db,scalar,product,terminal,author}=f,project='https://stock.fixture',key=randomUUID(),database=randomUUID(),pair=generateKeyPairSync('ed25519');
 const c=require('../../electron/db/stock-history-contract.cjs'),p=require('../../electron/security/stock-event-author-protocol.cjs');
 for(const path of ['20261105232647_stock_history_author_claim_admission.sql','20261106035442_stock_history_original_source_receipts.sql','20261106042742_stock_history_verified_source_membership.sql'])await db.exec(read('supabase/migrations/'+path));
 await db.query('UPDATE app_users SET permissions=$2::jsonb WHERE id=$1',[author,JSON.stringify({can_adjust_stock:true,can_receive_purchase_order:true})]);
 await db.query(`INSERT INTO pos_sync_private.shift_author_keys(key_id,author_id,terminal_id,project_origin,subject,public_key) VALUES($1,$2,$3,$4,$5,$6)`,
  [key,author,terminal,project,author,pair.publicKey.export({type:'spki',format:'der'}).toString('base64url')]);
 async function sourceOperation({action='ADJUST',quantity=action==='ADJUST'?'-3':'2',arrivalReason}={}){
  const operationId=randomUUID(),batch=randomUUID(),document=randomUUID(),activity=randomUUID(),before=await f.stock(),after=String(BigInt(before)+BigInt(quantity)),at='2026-11-06T01:02:03.1234567Z';
  const refs=[{table:action==='ADJUST'?'stock_adjustments':'item_activity_logs',id:action==='ADJUST'?document:activity,productId:product,branchId:'A',delta:quantity}];
  const row=c.changes(c.normalizeContext({operationId,branchId:'A',terminalId:terminal,actorId:author,kind:action==='ADJUST'?'stock':'receiving'},at),
   [{id:product,name:'Fixture',stock_by_store:{A:before}}],[{id:product,name:'Fixture',stock_by_store:{A:action==='ADJUST'?after:before}}],refs)[0];
  const operations=action==='ADJUST'?[{table:'products',rows:[await f.productRow(Number(after))],changes:[]},{table:'stock_adjustments',rows:[{...f.adjustment(Number(before),Number(after)),id:document}],changes:[]}]:
   [{table:'purchase_orders',rows:[{id:document,store_id:'A',status:'posted',reference:'FIXTURE-GRN',po_number:'PO-1',total_cost:0,total_items_count:Number(quantity),created_at:at,updated_at:at,row_version:1}],changes:[]},
    {table:'item_activity_logs',rows:[{id:activity,product_id:product,store_id:'A',terminal_id:terminal,activity_type:'receive',reference:'FIXTURE-GRN',quantity_delta:Number(quantity),unit_cost:0,note:'',created_at:at,row_version:1}],changes:[]}];
  const{buildStockSourceCohort,verifyStockSourceMembership}=require('../../electron/shared/stock-source-cohort.mjs');
  const source={version:1,operationId,action,document:{type:action==='ADJUST'?'stock_adjustments':'receivings',id:document},authorId:author,terminalId:terminal,branchId:'A',productId:product,delta:quantity,
   effectiveAt:row.effective_at_raw,recordedAt:row.recorded_at_raw,sourceRefs:row.source_refs,...(arrivalReason!==undefined?{arrivalReason}:{})};
  const cohort=await buildStockSourceCohort([source]),common={version:1,algorithm:'Ed25519',keyId:key,projectOrigin:project,terminalId:terminal,authorId:author,subject:author,branchId:'A',operationId,action};
  const headerFields={...common,sourceDatabaseId:database,sourceSequence:'1',sourcePredecessorRoot:null,sourceRoot:cohort.root,sourceCount:1};
  const header={...headerFields,signature:sign(null,Buffer.from(p.stockSourceCohortMessage(headerFields)),pair.privateKey).toString('base64url')};
  const proofFields={...common,movementId:row.id,payloadHash:row.payload_hash,sourceManifestJson:cohort.members[0].manifestJson};
  const proof={...proofFields,signature:sign(null,Buffer.from(p.stockEventMessage(proofFields)),pair.privateKey).toString('base64url')};
  // This SQL composition exercises real source/effect admission. Independently
  // validate the genuine signatures/member here; hosted verifier tests remain
  // separate and this fixture never pretends a live enrollment/real account.
  assert(verify(null,Buffer.from(p.stockSourceCohortMessage(headerFields)),pair.publicKey,Buffer.from(header.signature,'base64url')));
  assert(verify(null,Buffer.from(p.stockEventMessage(proofFields)),pair.publicKey,Buffer.from(proof.signature,'base64url')));
  await verifyStockSourceMembership(cohort.members[0],{root:header.sourceRoot,count:header.sourceCount});
  const raw=JSON.stringify(header),sourceCohortJson=JSON.stringify({proofJson:raw,member:cohort.members[0],sourceBatchId:batch});
  const submission={id:row.id,payloadHash:row.payload_hash,payloadJson:row.payload_json,authorProofJson:JSON.stringify(proof),sourceCohortJson,authorState:{allowed:true},
   sourceState:{verified:true,sourceBatchId:batch,proofJson:raw,manifestJson:cohort.members[0].manifestJson,memberIndex:0,timeGrade:'author_claimed'}};
  return{row,source,operations,submission,batch,after,
   upload:()=>scalar('SELECT public.pos_sync_push_stock_source_aggregate($1,\'default\',\'A\',$2,$3::jsonb,$4,$5::jsonb)',[batch,terminal,JSON.stringify(operations),project,JSON.stringify([{proofJson:raw}])]),
   accept:()=>scalar('SELECT public.pos_stock_history_accept_claims($1,\'A\',$2,$3::jsonb)',[project,terminal,JSON.stringify([submission])])};
 }
 return{sourceOperation};
}
module.exports={createActualStockWriter,stockFunction};
