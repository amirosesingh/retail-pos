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
const reshapeBoundary=(b,operations)=>{const raw={...JSON.parse(b.payload),operations},payload=JSON.stringify(raw),graphAuthor=signed({...common,shiftId:shift,intentId:raw.intentId,action:raw.kind,payloadHash:hash(payload)},authorProtocol.intentMessage),proof=signed({...common,shiftId:shift,intentId:raw.intentId,action:raw.kind,graphPayloadHash:hash(payload),basisHash:hash(b.basis.basisJson),openingOrigin:origin,formula:'canonical-exact-decimal-v2'},financialProtocol.openingFinancialBasisMessage);return{payload,graphAuthor,basis:{basisJson:b.basis.basisJson,proof}};};
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
 storedSale={id:randomUUID(),branchId:'A',shiftId:shift,totalAmount:'100.0000',paymentType:'cash',paymentsJson:'[]',discountAmount:'0',isRefunded:false,rowVersion:'1'};
 const sale=event('SALE',null,storedSale);
 await test('actual registered author records immutable sale metadata without business or stock writes',async()=>{head=await send(sale);assert.equal(head.status,'financial_metadata_recorded');assert.equal(head.businessUploaded,false);assert.equal(await scalar('SELECT count(*)::int FROM sales'),0);});
 await test('lost-reply exact replay returns old acknowledgement without another node',async()=>{assert.deepEqual(await send(sale),head);assert.equal(await scalar('SELECT count(*)::int FROM fin62_history_preparation.nodes'),1);});
 await test('a second actual OPEN stream cannot claim the same unpublished global sale identity',async()=>{
  const device=randomUUID(),otherShift=randomUUID(),aggregate=randomUUID(),keyId=randomUUID(),keys=generateKeyPairSync('ed25519');
  await db.query("INSERT INTO terminal_tokens(id,location_id,status) VALUES($1,'A','active')",[device]);
  await scalar('SELECT pos_shift_author_enroll($1::jsonb,$2)',[JSON.stringify({...enrollment,keyId,terminalId:device,publicKey:keys.publicKey.export({format:'der',type:'spki'}).toString('base64url')}),author.subject]);
  const row2={...row,id:otherShift,terminal_id:device},raw=JSON.stringify(row2),envelope=JSON.stringify({version:1,localAggregateId:aggregate,branchId:'A',terminalId:device,shiftId:otherShift,rowHash:hash(raw),rowJson:raw});
  const localSign=fields=>({...fields,signature:sign(null,Buffer.from(operationProtocol.financialOperationMessage(fields)),keys.privateKey).toString('base64url')});
  const opened=await scalar('SELECT pos_sync_register_financial_open(p_batch=>$1,p_org=>$2,p_branch=>$3,p_terminal=>$4,p_local_aggregate=>$5,p_opening_json=>$6,p_row_hash=>$7,p_operations=>$8::jsonb,p_opening_envelope=>$9,p_proof=>$10::jsonb)',[randomUUID(),'default','A',device,aggregate,raw,hash(raw),JSON.stringify(operations(row2)),envelope,JSON.stringify(localSign({...common,keyId,terminalId:device,operationId:aggregate,action:'OPEN',payloadHash:hash(envelope)}))]);
  const event2={version:1,operationId:randomUUID(),branchId:'A',terminalId:device,shiftId:otherShift,openingOrigin:opened.openingOrigin,sequence:'1',predecessorOperationId:aggregate,predecessorHash:hash(raw),action:'SALE',changes:[{saleId:storedSale.id,before:null,after:{...storedSale,shiftId:otherShift}}]},text=JSON.stringify(event2);
  await assert.rejects(scalar('SELECT pos_sync_register_financial_event(p_org=>$1,p_branch=>$2,p_terminal=>$3,p_raw=>$4,p_proof=>$5::jsonb)',['default','A',device,text,JSON.stringify(localSign({...common,keyId,terminalId:device,operationId:event2.operationId,action:'SALE',payloadHash:hash(text)}))]),/BIRTH_ALREADY_CLAIMED/);
  assert.equal(await scalar('SELECT count(*)::int FROM fin62_history_preparation.nodes'),1);
  shadow={device,otherShift,aggregate,keyId,keys,opened};
 });
 await test('sequence gaps and forged before-images fail closed atomically',async()=>{await assert.rejects(send(event('REFUND',storedSale,{...storedSale,isRefunded:true,paymentType:'card'})),/FIELD_POLICY/);const gap=event('REFUND',storedSale,{...storedSale,isRefunded:true},{sequence:'3'});await assert.rejects(send(gap),/GAP_OR_CONFLICT/);const bad=event('REFUND',{...storedSale,totalAmount:'999'},{...storedSale,isRefunded:true});await assert.rejects(send(bad),/BEFORE_OR_SCOPE/);assert.equal(await scalar('SELECT count(*)::int FROM fin62_history_preparation.nodes'),1);});
 await test('strict number types, tampering, page denial and partial batches cannot advance head',async()=>{
  await assert.rejects(send(event('SALE',null,{...storedSale,id:randomUUID(),totalAmount:100})),/FACT_INVALID/);
  const tamper=event('SALE',null,{...storedSale,id:randomUUID()});tamper.raw+=' ';await assert.rejects(send(tamper),/AUTHOR_INVALID/);
  await db.query("UPDATE app_users SET permissions=permissions||'{\"page:register\":false}'::jsonb WHERE id=$1",[author.id]);await assert.rejects(send(event('SALE',null,{...storedSale,id:randomUUID()})),/PERMISSION_REVOKED/);await db.query("UPDATE app_users SET permissions=permissions-'page:register' WHERE id=$1",[author.id]);
  const partial=event('SALE',null,{...storedSale,id:randomUUID()});partial.value.changes.push({saleId:randomUUID(),before:null,after:storedSale});partial.raw=JSON.stringify(partial.value);partial.proof=signed({...common,operationId:partial.value.operationId,action:'SALE',payloadHash:hash(partial.raw)},operationProtocol.financialOperationMessage);await assert.rejects(send(partial),/BEFORE_OR_SCOPE/);assert.equal(await scalar('SELECT count(*)::int FROM fin62_history_preparation.nodes'),1);
  await assert.rejects(send({...sale,proof:{...sale.proof,signature:'A'.repeat(86)}}),/REPLAY_MISMATCH/);
 }); let first;
 await test('complete signed original CLOSE registers boundary only, not public closing or old graph receipt',async()=>{first=await boundary([storedSale]);const raw=JSON.parse(first.payload),activity={table:'activity_events',rows:[await typed('activity_events',{id:randomUUID(),store_id:'A',branch_id:'A',event_type:'shift_cash_variance',actor_name:author.subject,severity:'warning',title:'Synthetic variance',message:'',entity_type:'shift',entity_id:shift,meta:{},whatsapp_status:'skipped',created_at:new Date().toISOString()})],changes:[],deletePhase:false};
 await assert.rejects(register(reshapeBoundary(first,[...raw.operations,raw.operations[0]])),/BOUNDARY_INVALID/);
 await assert.rejects(register(reshapeBoundary(first,[...raw.operations,{...activity,rows:activity.rows.map(row=>({...row,entity_id:randomUUID()}))}])),/SYNC_BRANCH_FORBIDDEN/);
 await assert.rejects(register(reshapeBoundary(first,[...raw.operations,{...activity,rows:[...activity.rows,...activity.rows]}])),/GRAPH_DUPLICATE/);
 first=reshapeBoundary(first,[...raw.operations,activity].sort((a,b)=>({shifts:0,activity_events:0,shift_cash_counts:1,shift_close_events:1,shift_notifications:1,shift_reconciliations:2,shift_variance_alerts:3}[a.table]-{shifts:0,activity_events:0,shift_cash_counts:1,shift_close_events:1,shift_notifications:1,shift_reconciliations:2,shift_variance_alerts:3}[b.table])));head=await register(first);assert.equal(await scalar('SELECT graph_json FROM fin62_history_preparation.nodes WHERE operation_id=$1',[raw.intentId]),first.payload);assert.equal(head.status,'boundary_registered_not_shift_closed');assert.equal(head.shiftClosed,false);assert.equal(await scalar('SELECT status FROM shifts WHERE id=$1',[shift]),'OPEN');assert.equal(await scalar('SELECT count(*)::int FROM pos_sync_private.shift_intent_receipts'),0);});
 await test('later offline refund follows closing boundary while public shift stays open',async()=>{const value=event('REFUND',storedSale,{...storedSale,isRefunded:true,rowVersion:'9'});head=await send(value);storedSale=value.value.changes[0].after;assert.equal(head.sequence,'3');assert.equal(await scalar('SELECT count(*)::int FROM sales'),0);});
 await test('later recount uses complete refunded action snapshot',async()=>{head=await register(await boundary([storedSale],20,'RECOUNT'));assert.equal(head.sequence,'4');});
 await test('subset snapshots cannot omit a signed historical sale',async()=>{await assert.rejects(register(await boundary([],20,'RECOUNT')),/SNAPSHOT_INCOMPLETE/);});
 await test('final graph rejects registered history until actual complete business projection is published',async()=>{assert.equal(await scalar('SELECT count(*)::int FROM sales'),0);await assert.rejects(sendClosing(first),/BUSINESS_PUBLICATION_REQUIRED/);assert.equal(await scalar('SELECT status FROM shifts WHERE id=$1',[shift]),'OPEN');assert.equal(await scalar('SELECT count(*)::int FROM fin62_action_preparation.receipts'),0);}); const businessRow=await typed('sales',{id:storedSale.id,bill_number:'FIN62-ONLY',store_id:'A',shift_id:shift,total_amount:100,subtotal_amount:100,tax_amount:0,points_earned:0,points_redeemed:0,is_exchange:false,created_at:'2026-11-04T08:00:00Z',paid_amount:100,change_amount:0,exchange_credit:0,coupon_discount:0,rounding_adjustment:0,rounding_label:"",payment_type:'cash',payments:[],discount_amount:0,is_refunded:true,row_version:9});
 const businessOps=[{table:'sales',rows:[businessRow],changes:[],dependencyOrder:1}],businessBatch=randomUUID();
 const pushBusiness=()=>scalar('SELECT pos_sync_push_financial_business_aggregate(p_batch=>$1,p_org=>$2,p_branch=>$3,p_terminal=>$4,p_operations=>$5::jsonb)',[businessBatch,'default','A',terminal,JSON.stringify(businessOps)]);
 await test('unintegrated aliases denied for protected shift; refund permission alone cannot create unpublished sale',async()=>{
  await db.query('INSERT INTO fin62_history_preparation.protected_shifts VALUES($1,$2) ON CONFLICT DO NOTHING',[shift,'A']);
  await assert.rejects(db.query("INSERT INTO sales(id,bill_number,store_id,shift_id,total_amount) VALUES($1,'FORGED','A',$2,100)",[randomUUID(),shift]),/ALIAS_NOT_INTEGRATED/);
  await db.query("UPDATE app_users SET permissions=permissions-'can_process_sale' WHERE id=$1",[author.id]);
  await assert.rejects(pushBusiness(),/PERMISSION_REVOKED/);assert.equal(await scalar('SELECT count(*)::int FROM sales'),0);
  await db.query("UPDATE app_users SET permissions=permissions||'{\"can_process_sale\":true}'::jsonb WHERE id=$1",[author.id]);
 });
 await test('actual guarded business aggregate publishes current projection once, preserving historical closed basis',async()=>{assert.equal((await pushBusiness()).ok,true);assert.equal(await scalar('SELECT count(*)::int FROM sales'),1);assert.equal(await scalar('SELECT is_refunded FROM sales WHERE id=$1',[storedSale.id]),true);assert.equal(await scalar('SELECT count(*)::int FROM fin62_history_preparation.business_context'),0);assert.equal((await register(first)).sequence,'2');});
 await test('foreign baseline REFUND publishes with refund-only permission and proves legitimate later history',async()=>{
  const id=randomUUID(),fact={...storedSale,id,shiftId:shadow.otherShift,isRefunded:false,rowVersion:'1'},op=randomUUID();
  const signOther=(fields,keys)=>({...fields,signature:sign(null,Buffer.from(operationProtocol.financialOperationMessage(fields)),keys.privateKey).toString('base64url')});
  const raw=JSON.stringify({version:1,operationId:op,branchId:'A',terminalId:shadow.device,shiftId:shadow.otherShift,openingOrigin:shadow.opened.openingOrigin,sequence:'1',predecessorOperationId:shadow.aggregate,predecessorHash:shadow.opened.openingOrigin.rowHash,action:'SALE',changes:[{saleId:id,before:null,after:fact}]});
  await scalar('SELECT pos_sync_register_financial_event(p_org=>$1,p_branch=>$2,p_terminal=>$3,p_raw=>$4,p_proof=>$5::jsonb)',['default','A',shadow.device,raw,JSON.stringify(signOther({...common,keyId:shadow.keyId,terminalId:shadow.device,operationId:op,action:'SALE',payloadHash:hash(raw)},shadow.keys))]);
  const source={...businessRow,id,bill_number:'FOREIGN-REFUND',shift_id:shadow.otherShift,is_refunded:false,row_version:1},ops=[{table:'sales',rows:[source],changes:[],dependencyOrder:1}];
  await scalar('SELECT pos_sync_push_financial_business_aggregate(p_batch=>$1,p_org=>$2,p_branch=>$3,p_terminal=>$4,p_operations=>$5::jsonb)',[randomUUID(),'default','A',shadow.device,JSON.stringify(ops)]);
  const device=randomUUID(),keyId=randomUUID(),keys=generateKeyPairSync('ed25519');await db.query("INSERT INTO terminal_tokens(id,location_id,status) VALUES($1,'A','active')",[device]);
  await scalar('SELECT pos_shift_author_enroll($1::jsonb,$2)',[JSON.stringify({...enrollment,keyId,terminalId:device,publicKey:keys.publicKey.export({format:'der',type:'spki'}).toString('base64url')}),author.subject]);
  const baseline=await scalar('SELECT pos_sync_read_financial_basis(p_org=>$1,p_branch=>$2,p_terminal=>$3,p_shift=>$4)',['default','A',device,shadow.otherShift]),before=JSON.parse(baseline.basisJson).inputs[0],operationId=randomUUID();
  const refund=JSON.stringify({version:2,operationId,branchId:'A',terminalId:device,shiftId:shadow.otherShift,cloudOrigin:{serverBasisId:baseline.basisId,serverBasisHash:baseline.basisHash},sequence:'1',predecessorOperationId:baseline.basisId,predecessorHash:baseline.basisHash,action:'REFUND',changes:[{saleId:id,before,after:{...before,isRefunded:true,rowVersion:'2'}}]});
  await scalar('SELECT pos_sync_register_financial_event(p_org=>$1,p_branch=>$2,p_terminal=>$3,p_raw=>$4,p_proof=>$5::jsonb)',['default','A',device,refund,JSON.stringify(signOther({...common,keyId,terminalId:device,operationId,action:'REFUND',payloadHash:hash(refund)},keys))]);
  await db.query("UPDATE app_users SET permissions=permissions-'can_process_sale' WHERE id=$1",[author.id]);
  try{await scalar('SELECT pos_sync_push_financial_business_aggregate(p_batch=>$1,p_org=>$2,p_branch=>$3,p_terminal=>$4,p_operations=>$5::jsonb)',[randomUUID(),'default','A',device,JSON.stringify([{...ops[0],rows:[{...source,is_refunded:true,row_version:2}]}])]);}finally{await db.query("UPDATE app_users SET permissions=permissions||'{\"can_process_sale\":true}'::jsonb WHERE id=$1",[author.id]);}
  await db.query('SELECT fin62_history_preparation.require_published_projection($1,$2,$3,$4)',['default','A',shadow.device,shadow.otherShift]);
  assert.equal(await scalar('SELECT is_refunded FROM sales WHERE id=$1',[id]),true);
  shadow.saleFact=fact;shadow.saleOperation=op;shadow.saleHash=hash(raw);
 });
 if(native)await test('actual independent PostgreSQL retries serialize and stale competing frontiers are denied',async()=>{
  const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
  const sql=(device,raw,proof)=>`SELECT pos_sync_register_financial_event(p_org=>'default',p_branch=>'A',p_terminal=>${quote(device)},p_raw=>${quote(raw)},p_proof=>${quote(JSON.stringify(proof))}::jsonb);`;
  const replay=sql(terminal,sale.raw,sale.proof);await nativeDb.raceFinancial(replay,replay,null);
  const make=()=>{const operationId=randomUUID(),raw=JSON.stringify({version:1,operationId,branchId:'A',terminalId:shadow.device,shiftId:shadow.otherShift,openingOrigin:shadow.opened.openingOrigin,sequence:'2',predecessorOperationId:shadow.saleOperation,predecessorHash:shadow.saleHash,action:'REFUND',changes:[{saleId:shadow.saleFact.id,before:shadow.saleFact,after:{...shadow.saleFact,isRefunded:true,rowVersion:'2'}}]}),fields={...common,keyId:shadow.keyId,terminalId:shadow.device,operationId,action:'REFUND',payloadHash:hash(raw)},proof={...fields,signature:sign(null,Buffer.from(operationProtocol.financialOperationMessage(fields)),shadow.keys.privateKey).toString('base64url')};return sql(shadow.device,raw,proof);};
  await nativeDb.raceFinancial(make(),make(),'FIN62_HISTORY_GAP_OR_CONFLICT');
 });
 await test('same-branch second terminal seeds exact server-issued complete baseline, never forged own OPEN',async()=>{
  const other=randomUUID(),keyId=randomUUID(),otherKeys=generateKeyPairSync("ed25519");await db.query("INSERT INTO terminal_tokens(id,location_id,status) VALUES($1,'A','active')",[other]);
  const fields={...enrollment,keyId,terminalId:other,publicKey:otherKeys.publicKey.export({format:"der",type:"spki"}).toString("base64url")};await scalar('SELECT pos_shift_author_enroll($1::jsonb,$2)',[JSON.stringify(fields),author.subject]);
  const basis=await scalar('SELECT pos_sync_read_financial_basis(p_org=>$1,p_branch=>$2,p_terminal=>$3,p_shift=>$4)',['default','A',other,shift]);assert.equal(hash(basis.basisJson),basis.basisHash);assert.equal(basis.parentSnapshot.status,'OPEN');assert.equal(JSON.parse(basis.basisJson).inputs.length,1);
  const cloudOrigin={serverBasisId:basis.basisId,serverBasisHash:basis.basisHash},newSale={...storedSale,id:randomUUID(),isRefunded:false,totalAmount:'5'};
  const raw=JSON.stringify({version:2,operationId:randomUUID(),branchId:'A',terminalId:other,shiftId:shift,cloudOrigin,sequence:'1',predecessorOperationId:basis.basisId,predecessorHash:basis.basisHash,action:'SALE',changes:[{saleId:newSale.id,before:null,after:newSale}]}),parsed=JSON.parse(raw),proof=signed({...common,keyId,terminalId:other,operationId:parsed.operationId,action:'SALE',payloadHash:hash(raw)},operationProtocol.financialOperationMessage);
  proof.signature=sign(null,Buffer.from(operationProtocol.financialOperationMessage((({signature:_,...x})=>x)(proof))),otherKeys.privateKey).toString('base64url');
  const reply=await scalar('SELECT pos_sync_register_financial_event(p_org=>$1,p_branch=>$2,p_terminal=>$3,p_raw=>$4,p_proof=>$5::jsonb)',['default','A',other,raw,JSON.stringify(proof)]);assert.equal(reply.sequence,'1');
  assert.equal(await scalar('SELECT count(*)::int FROM fin62_history_preparation.stream_facts WHERE terminal_id=$1',[other]),2);
  const wrong={...parsed,operationId:randomUUID(),cloudOrigin:{...cloudOrigin,serverBasisHash:'a'.repeat(64)}};const text=JSON.stringify(wrong),badProof=signed({...common,keyId,terminalId:other,operationId:wrong.operationId,action:'SALE',payloadHash:hash(text)},operationProtocol.financialOperationMessage);
  badProof.signature=sign(null,Buffer.from(operationProtocol.financialOperationMessage((({signature:_,...x})=>x)(badProof))),otherKeys.privateKey).toString('base64url');
  await assert.rejects(scalar('SELECT pos_sync_register_financial_event(p_org=>$1,p_branch=>$2,p_terminal=>$3,p_raw=>$4,p_proof=>$5::jsonb)',['default','A',other,text,JSON.stringify(badProof)]),/ORIGIN_CONFLICT/);
  const closure=await boundary([...JSON.parse(basis.basisJson).inputs,newSale],25),graphRaw=JSON.parse(closure.payload);
  const cloudBasis={...JSON.parse(closure.basis.basisJson),financialFrontier:{cloudOrigin,sequence:'1',operationId:parsed.operationId,hash:hash(raw),reservedSequence:'2'}};
  closure.basis.basisJson=JSON.stringify(cloudBasis);
  const graphFields={...common,keyId,terminalId:other,shiftId:shift,intentId:graphRaw.intentId,action:'ORIGINAL',payloadHash:hash(closure.payload)};
  closure.graphAuthor={...graphFields,signature:sign(null,Buffer.from(authorProtocol.intentMessage(graphFields)),otherKeys.privateKey).toString('base64url')};
  const basisFields={...common,keyId,terminalId:other,shiftId:shift,intentId:graphRaw.intentId,action:'ORIGINAL',graphPayloadHash:hash(closure.payload),basisHash:hash(closure.basis.basisJson),serverBasisId:basis.basisId,formula:'canonical-exact-decimal-v2'};
  closure.basis.proof={...basisFields,signature:sign(null,Buffer.from(financialProtocol.financialBasisMessage(basisFields)),otherKeys.privateKey).toString('base64url')};
  const registered=await scalar('SELECT pos_sync_register_financial_boundary(p_org=>$1,p_branch=>$2,p_terminal=>$3,p_raw_graph=>$4,p_graph_author=>$5::jsonb,p_financial_basis=>$6::jsonb)',['default','A',other,closure.payload,JSON.stringify(closure.graphAuthor),JSON.stringify(closure.basis)]);
  assert.equal(registered.sequence,'2');assert.equal(registered.shiftClosed,false);
  await db.exec('BEGIN');try{
   const projection={...businessRow,id:newSale.id,bill_number:'SHARED-ONLY',total_amount:5,subtotal_amount:5,paid_amount:5,is_refunded:false};
   await scalar('SELECT pos_sync_push_financial_business_aggregate(p_batch=>$1,p_org=>$2,p_branch=>$3,p_terminal=>$4,p_operations=>$5::jsonb)',[randomUUID(),'default','A',other,JSON.stringify([{table:'sales',rows:[projection],changes:[],dependencyOrder:1}])]);
   const wire=Object.fromEntries(['version','intentId','shiftId','kind','baseToken','predecessorIntentId','predecessorIntentHash'].map(k=>[k,graphRaw[k]]));wire.payloadJson=closure.payload;
   const final=await scalar('SELECT pos_sync_push_financial_shift_intent($1,$2,$3,$4,NULL,$5::jsonb,$6::jsonb,$7::jsonb,NULL,NULL,$8::jsonb)',[graphRaw.intentId,'default','A',other,JSON.stringify(wire),JSON.stringify(closure.graphAuthor),JSON.stringify({allowed:true,authority:{authorId:author.id}}),JSON.stringify(closure.basis)]);
   assert.equal(final.financial_basis_receipt.ack_version,1);assert.equal(final.financial_basis_receipt.serverBasisId,basis.basisId);assert.equal(await scalar('SELECT expected_cash::text FROM shifts WHERE id=$1',[shift]),'25');
  }finally{await db.exec('ROLLBACK');}
  // Keep a genuine later, previously unknown foreign-terminal publication.
  // The original terminal's saved closing must remain valid at its own point.
  const laterProjection={...businessRow,id:newSale.id,bill_number:'SHARED-ONLY',total_amount:5,subtotal_amount:5,paid_amount:5,is_refunded:false};
  await scalar('SELECT pos_sync_push_financial_business_aggregate(p_batch=>$1,p_org=>$2,p_branch=>$3,p_terminal=>$4,p_operations=>$5::jsonb)',[randomUUID(),'default','A',other,JSON.stringify([{table:'sales',rows:[laterProjection],changes:[],dependencyOrder:1}])]);
 });
 await test('unknown legacy/public extras without guarded publication evidence hold final closing',async()=>{
  await db.exec('BEGIN');try{
   // Owned fixture deliberately simulates pre-capability legacy data only.
   await db.query('DELETE FROM fin62_history_preparation.protected_shifts WHERE shift_id=$1',[shift]);
   await db.query("INSERT INTO sales(id,bill_number,store_id,shift_id,total_amount,payment_type) VALUES($1,'UNPROVEN','A',$2,17,'cash')",[randomUUID(),shift]);
   await assert.rejects(sendClosing(first),/BUSINESS_PUBLICATION_REQUIRED/);
  }finally{await db.exec('ROLLBACK');}
 });
 if(native)await test('actual closing and business publication share the shift lock and reject a queued unpublished projection',async()=>{
  const quote=value=>"'"+String(value).replaceAll("'","''")+"'",raw=JSON.parse(first.payload),wire=Object.fromEntries(['version','intentId','shiftId','kind','baseToken','predecessorIntentId','predecessorIntentHash'].map(k=>[k,raw[k]]));wire.payloadJson=first.payload;
  const closing=`SELECT pos_sync_push_financial_shift_intent(${quote(raw.intentId)},'default','A',${quote(terminal)},NULL,${quote(JSON.stringify(wire))}::jsonb,${quote(JSON.stringify(first.graphAuthor))}::jsonb,${quote(JSON.stringify({allowed:true,authority:{authorId:author.id}}))}::jsonb,NULL,NULL,${quote(JSON.stringify(first.basis))}::jsonb);`;
  const invalid=[{table:'sales',rows:[{...businessRow,id:randomUUID(),bill_number:'UNPUBLISHED-QUEUED'}],changes:[],dependencyOrder:1}];
  const queued=`SELECT pos_sync_push_financial_business_aggregate(p_batch=>${quote(randomUUID())},p_org=>'default',p_branch=>'A',p_terminal=>${quote(terminal)},p_operations=>${quote(JSON.stringify(invalid))}::jsonb);`;
  await nativeDb.raceFinancial(closing,queued,'FIN62_FINANCIAL_PROJECTION_MISMATCH');assert.equal(await scalar('SELECT status FROM shifts WHERE id=$1',[shift]),'CLOSED');
 });
 await test('actual final graph adopts registered historical closing after later refund and proven unknown foreign sale, returns ACK2',async()=>{const result=await sendClosing(first);assert.equal(result.financial_basis_receipt.ack_version,2);assert.equal(result.financial_basis_receipt.openingOrigin.localAggregateId,local);assert.equal(await scalar('SELECT expected_cash::text FROM shifts WHERE id=$1',[shift]),'120');assert.equal(await scalar('SELECT status FROM shifts WHERE id=$1',[shift]),'CLOSED');});
  await test('current permission revocation denies NEW metadata but exact accepted event/boundary replay survives',async()=>{await db.query("UPDATE app_users SET permissions='{}' WHERE id=$1",[author.id]);assert.deepEqual(await send(sale),await scalar('SELECT acknowledgement FROM fin62_history_preparation.nodes WHERE operation_id=$1',[sale.value.operationId]));assert.equal((await register(first)).sequence,'2');await assert.rejects(send(event('SALE',null,{...storedSale,id:randomUUID(),isRefunded:false})),/PERMISSION_REVOKED/);await assert.rejects(register(await boundary([storedSale],20,'RECOUNT')),/PERMISSION_REVOKED/);});
 await test('key revocation preserves accepted immutable metadata replay only',async()=>{await db.query('UPDATE pos_sync_private.shift_author_keys SET revoked_at=now() WHERE key_id=$1',[author.keyId]);assert.equal((await sendClosing(first)).financial_basis_receipt.ack_version,2);assert.equal((await pushBusiness()).ok,true);assert.equal((await registerOpen()).ok,true);assert.equal((await send(sale)).sequence,'1');assert.equal((await register(first)).sequence,'2');await assert.rejects(send(event('SALE',null,{...storedSale,id:randomUUID(),isRefunded:false})),/AUTHOR_REVOKED/);});
 await test('private metadata cannot be edited and client roles cannot call service-only RPC',async()=>{await assert.rejects(db.exec('UPDATE fin62_history_preparation.nodes SET payload_hash=payload_hash'),/IMMUTABLE/);await assert.rejects(db.exec('UPDATE fin62_history_preparation.publications SET financial_fact=financial_fact'),/IMMUTABLE/);await assert.rejects(db.exec('UPDATE fin62_history_preparation.sale_steps SET after_fact=after_fact'),/IMMUTABLE/);for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await assert.rejects(send(sale),/permission denied/);await db.exec('RESET ROLE');}});
 console.log(passed+' isolated financial metadata/frontier groups passed; NOT active business integration or production readiness.');
}finally{await db.close();}
