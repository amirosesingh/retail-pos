import{createRequire}from'node:module';
import{readFileSync}from'node:fs';
import{createHash,randomUUID,sign,verify,type KeyObject}from'node:crypto';
import{beforeAll,afterAll,describe,it,expect}from'vitest';
import{stockCoverageFrontierJson}from'../../../electron/shared/stock-coverage-frontier.mjs';
import{buildStockSourceCohort,verifyStockSourceMembership}from'../../../electron/shared/stock-source-cohort.mjs';
const require=createRequire(import.meta.url),{createActualStockWriter}=require('../../../scripts/lib/stock-actual-writer-fixture.cjs');
const protocol=require('../../../electron/security/stock-event-author-protocol.cjs');
const upgrade=readFileSync('supabase/migrations/20261106073851_stock_history_coverage_frontiers.sql','utf8'),project='https://stock.fixture';
let pair:{privateKey:KeyObject;publicKey:KeyObject},key:string,f:any,original:any,header:any;
const hash=(raw:string)=>createHash('sha256').update(raw).digest('hex');
async function actualBulkSource(){
 const c=require('../../../electron/db/stock-history-contract.cjs'),operation=randomUUID(),batch=randomUUID(),databaseId=randomUUID(),at='2026-11-06T01:02:03.1234567Z';
 const products=[f.product,...Array.from({length:9},()=>randomUUID())],rows=[],manifests=[],productRows=[],adjustments=[];
 for(const product of products){
  if(product!==f.product)await f.db.query("INSERT INTO products(id,name,barcode,stock_by_store,owner_store_id) VALUES($1,'Bulk source fixture',$2,'{\"A\":10}','A')",[product,'fixture-'+product]);
  const before=await f.scalar("SELECT stock_by_store->>'A' FROM products WHERE id=$1",[product]),after=String(BigInt(before)-1n),document=randomUUID();
  const row=c.changes(c.normalizeContext({operationId:operation,branchId:'A',terminalId:f.terminal,actorId:f.author,kind:'stock'},at),
   [{id:product,name:'Fixture',stock_by_store:{A:before}}],[{id:product,name:'Fixture',stock_by_store:{A:after}}],
   [{table:'stock_adjustments',id:document,productId:product,branchId:'A',delta:'-1'}])[0];rows.push(row);
  manifests.push({version:1 as const,operationId:operation,action:'ADJUST' as const,document:{type:'stock_adjustments' as const,id:document},authorId:f.author,terminalId:f.terminal,branchId:'A',productId:product,delta:'-1',effectiveAt:row.effective_at_raw,recordedAt:row.recorded_at_raw,sourceRefs:row.source_refs});
  productRows.push({...await f.productRow(Number(after)),id:product,barcode:product===f.product?'fixture-barcode':'fixture-'+product});
  adjustments.push({...f.adjustment(Number(before),Number(after)),id:document,product_id:product});
 }
 const cohort=await buildStockSourceCohort(manifests),common={version:1,algorithm:'Ed25519',keyId:key,projectOrigin:project,terminalId:f.terminal,authorId:f.author,subject:f.author,branchId:'A',operationId:operation,action:'ADJUST'};
 const fields={...common,sourceDatabaseId:databaseId,sourceSequence:'1',sourcePredecessorRoot:null,sourceRoot:cohort.root,sourceCount:10};
 const proofJson=JSON.stringify({...fields,signature:sign(null,Buffer.from(protocol.stockSourceCohortMessage(fields)),pair.privateKey).toString('base64url')});
 const submissions=[];
 for(const row of rows){
  const member=cohort.members.find(value=>JSON.parse(value.manifestJson).productId===row.product_id)!;await verifyStockSourceMembership(member,{count:10,root:cohort.root});
  const facts={...common,movementId:row.id,payloadHash:row.payload_hash,sourceManifestJson:member.manifestJson};
  const proof={...facts,signature:sign(null,Buffer.from(protocol.stockEventMessage(facts)),pair.privateKey).toString('base64url')};
  expect(verify(null,Buffer.from(protocol.stockEventMessage(facts)),pair.publicKey,Buffer.from(proof.signature,'base64url'))).toBe(true);
  submissions.push({id:row.id,payloadHash:row.payload_hash,payloadJson:row.payload_json,authorProofJson:JSON.stringify(proof),sourceCohortJson:JSON.stringify({proofJson,member,sourceBatchId:batch}),authorState:{allowed:true},
   sourceState:{verified:true,sourceBatchId:batch,proofJson,manifestJson:member.manifestJson,memberIndex:member.index,timeGrade:'author_claimed'}});
 }
 const operations=[{table:'products',rows:productRows,changes:[]},{table:'stock_adjustments',rows:adjustments,changes:[]}];
 await f.scalar("SELECT public.pos_sync_push_stock_source_aggregate($1,'default','A',$2,$3::jsonb,$4,$5::jsonb)",[batch,f.terminal,JSON.stringify(operations),project,JSON.stringify([{proofJson}])]);
 return{databaseId,sourceRoot:cohort.root,accept:(part:unknown[])=>f.scalar("SELECT public.pos_stock_history_accept_claims($1,'A',$2,$3::jsonb)",[project,f.terminal,JSON.stringify(part)]),submissions};
}
beforeAll(async()=>{
 f=await createActualStockWriter({sourceAdmission:true,capturedAdjustment:true});original=await f.sourceOperation();await original.upload();await original.accept();
 header=JSON.parse(JSON.parse(original.submission.sourceCohortJson).proofJson);await f.db.exec(upgrade);
 ({key,pair}=f.stockSourceFixture);
},30000);
afterAll(async()=>f?.db.close());
async function observation(change:Record<string,unknown>={},challengeId=randomUUID()){
 const challenge=await f.scalar('SELECT public.pos_stock_history_frontier_challenge($1,$2,$3,$4,$5,$6)',[challengeId,project,'A',f.terminal,f.author,key]);
 const value={version:1,projectOrigin:project,branchId:'A',terminalId:f.terminal,authorId:f.author,databaseId:header.sourceDatabaseId,
  challengeId,nonce:challenge.nonce,cohortHash:challenge.cohortHash,writerRevision:'stock-history-source.v1',sourceSequence:'1',sourceRoot:header.sourceRoot,
  sourceGeneration:'a'.repeat(64),gapHash:hash('[]'),pending:{business:'0',metadata:'0',unsigned:'0',unknown:'0'},observedAt:challenge.issuedAt,...change};
 const frontierJson=stockCoverageFrontierJson(value),fields={version:1,algorithm:'Ed25519',keyId:key,projectOrigin:project,terminalId:f.terminal,authorId:f.author,
  subject:f.author,branchId:'A',challengeId,frontierHash:hash(frontierJson)};
 const signature=sign(null,Buffer.from(protocol.stockCoverageFrontierMessage(fields)),pair.privateKey).toString('base64url');
 expect(verify(null,Buffer.from(protocol.stockCoverageFrontierMessage(fields)),pair.publicKey,Buffer.from(signature,'base64url'))).toBe(true);
 const proofJson=JSON.stringify({...fields,signature});
 return{value,challenge,frontierJson,proofJson,accept:(allowed=true,branch='A',till=f.terminal)=>f.scalar('SELECT public.pos_stock_history_accept_frontier($1,$2,$3,$4,$5,$6)',[project,branch,till,frontierJson,proofJson,allowed])};
}
describe('service-only original stock frontier nonce and accepted-prefix observation',()=>{
 it('grants no direct private metadata or public API authority to browser roles',async()=>{
  for(const role of['anon','authenticated']){
   expect(await f.scalar(`SELECT has_function_privilege('${role}','public.pos_stock_history_accept_frontier(text,text,text,text,text,boolean)','EXECUTE')`)).toBe(false);
   expect(await f.scalar(`SELECT has_function_privilege('${role}','public.pos_stock_history_frontier_challenge(uuid,text,text,text,uuid,uuid)','EXECUTE')`)).toBe(false);
  }
  expect(await f.scalar("SELECT has_table_privilege('service_role','private.stock_history_frontier_receipts','SELECT')")).toBe(false);
 });
 it('uses a genuine accepted original writer/source prefix without granting inventory or stock authority',async()=>{
  const p=await observation(),before=await f.stock();const accepted=await p.accept();
  expect(accepted).toMatchObject({challengeId:p.value.challengeId,frontierHash:hash(p.frontierJson),state:'accepted',reasons:[],observationGrade:'author_claimed'});
  expect(accepted).not.toHaveProperty('complete');expect(accepted).not.toHaveProperty('quantity');expect(await f.stock()).toBe(before);
  expect(await f.scalar('SELECT permissions?\'can_view_inventory\' FROM app_users WHERE id=$1',[f.author])).toBe(false);
  expect(await p.accept()).toEqual(accepted);
 });
 it('retains an empty new database prefix as an observation, not proof of historical opening',async()=>{
  const p=await observation({databaseId:randomUUID(),sourceSequence:'0',sourceRoot:null});expect(await p.accept()).toMatchObject({state:'accepted',observationGrade:'author_claimed'});
  expect(await f.scalar('SELECT count(*) FROM stock_history_baselines')).toBe(0);
 });
 it.each(['business','metadata','unsigned','unknown'])('retains actual pending %s as unconfirmed coverage',async kind=>{
  const p=await observation({pending:{business:'0',metadata:'0',unsigned:'0',unknown:'0',[kind]:'9007199254740993'}});
  expect(await p.accept()).toMatchObject({state:'unconfirmed',reasons:['PENDING_'+kind.toUpperCase()]});
 });
 it.each([{sourceSequence:'0',sourceRoot:null},{sourceSequence:'2'},{sourceRoot:'b'.repeat(64)}])('does not accept a missing/stale/changed original prefix %j',async change=>{
  const p=await observation(change);expect(await p.accept()).toMatchObject({state:'unconfirmed',reasons:['SOURCE_PREFIX_UNCONFIRMED']});
 });
 it.each(['2000-01-01T00:00:00.0000000Z','2099-01-01T00:00:00.0000000Z'])('retains clock anomaly %s without certifying physical time',async observedAt=>{
  const p=await observation({observedAt});expect(await p.accept()).toMatchObject({state:'unconfirmed',reasons:['DEVICE_CLOCK_ANOMALY']});
 });
 it('requires verified identity for a new receipt, while exact accepted replay can acknowledge revoked history without rewriting it',async()=>{
  const p=await observation();await expect(p.accept(false)).rejects.toThrow('STOCK_FRONTIER_AUTHOR_REQUIRED');const accepted=await p.accept();
  await f.db.exec('BEGIN;');await f.db.query('UPDATE pos_sync_private.shift_author_keys SET revoked_at=now() WHERE key_id=$1',[key]);
  try{expect(await p.accept(false)).toEqual(accepted);await expect(observation()).rejects.toThrow('STOCK_FRONTIER_IDENTITY_INVALID');}
  finally{await f.db.exec('ROLLBACK;');}
 });
 it('rejects another branch or terminal before accepting any observation',async()=>{
  const p=await observation();await expect(p.accept(true,'B')).rejects.toThrow();await expect(p.accept(true,'A',randomUUID())).rejects.toThrow();
 });
 it('rejects a changed nonce or same-challenge changed signed observation, retaining original bytes',async()=>{
  const wrong=await observation({nonce:'A'.repeat(43)});await expect(wrong.accept()).rejects.toThrow('STOCK_FRONTIER_CHALLENGE_INVALID');
  const p=await observation(),accepted=await p.accept(),changed=await observation({sourceGeneration:'b'.repeat(64)},p.value.challengeId);
  await expect(changed.accept()).rejects.toThrow('STOCK_FRONTIER_REPLAY_CONFLICT');expect(await p.accept()).toEqual(accepted);
 });
 it('rejects a changed active writer cohort, without relabeling the old observation',async()=>{
  const p=await observation(),newTill=randomUUID();await f.db.query("INSERT INTO terminal_tokens(id,location_id,status,platform,is_claimed) VALUES($1,'A','active','pc',true)",[newTill]);
  try{await expect(p.accept()).rejects.toThrow('STOCK_FRONTIER_CHALLENGE_STALE');}
  finally{await f.db.query('DELETE FROM terminal_tokens WHERE id=$1',[newTill]);}
 });
 it('makes challenge retries stable without extending their original expiry',async()=>{
  const id=randomUUID(),first=await observation({},id),second=await observation({},id);expect(second.challenge).toEqual(first.challenge);
  await expect(f.scalar('SELECT public.pos_stock_history_frontier_challenge($1,$2,$3,$4,$5,$6)',[id,project,'A',f.terminal,f.admin,key])).rejects.toThrow();
 });
 it('refuses a genuinely expired immutable challenge instead of extending or consuming it',async()=>{
  const id=randomUUID();await f.db.query(`INSERT INTO private.stock_history_frontier_challenges
   SELECT $1,$2,'A',$3,$4,$5,$6,encode(sha256(convert_to(members::text,'UTF8')),'hex'),members,clock_timestamp()-interval'10 minutes',clock_timestamp()-interval'6 minutes'
   FROM(SELECT private.stock_history_frontier_cohort('A') members) candidate`,[id,project,f.terminal,f.author,key,'A'.repeat(43)]);
  const p=await observation({},id);await expect(p.accept()).rejects.toThrow('STOCK_FRONTIER_CHALLENGE_STALE');
  expect(await f.scalar('SELECT count(*) FROM private.stock_history_frontier_receipts WHERE challenge_id=$1',[id])).toBe(0);
 });
 it('keeps original nonce and accepted receipt metadata immutable',async()=>{
  const p=await observation();await p.accept();await expect(f.db.query('DELETE FROM private.stock_history_frontier_receipts WHERE challenge_id=$1',[p.value.challengeId])).rejects.toThrow('STOCK_HISTORY_IMMUTABLE');
  await expect(f.db.query('UPDATE private.stock_history_frontier_challenges SET expires_at=expires_at+interval\'1 second\' WHERE id=$1',[p.value.challengeId])).rejects.toThrow('STOCK_HISTORY_IMMUTABLE');
 });
 it('requires all ten real accepted source members after eight-plus-two upload pages, even when a claimed local count is zero',async()=>{
  const bulk=await actualBulkSource();await bulk.accept(bulk.submissions.slice(0,8));
  const before=await observation({databaseId:bulk.databaseId,sourceRoot:bulk.sourceRoot});expect(await before.accept()).toMatchObject({state:'unconfirmed',reasons:['SOURCE_PREFIX_UNCONFIRMED']});
  await bulk.accept(bulk.submissions.slice(8));expect(await before.accept()).toMatchObject({state:'unconfirmed',reasons:['SOURCE_PREFIX_UNCONFIRMED']});
  const after=await observation({databaseId:bulk.databaseId,sourceRoot:bulk.sourceRoot});expect(await after.accept()).toMatchObject({state:'accepted',reasons:[]});
 });
});
