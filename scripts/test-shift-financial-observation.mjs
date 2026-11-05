// FIN62 disposable actual guarded OPEN writer fixture only. No operator DB/network.
import assert from 'node:assert/strict';
import {randomUUID,createHash,generateKeyPairSync,sign,verify} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import Module from 'node:module';
import {dirname} from 'node:path';
const native=process.argv.slice(2).join(' ')==='--native';assert(process.argv.length===2||native,'Only --native fixture mode is accepted');
const require=createRequire(import.meta.url),read=p=>readFile(new URL('../'+p,import.meta.url),'utf8'),helperPath=require.resolve('./lib/shift-protocol-integration-fixture.cjs');
let{createCloud}=require(helperPath),nativeDb;
if(native){const source=await read('scripts/test-seven-shift-summary-native.fixture.mjs');
 const race=String.raw`raceFinancial:async(firstSQL,secondSQL,expectedError)=>{
  const holder=nativeSpawn(nativeJoin(bin,'psql.exe'),args,{env,windowsHide:true,stdio:['pipe','pipe','pipe']});let output='',errors='',ended=false,waiting;
  holder.stdout.on('data',chunk=>{output+=chunk;});holder.stderr.on('data',chunk=>{errors+=chunk;});const finished=new Promise(resolve=>holder.once('close',resolve));
  try{
   holder.stdin.write("BEGIN;SET LOCAL test.auth_role='service_role';"+firstSQL+"\n\\echo FIN62_LOCK_READY\n");
   const limit=Date.now()+10000;while(!output.includes('FIN62_LOCK_READY')){if(Date.now()>limit)throw Error('Financial holder timeout: '+errors);await new Promise(resolve=>setTimeout(resolve,20));}if(errors.includes('ERROR:'))throw Error(errors);
   waiting=execute(secondSQL).then(value=>({value}),error=>({error}));await new Promise(resolve=>setTimeout(resolve,150));
   if(command('psql',[...args,'-c','SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND cardinality(pg_blocking_pids(pid))>0);']).trim()!=='t')throw Error('Expected actual blocked financial transaction');
   holder.stdin.end('COMMIT;\n\\q\n');ended=true;await finished;if(errors.includes('ERROR:'))throw Error(errors);
   const result=await waiting;if(expectedError){if(!new RegExp(expectedError).test(result.error?.message??''))throw Error('Expected financial conflict, got '+(result.error?.message??result.value));}else if(result.error)throw result.error;
  }finally{if(!ended)holder.stdin.end('ROLLBACK;\n\\q\n');await finished;if(waiting)await waiting;}
 },`;
 assert(source.includes('close:async()=>{'));
 const factory=await import('data:text/javascript;base64,'+Buffer.from(source.replace('close:async()=>{',race+'\nclose:async()=>{')+'\nexport {createNativeFixture};').toString('base64'));nativeDb=await factory.createNativeFixture();globalThis.__fin62OriginFixture=nativeDb;
 const sourceCloud=await read('scripts/lib/shift-protocol-integration-fixture.cjs'),anchor="const db = new PGlite(), schema = read('supabase/schema.sql');";assert(sourceCloud.includes(anchor));const compiled=new Module(helperPath);compiled.filename=helperPath;compiled.paths=Module._nodeModulePaths(dirname(helperPath));compiled._compile(sourceCloud.replace(anchor,"const db = globalThis.__fin62OriginFixture, schema = read('supabase/schema.sql');"),helperPath);createCloud=compiled.exports.createCloud;}
const terminal=randomUUID(),shift=randomUUID(),local=randomUUID(),batch=randomUUID();let db;try{db=await createCloud('A',terminal);}catch(error){await nativeDb?.close();throw error;}finally{delete globalThis.__fin62OriginFixture;}
let passed=0;const test=async(name,run)=>{await run();passed++;console.log('PASS '+name);};const hash=text=>createHash('sha256').update(text).digest('hex');
const operations=row=>[{table:'shifts',rows:[row],changes:[],dependencyOrder:1}];
const opening=async(row,extra={})=>{const raw=extra.raw??JSON.stringify(row);return(await db.query('SELECT public.prototype_fin62_push_open_origin($1,$2,$3,$4,$5,$6,$7,$8::jsonb) value',[extra.batch??batch,'default',extra.branch??'A',extra.terminal??terminal,extra.local??local,raw,extra.hash??hash(raw),JSON.stringify(extra.operations??operations(row))])).rows[0].value;};
const counts=async()=>(await db.query('SELECT (SELECT count(*)::int FROM fin62_origin_preparation.origins) origins,(SELECT count(*)::int FROM fin62_origin_preparation.births) births,(SELECT count(*)::int FROM fin62_origin_preparation.active_context) pending')).rows[0];
const authorProtocol=require('../electron/security/shift-author-protocol.cjs'),financialProtocol=require('../electron/security/shift-financial-protocol.cjs'),operationProtocol=require('../electron/security/financial-author-protocol.cjs');
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const author={id:randomUUID(),keyId:randomUUID(),subject:'cashier',...generateKeyPairSync('ed25519')};
const common={version:1,algorithm:'Ed25519',keyId:author.keyId,projectOrigin:'https://fixture.supabase.co',terminalId:terminal,authorId:author.id,subject:author.subject,branchId:'A'};
const signed=(fields,message)=>{const signature=sign(null,Buffer.from(message(fields)),author.privateKey);assert(verify(null,Buffer.from(message(fields)),author.publicKey,signature));return {...fields,signature:signature.toString('base64url')};};
let origin,head,storedSale,shadow;
const event=(action,before,after,extra={})=>{const value={version:1,operationId:randomUUID(),branchId:'A',terminalId:terminal,shiftId:shift,openingOrigin:origin,sequence:String(Number(head.sequence)+1),predecessorOperationId:head.operationId,predecessorHash:head.payloadHash,action,changes:[{saleId:(after??before).id,before,after}],...extra};const raw=JSON.stringify(value),proof=signed({...common,operationId:value.operationId,action,payloadHash:hash(raw)},operationProtocol.financialOperationMessage);return{value,raw,proof};};
const send=value=>scalar('SELECT pos_sync_register_financial_event(p_org=>$1,p_branch=>$2,p_terminal=>$3,p_raw=>$4,p_proof=>$5::jsonb)',['default','A',terminal,value.raw,JSON.stringify(value.proof)]);
const typed=(name,row)=>scalar(`SELECT to_jsonb(jsonb_populate_record(NULL::public.${name},$1::jsonb))`,[JSON.stringify(row)]);
const boundary=async(inputs,expected=120,kind='ORIGINAL')=>{
 const id=randomUUID(),count=randomUUID(),time='2026-11-04T08:00:00Z',graph=await scalar('SELECT pos_sync_shift_graph($1,$2,$3,$4)',['default','A',terminal,shift]),ops=structuredClone(graph.tables);
 Object.assign(ops[0].rows[0],{status:'CLOSED',state:'CLOSED',closed_at:time,closed_by_name:author.subject,closed_by_staff_id:author.subject,counted_cash:expected,final_counted_cash:expected,closing_float:expected,counted_card:null,counted_digital:null,expected_cash:expected,expected_card:0,expected_digital:0,variance_cash:0,variance_card:null,variance_digital:null,variance_total:0,variance_status:'NO_VARIANCE',row_version:2});
 ops.find(p=>p.table==='shift_cash_counts').rows=[await typed('shift_cash_counts',{id:count,shift_id:shift,store_id:'A',terminal_id:terminal,kind,counted_cash:expected,counted_by_name:author.subject,counted_by_staff_id:author.subject,client_key:randomUUID(),created_at:time})];
 ops.find(p=>p.table==='shift_reconciliations').rows=[await typed('shift_reconciliations',{id:randomUUID(),shift_id:shift,store_id:'A',count_id:count,expected_cash:expected,expected_card:0,expected_digital:0,counted_cash:expected,variance_cash:0,variance_total:0,variance_status:'NO_VARIANCE',created_at:time})];
 ops.find(p=>p.table==='shift_close_events').rows=[];
 for(const[event,from,to]of(kind==='ORIGINAL'?[['cash_count_submitted','CASH_COUNT_REQUIRED','CASH_COUNT_SUBMITTED'],['reconciled','CASH_COUNT_SUBMITTED','CLOSED']]:[['recount_submitted','CLOSED','CLOSED']]))ops.find(p=>p.table==='shift_close_events').rows.push(await typed('shift_close_events',{id:randomUUID(),shift_id:shift,store_id:'A',terminal_id:terminal,event,from_state:from,to_state:to,detail:{count_id:count},actor_name:author.subject,actor_staff_id:author.subject,created_at:time}));
 const payload=JSON.stringify({version:1,intentId:id,shiftId:shift,kind,baseToken:graph.graphToken,predecessorIntentId:null,predecessorIntentHash:null,branchId:'A',operations:ops.map(p=>({...p,changes:[]}))});
 const graphAuthor=signed({...common,shiftId:shift,intentId:id,action:kind,payloadHash:hash(payload)},authorProtocol.intentMessage);
 const basis=JSON.stringify({prototypeVersion:2,formula:'canonical-exact-decimal-v2',branchId:'A',shiftId:shift,openingFloat:'20',inputs,versionReferences:[],financialFrontier:{openingOrigin:origin,sequence:head.sequence,operationId:head.operationId,hash:head.payloadHash,reservedSequence:String(Number(head.sequence)+1)}});
 const proof=signed({...common,shiftId:shift,intentId:id,action:kind,graphPayloadHash:hash(payload),basisHash:hash(basis),openingOrigin:origin,formula:'canonical-exact-decimal-v2'},financialProtocol.openingFinancialBasisMessage);
 return{payload,graphAuthor,basis:{basisJson:basis,proof}};
};
const register=b=>scalar('SELECT pos_sync_register_financial_boundary(p_org=>$1,p_branch=>$2,p_terminal=>$3,p_raw_graph=>$4,p_graph_author=>$5::jsonb,p_financial_basis=>$6::jsonb)',['default','A',terminal,b.payload,JSON.stringify(b.graphAuthor),JSON.stringify(b.basis)]);
  const sendClosing=b=>{const raw=JSON.parse(b.payload),wire=Object.fromEntries(['version','intentId','shiftId','kind','baseToken','predecessorIntentId','predecessorIntentHash'].map(k=>[k,raw[k]]));wire.payloadJson=b.payload;return scalar('SELECT pos_sync_push_financial_shift_intent($1,$2,$3,$4,NULL,$5::jsonb,$6::jsonb,$7::jsonb,NULL,NULL,$8::jsonb)',[raw.intentId,'default','A',terminal,JSON.stringify(wire),JSON.stringify(b.graphAuthor),JSON.stringify({allowed:true,authority:{authorId:author.id}}),JSON.stringify(b.basis)]);};

try{
 await db.exec("INSERT INTO stores VALUES('A','A'),('B','B');ALTER TABLE terminal_tokens ADD management_sync_enabled boolean DEFAULT false;SET pos.shift_fn='on'");
 await db.query("INSERT INTO shifts(id,store_id,terminal_id,status,state,opening_float,row_version,opened_at) VALUES($1,'A',$2,'OPEN','ACTIVE',20,1,now())",[shift,terminal]);await db.exec("SET pos.shift_fn=''");
 const row=await scalar('SELECT to_jsonb(s) FROM shifts s WHERE id=$1',[shift]);await db.query('DELETE FROM shifts WHERE id=$1',[shift]);
 const captures=JSON.parse(await read('scripts/fixtures/management-shift-read-validators.json'));for(const row of captures){assert.equal(hash(row.definition),row.sha256);await db.exec(row.definition);}
 for(const file of ['shift-financial-math-postgres.sql','shift-financial-cloud-receipts.sql','shift-financial-version-receipts.sql','shift-financial-known-basis.sql','shift-financial-opening-origin.sql','shift-financial-admission.sql','shift-financial-operation-history.sql'])await db.exec(await read('scripts/preparation/'+file));

 await db.query("INSERT INTO app_users(id,user_id,role,role_slug,permissions,is_active,store_id) VALUES($1,$2,'staff','cashier',$3::jsonb,true,'A')",[author.id,author.subject,JSON.stringify({can_open_shift:true,can_process_sale:true,can_process_refund:true,can_shift_cash_count:true,can_shift_cash_recount:true,can_close_shift:true})]);
 const enrollment={version:1,algorithm:'Ed25519',keyId:author.keyId,projectOrigin:common.projectOrigin,terminalId:terminal,authorId:author.id,publicKey:author.publicKey.export({format:'der',type:'spki'}).toString('base64url')};await scalar('SELECT pos_shift_author_enroll($1::jsonb,$2)',[JSON.stringify(enrollment),author.subject]);
 const openingRaw=JSON.stringify(row),openingEnvelope=JSON.stringify({version:1,localAggregateId:local,branchId:'A',terminalId:terminal,shiftId:shift,rowHash:hash(openingRaw),rowJson:openingRaw});
 const openingProof=signed({...common,operationId:local,action:'OPEN',payloadHash:hash(openingEnvelope)},operationProtocol.financialOperationMessage);
 const registerOpen=()=>scalar('SELECT pos_sync_register_financial_open(p_batch=>$1,p_org=>$2,p_branch=>$3,p_terminal=>$4,p_local_aggregate=>$5,p_opening_json=>$6,p_row_hash=>$7,p_operations=>$8::jsonb,p_opening_envelope=>$9,p_proof=>$10::jsonb)',[batch,'default','A',terminal,local,openingRaw,hash(openingRaw),JSON.stringify(operations(row)),openingEnvelope,JSON.stringify(openingProof)]);
 await test('actual signed OPEN delegates old write guard and records one immutable birth',async()=>{const ack=await registerOpen();assert.equal(ack.ok,true);origin=ack.openingOrigin;head={sequence:'0',operationId:local,payloadHash:origin.rowHash};assert.equal(await scalar('SELECT count(*)::int FROM fin62_history_preparation.open_author_receipts'),1);});
 storedSale={id:randomUUID(),branchId:'A',shiftId:shift,totalAmount:'100.000000000000',paymentType:'cash',paymentsJson:'[{"method":"cash","amount":"100.000000000000","note":"日本🙂 line next"}]',discountAmount:'0.000000000000',isRefunded:false,rowVersion:'9223372036854775806'};
 const canonical=value=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])):value);
 const mergedHash=rows=>hash(canonical([...rows].sort((a,b)=>a.id.toLowerCase()<b.id.toLowerCase()?-1:1)));
 const sources=new Map(),nativeMerge=require('../electron/db/shift-financial-observations.cjs').mergeFinancialObservation;
 const capture=async()=>{const value=await scalar('SELECT pos_sync_read_financial_basis(p_org=>$1,p_branch=>$2,p_terminal=>$3,p_shift=>$4)',['default','A',terminal,shift]);sources.set(value.basisId,value);return value;};
 const makeObservation=(basis,extra={})=>JSON.stringify({version:1,operationId:randomUUID(),branchId:'A',terminalId:terminal,shiftId:shift,openingOrigin:origin,sequence:String(Number(head.sequence)+1),predecessorOperationId:head.operationId,predecessorHash:head.payloadHash,action:'OBSERVE',observedBasis:{serverBasisId:basis.basisId,serverBasisHash:basis.basisHash},...extra});
 const observe=async raw=>{
  const body=JSON.parse(raw),prior=await scalar('SELECT count(*)::int FROM fin62_history_preparation.nodes WHERE operation_id=$1',[body.operationId]);let merged,error;
  if(!prior){
   const previous=(await db.query("SELECT sequence::text,pending_from FROM fin62_history_preparation.nodes WHERE node_kind='OBSERVATION' AND terminal_id=$1 AND shift_id=$2 ORDER BY sequence DESC LIMIT 1",[terminal,shift])).rows[0]??{sequence:'0',pending_from:{}};
   const versions=(await db.query("SELECT sale_id::text AS \"saleId\",operation_id::text AS \"operationId\",sequence::text AS sequence,raw_before AS before,raw_after AS after FROM fin62_history_preparation.sale_steps WHERE terminal_id=$1 AND shift_id=$2 AND (sequence>$3::bigint OR ($4::jsonb?sale_id::text AND sequence>=($4::jsonb->>sale_id::text)::bigint)) ORDER BY sequence",[terminal,shift,previous.sequence,JSON.stringify(previous.pending_from)])).rows;
   const source=sources.get(body.observedBasis.serverBasisId);try{merged=nativeMerge({serverBasisJson:source.basisJson,versions,ownPublishedThrough:source.ownPublishedThrough});}catch(value){error=value;}
  }
  const ack=await scalar('SELECT pos_sync_register_financial_observation(p_org=>$1,p_branch=>$2,p_terminal=>$3,p_raw=>$4)',['default','A',terminal,raw]);
  if(!prior){assert.equal(error,undefined,'SQL accepted a source/own merge rejected by the actual Native pure merger');assert.equal(ack.computedMergedHash,merged.computedMergedHash);assert.equal(ack.pendingFromHash,merged.pendingFromHash);}
  return ack;
 };
 const state=()=>scalar('SELECT fin62_history_preparation.stream_state($1,$2,$3,$4)',['default','A',terminal,shift]);
 const assertAck=(ack,rows,pending)=>{assert.equal(ack.status,'financial_metadata_observed');assert.equal(ack.businessUploaded,false);assert.equal(ack.shiftClosed,false);assert.equal(ack.computedMergedHash,mergedHash(rows));assert.equal(ack.pendingFromHash,hash(canonical(pending)));};
 const sale=event('SALE',null,storedSale);head=await send(sale);
 const savedClosing=await boundary([storedSale]);head=await register(savedClosing);const originalBasis=savedClosing.basis.basisJson;
 let oldSource,latestSource,firstRaw;const extraSource=[];
 await test('complete actual empty cloud snapshot merges an unpublished own sale without business writes',async()=>{oldSource=await capture();assert(Object.values(oldSource.sourceEvidence).every(v=>typeof v==='string'));firstRaw=makeObservation(oldSource);head=await observe(firstRaw);assertAck(head,[storedSale,...extraSource],{[storedSale.id]:sale.value.sequence});assert.deepEqual(Object.values(await state()),[storedSale]);assert.equal(await scalar('SELECT count(*)::int FROM sales'),0);});
 await test('accepted observation exact replay returns immutable hash receipt',async()=>{assert.deepEqual(await observe(firstRaw),head);await assert.rejects(observe(firstRaw+' '),/REPLAY_MISMATCH/);});
 await test('repeated actual source snapshots carry earlier unpublished own work across observations',async()=>{latestSource=await capture();head=await observe(makeObservation(latestSource));assertAck(head,[storedSale,...extraSource],{[storedSale.id]:sale.value.sequence});});
 const saleRow=await typed('sales',{id:storedSale.id,bill_number:'OBS-SALE',store_id:'A',shift_id:shift,total_amount:100,subtotal_amount:100,tax_amount:0,discount_amount:0,points_earned:0,points_redeemed:0,is_exchange:false,is_refunded:false,created_at:'2026-11-04T08:00:00Z',paid_amount:100,change_amount:0,exchange_credit:0,coupon_discount:0,rounding_adjustment:0,rounding_label:'',payment_type:'cash',payments:JSON.parse(storedSale.paymentsJson),row_version:1});
 const publish=(row,batch=randomUUID())=>scalar('SELECT pos_sync_push_financial_business_aggregate(p_batch=>$1,p_org=>$2,p_branch=>$3,p_terminal=>$4,p_operations=>$5::jsonb)',[batch,'default','A',terminal,JSON.stringify([{table:'sales',rows:[row],changes:[],dependencyOrder:1}])]);
 await test('per-sale publication evidence cannot retire another earlier unpublished sale',async()=>{
  const otherFact={...storedSale,id:randomUUID(),totalAmount:'7',paymentsJson:'[]',rowVersion:'1'},item=event('SALE',null,otherFact);head=await send(item);
  await publish({...saleRow,id:otherFact.id,bill_number:'OBS-B',total_amount:7,subtotal_amount:7,paid_amount:7,payments:[],row_version:1});
  const source=await capture();assert.equal(Object.hasOwn(source.ownPublishedThrough,storedSale.id),false);assert(BigInt(source.ownPublishedThrough[otherFact.id])>=BigInt(item.value.sequence));
  extraSource.push(...JSON.parse(source.basisJson).inputs);head=await observe(makeObservation(source));assertAck(head,[storedSale,...extraSource],{[storedSale.id]:sale.value.sequence});
 }); await publish(saleRow);
 const refund=event('REFUND',storedSale,{...storedSale,isRefunded:true,rowVersion:'9223372036854775807'});head=await send(refund);storedSale=refund.value.changes[0].after;
 await test('source matching an own intermediate prefix retains only its unpublished refund suffix',async()=>{latestSource=await capture();head=await observe(makeObservation(latestSource));assertAck(head,[storedSale,...extraSource],{[storedSale.id]:refund.value.sequence});});
 await test('old carried refund remains pending on another unchanged source read',async()=>{latestSource=await capture();head=await observe(makeObservation(latestSource));assertAck(head,[storedSale,...extraSource],{[storedSale.id]:refund.value.sequence});});
 await publish({...saleRow,is_refunded:true,row_version:2});
 await test('visible actual publication retires own pending suffix and chooses exact source raw values',async()=>{latestSource=await capture();head=await observe(makeObservation(latestSource));const actual=JSON.parse(latestSource.basisJson).inputs;assertAck(head,actual,{});assert.deepEqual(Object.values(await state()),actual);});
 await test('older actual source receipt cannot rewind a newer observed source',async()=>{await assert.rejects(observe(makeObservation(oldSource)),/SOURCE_STALE/);});
 await test('new foreign actual rows enter the complete snapshot while old closing proof remains unchanged',async()=>{
  await db.query("INSERT INTO sales(id,bill_number,store_id,shift_id,total_amount,payment_type,discount_amount) VALUES($1,'FOREIGN-OBS','A',$2,5,'cash',0)",[randomUUID(),shift]);
  latestSource=await capture();head=await observe(makeObservation(latestSource));assertAck(head,JSON.parse(latestSource.basisJson).inputs,{});assert.equal((await scalar('SELECT basis_json FROM fin62_history_preparation.nodes WHERE operation_id=$1',[JSON.parse(savedClosing.payload).intentId])),originalBasis);assert.equal(await scalar('SELECT status FROM shifts WHERE id=$1',[shift]),'OPEN');
 });
 await test('materialized earlier own work no longer blocks legitimate later source changes',async()=>{
  await db.query('UPDATE sales SET total_amount=101 WHERE id=$1',[storedSale.id]);latestSource=await capture();head=await observe(makeObservation(latestSource));assertAck(head,JSON.parse(latestSource.basisJson).inputs,{});
 });
 await test('same transaction source order accepts later helper evidence and denies earlier evidence',async()=>{
  const savedHead=head;await db.exec('BEGIN');try{
   const one=await capture();head=await observe(makeObservation(one));const two=await capture();assert.equal(two.sourceEvidence.creatorXid,one.sourceEvidence.creatorXid);assert(BigInt(two.sourceEvidence.evidenceOrder)>BigInt(one.sourceEvidence.evidenceOrder));head=await observe(makeObservation(two));await assert.rejects(observe(makeObservation(one)),/SOURCE_STALE/);
  }finally{await db.exec('ROLLBACK');head=savedHead;}
 }); await test('new divergence against still-pending own changes is held without changing the head',async()=>{
  const input=JSON.parse(latestSource.basisJson).inputs.find(r=>r.id!==storedSale.id),pending=event('REFUND',input,{...input,isRefunded:true,rowVersion:'99'});head=await send(pending);
  await db.query('UPDATE sales SET total_amount=6 WHERE id=$1',[input.id]);const source=await capture(),before=await state();await assert.rejects(observe(makeObservation(source)),/MERGE_DIVERGED/);assert.deepEqual(await state(),before);
 });
 await test('unproven source hash, wrong branch and client write-authority flags are denied',async()=>{const source=await capture();await assert.rejects(observe(makeObservation(source,{observedBasis:{serverBasisId:source.basisId,serverBasisHash:'a'.repeat(64)}})),/SOURCE_UNPROVEN/);await assert.rejects(observe(makeObservation(source,{branchId:'B'})),/OBSERVATION_INVALID/);await assert.rejects(observe(makeObservation(source,{authorized:true})),/OBSERVATION_INVALID/);});
 console.log(passed+' isolated complete-source observation groups passed. No business replay, checkpoint reset or live activation.');
}finally{await db.close();}
