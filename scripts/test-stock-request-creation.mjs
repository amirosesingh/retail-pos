// Disposable PostgreSQL and actual source callbacks only; no connection profile.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';
import {createSourceFile,isFunctionDeclaration,ModuleKind,ScriptKind,ScriptTarget,transpileModule} from 'typescript';
import {PGlite} from '@electric-sql/pglite';
import {fixtureSql,migration,seedSql,ids,quote,sourceFunction,liveOverlaySql} from './fixtures/transfer-dispatch-fixture.mjs';
const read=async path=>(await readFile(new URL('../'+path,import.meta.url),'utf8')).replaceAll('\r\n','\n');
const stableSource=await read('src/core/api/pos-db.ts');
const sourceFile=createSourceFile('source.ts',stableSource,ScriptTarget.Latest,true,ScriptKind.TS);
const stableText=sourceFile.statements.find(node=>isFunctionDeclaration(node)&&node.name?.text==='stableChildId').getText(sourceFile).replace(/^export /,'');
const stableContext={crypto:globalThis.crypto};runInNewContext(transpileModule(stableText+';globalThis.stable=stableChildId;',{compilerOptions:{target:ScriptTarget.ES2022}}).outputText,stableContext);
const stableChildId=stableContext.stable;
const helperCode=await read('src/lib/stock-request-identity.ts');
const provider=await read('src/lib/pos-store.tsx');
const callbacks=provider.slice(provider.indexOf('  const createTransferRef ='),provider.indexOf('  /**\n   * Dispatch:',provider.indexOf('  const createTransferRef =')));
const persistence=await read('src/lib/stock-transfers.ts');
const approvalSql=await read('scripts/fixtures/transfer-creation-approval.sql');
const parentGuard=await read('supabase/migrations/20261031080149_prevent_transfer_line_reparenting.sql');
const parent='ffc1465d-eb97-42d5-98ae-b937fb90b708';
let passed=0;
function moduleFrom(source,require=()=>{throw new Error('Unexpected fixture import');},extra={}){
 const exports={};const context={exports,require,console,crypto:globalThis.crypto,TextEncoder,...extra};
 runInNewContext(transpileModule(source.replaceAll('import.meta.env.DEV','false'),{compilerOptions:{module:ModuleKind.CommonJS,target:ScriptTarget.ES2022}}).outputText,context);return exports;
}
const identity=moduleFrom(helperCode);
const saleIdentity=moduleFrom(await read('src/lib/sale-identity.ts'));
const branchIdentity=moduleFrom(await read('src/lib/branch-id.ts'),()=>saleIdentity);
const contract=moduleFrom(await read('src/lib/stock-request-contract.ts'),name=>name==='./sale-identity'?saleIdentity:branchIdentity);
const literal=value=>value===null?'NULL':typeof value==='number'?String(value):quote(value);
async function harness({guard=true,native=false,legacy=false}={}){
 const db=new PGlite();await db.exec(fixtureSql);
 const live=process.argv.indexOf('--live-definitions');
 if(live>=0)await db.exec((await liveOverlaySql(process.argv[live+1],process.argv[live+2])).sql);
 await db.exec(approvalSql);await db.exec(seedSql({request:false}));await db.exec('DELETE FROM stock_transfer_items;DELETE FROM stock_transfers;');
 await db.exec('BEGIN;'+migration+'COMMIT;');if(guard)await db.exec('BEGIN;'+parentGuard+'COMMIT;');
 if(native)await db.exec("SELECT set_config('test.uid','',false),set_config('test.role','service_role',false),set_config('test.email','',false)");
 let state={transfers:[],transferCounter:0,currentStoreId:'A',stores:[{id:'A',code:'A',name:'Source',groupId:'sports'},{id:'B',code:'B',name:'Destination',groupId:'sports'}],products:[{id:ids.product,name:'Fixture',sku:'FXSKU',barcode:'FX-1',cost:1}],settings:{integrations:{}}};
 const ref={current:state},generation={current:1};
 const control={epoch:1,failChild:false,loseChild:false,loseApproval:false,lookupError:false,onLookup:null,identity:null,approvalCalls:0,childWrites:0,history:0,reads:[],references:0,deferUpdates:false,updates:[]};
 const commitOps=async(_label,ops)=>{
  const child=ops.some(op=>op.table==='stock_transfers'&&op.rows?.some(row=>row.kind==='transfer'));
  if(child&&control.failChild){control.failChild=false;throw new Error('Fixture interrupted child save');}
  await db.exec('BEGIN;');try{
   for(const op of ops){assert.equal(op.kind,'upsert');for(const row of op.rows){const keys=Object.keys(row);await db.exec(`INSERT INTO public.${op.table}(${keys.join(',')}) VALUES(${keys.map(key=>literal(row[key])).join(',')}) ON CONFLICT(id) DO UPDATE SET ${keys.filter(key=>key!=='id').map(key=>`${key}=EXCLUDED.${key}`).join(',')}`);}}
   await db.exec('COMMIT;');
  }catch(error){await db.exec('ROLLBACK;');throw error;}
  if(child)control.childWrites++;
  if(child&&control.loseChild){control.loseChild=false;throw new Error('Fixture lost child acknowledgement');}
 };
 const routedQuery=async(table,options)=>{
  control.reads.push({table,options});
  if(options.match?.source_request_id){if(control.lookupError)throw new Error('Fixture read failure');if(control.onLookup)await control.onLookup();}
  const tests=Object.entries(options.match??{}).map(([key,value])=>`${key}=${literal(value)}`);
  if(options.in)tests.push(`${options.in.column} IN(${options.in.values.map(literal).join(',')})`);
  return(await db.query(`SELECT * FROM public.${table}${tests.length?' WHERE '+tests.join(' AND '):''}${options.orderBy?' ORDER BY '+options.orderBy.column:''} LIMIT ${options.limit??1000} OFFSET ${options.offset??0}`)).rows;
 };
 const central={from:table=>{
  const options={match:{},limit:1000,offset:0};
  const chain={select:()=>chain,eq:(key,value)=>{options.match[key]=value;return chain;},order:column=>{options.orderBy={column};return chain;},
   limit:value=>{options.limit=value;return chain;},range:(start,end)=>{options.offset=start;options.limit=end-start+1;return chain;},
   then:(resolve,reject)=>(async()=>{const data=await routedQuery(table,options);const tests=Object.entries(options.match).map(([key,value])=>`${key}=${literal(value)}`).join(' AND ');const count=(await db.query(`SELECT count(*)::int n FROM ${table}${tests?' WHERE '+tests:''}`)).rows[0].n;return{data,count,error:null};})().then(resolve,reject)};
  return chain;
 }};
 const centralState=async requestId=>{
  try{
   const fulfilments=await routedQuery('stock_transfers',{match:{source_request_id:requestId},limit:2});if(fulfilments.length>1)return{ok:false};
   const request=(await routedQuery('stock_transfers',{match:{id:requestId},limit:1}))[0],fulfilment=fulfilments[0]??null;
   const requestItems=await routedQuery('stock_transfer_items',{match:{transfer_id:requestId},limit:2000});
   const fulfilmentItems=fulfilment?await routedQuery('stock_transfer_items',{match:{transfer_id:fulfilment.id},limit:2000}):[];
   return{ok:true,row:{request,fulfilment,requestItems,fulfilmentItems}};
  }catch{return{ok:false};}
 };
 const rpc=async(fn,args)=>{
  control.approvalCalls++;try{
   await db.query(`SELECT public.${fn}(${Object.entries(args).map(([key,value])=>`${key} => ${value===null?'NULL':typeof value==='object'?quote(JSON.stringify(value))+'::jsonb':literal(value)}`).join(',')})`);
   if(control.loseApproval){control.loseApproval=false;return{error:{code:'NETWORK_ERROR',message:'Fixture lost approval acknowledgement'},status:503};}
   return{data:null,error:null};
  }catch(error){return{error:{code:error.code,message:error.message},status:400};}
 };
 const relay=async op=>{
  const result=await rpc('stock_transfer_approve_for_staff',{p_transfer_id:op.args.p_transfer_id,p_staff_user_id:'dispatcher',p_bound_store_id:'A',p_lines:op.args.p_lines});
  return result.error?{ok:false,error:'Fixture approval failed',code:result.error.code}:{ok:true};
 };
 const dependencies={
  '@/core/api/pos-db':{commitOps,stableChildId},'@/core/api/db-query':{routedQuery},'./notify':{describeError:()=> 'Fixture approval failure'},
  '@/integrations/supabase/external-client':{supabaseExternal:{rpc},authenticatedExternalClientSnapshot:async()=>central},'@/platform-config/platform':{isTerminalApp:()=>native},
  '@/core/api/sync-relay':{relayOp:relay,relayTransferRequestApprovalState:centralState},'./session-epoch':{sessionEpoch:()=>control.epoch},'./sale-identity':saleIdentity,'./transfer-dispatch-result':{},'./stock-request-contract':contract,
  '@/core/local-db/db-mode':{effectiveDatabaseMode:()=> 'cloud'},'@/core/local-db/local-db':{localDb:()=>null},'./branch-id':branchIdentity,
 };
 const storage=moduleFrom(persistence,name=>{assert(name in dependencies,name);return dependencies[name];});
 let sequence=0;
 const context={useRef:value=>({current:value}),useCallback:fn=>fn,stateRef:ref,scopeRef:{current:{}},actorRef:{current:'Authorized Dispatcher'},
  bootstrapGeneration:generation,sessionEpoch:()=>control.epoch,sameRecordId:saleIdentity.sameRecordId,sameBranchId:branchIdentity.sameBranchId,
  setState:update=>{if(control.deferUpdates)control.updates.push(update);else{state=update(state);ref.current=state;}},scopeBetween:storage.scopeBetween,
  resolveScopedSettings:settings=>({settings}),mergePatch:()=>{},saveTransfer:storage.saveTransfer,loadTransfer:storage.loadTransfer,loadRequestApprovalState:storage.loadRequestApprovalState,
  approveTransferInDb:storage.approveTransferInDb,stableChildId,stockRequestFulfilmentId:requestId=>control.identity?control.identity(requestId):legacy?Promise.resolve(stableChildId(requestId,'8',0)):identity.stockRequestFulfilmentId(requestId),
  logger:{log:()=>{}},recordActivity:()=>{},trackTransition:()=>{control.history++;},crypto:globalThis.crypto,
  require:name=>{assert.equal(name,'./stock-ref');return{nextStockRef:async()=>{control.references++;return`FIXTURE-${++sequence}`;}};},exports:{},
 };
 runInNewContext(transpileModule(callbacks+';globalThis.actions={create:createTransfer,approve:approveTransfer};',{compilerOptions:{module:ModuleKind.CommonJS,target:ScriptTarget.ES2022}}).outputText,context);
 return{db,control,generation,storage,actions:context.actions,state:()=>state,
  replace:next=>{state=next;ref.current=state;},
  create:()=>context.actions.create({kind:'request',fromStoreId:'A',toStoreId:'B',items:[{productId:ids.product,qty:1}],note:'Fixture request',createdBy:'Requester',needsApproval:true,forcedId:parent}),
  rows:async()=> (await db.query('SELECT id,transfer_id,product_id,quantity,quantity_approved FROM stock_transfer_items ORDER BY transfer_id,id')).rows,
  stock:async()=> (await db.query(`SELECT stock_by_store,stock_quantity,owner_store_id,sku,cost_price,selling_price FROM products WHERE id='${ids.product}'`)).rows[0],
 };
}
async function scenario(name,work,options){const app=await harness(options);try{await work(app);passed++;console.log('PASS '+name);}finally{await app.db.close();}}
try{
 const expected='73b5364c-0521-85a9-8862-e59a193592bd';
 assert.equal(await identity.stockRequestFulfilmentId(parent),expected);assert.equal(await identity.stockRequestFulfilmentId(parent.toUpperCase()),expected);
 const independent=createHash('sha256').update('retail-pos:stock-request-fulfilment:v1:'+parent).digest();assert.equal(expected.slice(0,8),independent.toString('hex').slice(0,8));
 const sibling=parent.slice(0,-1)+'9';assert.notEqual(await identity.stockRequestFulfilmentId(sibling),expected);
 assert.notEqual(stableChildId(expected,'6',0),stableChildId(parent,'6',0));passed++;console.log('PASS full-request/domain/case/known-hash identity');
 await scenario('OLD real create/save/approve steals the parent line without moving stock',async app=>{
  await app.create();const before=await app.stock();assert.equal((await app.rows())[0].transfer_id,parent);
  assert.equal((await app.actions.approve(parent)).success,true);
  const rows=await app.rows();assert.equal(rows.length,1);assert.equal(rows[0].transfer_id,stableChildId(parent,'8',0));assert.deepEqual(await app.stock(),before);
  await assert.rejects(()=>app.db.query(`SELECT public.stock_transfer_dispatch_atomic('${rows[0].transfer_id}',NULL,'[{"product_id":"${ids.product}","qty":1}]')`),error=>error.message==='TRANSFER_REQUEST_INVALID');
 },{guard:false,legacy:true});
 for(const native of [false,true])await scenario(`NEW real create/save/approve retains both documents (native=${native})`,async app=>{
  await app.create();const before=await app.stock();assert.equal((await app.actions.approve(parent.toUpperCase())).success,true);
  const rows=await app.rows();assert.equal(rows.length,2);assert.notEqual(rows[0].id,rows[1].id);assert(rows.some(row=>row.transfer_id===parent));assert(rows.some(row=>row.transfer_id===expected));
  assert.equal(app.state().transfers.find(row=>row.id===parent).status,'approved');assert.deepEqual(await app.stock(),before);assert.equal(app.control.approvalCalls,1);
  assert(app.control.reads.some(read=>read.options.match?.source_request_id===parent&&read.options.limit===2));
  await app.actions.approve(parent);assert.equal((await app.rows()).length,2);assert.equal(app.control.approvalCalls,1);assert.equal(app.control.childWrites,1);
 },{native});
 await scenario('legacy durable child missing from cache is adopted without a new child or approval',async app=>{
  await app.create();app.control.identity=requestId=>Promise.resolve(stableChildId(requestId,'8',0));
  await assert.rejects(()=>app.actions.approve(parent),/TRANSFER_LINE_PARENT_IMMUTABLE/);
  // Isolated legacy fixture with distinct lines represents a pre-existing valid child.
  const legacyId=stableChildId(parent,'8',0);await app.db.exec(`INSERT INTO stock_transfers(id,ref,kind,status,from_store_id,to_store_id,source_request_id,created_by) VALUES('${legacyId}','ST-LEGACY','transfer','approved','A','B','${parent}','Legacy');INSERT INTO stock_transfer_items(id,transfer_id,product_id,quantity,quantity_approved) VALUES('${ids.child}','${legacyId}','${ids.product}',1,1);`);
  const stale=app.state().transfers.find(row=>row.id===parent);app.replace({...app.state(),transfers:[{...stale,status:'awaiting_approval'}]});app.control.identity=()=>{throw new Error('Hash must not run');};
  assert.equal((await app.actions.approve(parent)).success,true);assert.equal(app.state().transfers.some(row=>row.id===legacyId),true);assert.equal(app.control.childWrites,0);assert.equal(app.control.approvalCalls,1);
 });
 for(const loss of ['loseApproval','failChild','loseChild'])await scenario(`${loss} retry adopts durable approval/child without duplicate writes`,async app=>{
  await app.create();const before=await app.stock();app.control[loss]=true;
  try{await app.actions.approve(parent);}catch{ /* Interrupted child save is returned to its normal caller. */ }
  app.replace({...app.state(),transfers:app.state().transfers.filter(row=>row.kind==='request')});
  assert.equal((await app.actions.approve(parent,[{productId:ids.product,qty:99}])).success,true);
  assert.equal((await app.rows()).length,2);assert.equal(app.control.approvalCalls,1);assert.equal(app.control.childWrites,1);assert.deepEqual(await app.stock(),before);
 });
 await scenario('digest failure before approval writes and zero-approved request without crypto',async app=>{
  await app.create();app.control.identity=()=>Promise.reject(new Error('PRIVATE crypto failure'));const before=await app.rows();
  assert.equal((await app.actions.approve(parent)).success,false);assert.equal(app.control.approvalCalls,0);assert.deepEqual(await app.rows(),before);
  assert.equal((await app.actions.approve(parent,[{productId:ids.product,qty:0}])).success,true);assert.equal(app.control.childWrites,0);assert.equal(app.control.approvalCalls,1);
 });
 for(const pendingId of [stableChildId(parent,'8',0),expected])await scenario(`cached pending child ${pendingId} blocks replacement before identity/ref/approval`,async app=>{
  const request=await app.create();app.replace({...app.state(),transfers:[request,{...request,id:pendingId,kind:'transfer',status:'approved',sourceRequestId:parent}]});
  const references=app.control.references;app.control.identity=()=>{throw new Error('New identity must not run');};
  assert.equal((await app.actions.approve(parent)).success,false);assert.equal(app.control.approvalCalls,0);assert.equal(app.control.childWrites,0);assert.equal(app.control.references,references);assert.equal((await app.rows()).length,1);
 });
 for(const change of ['epoch','branch','generation'])await scenario(`late ${change} change stops before approval or child write`,async app=>{
  await app.create();app.control.onLookup=()=>{if(change==='epoch')app.control.epoch++;else if(change==='generation')app.generation.current++;else app.replace({...app.state(),currentStoreId:'B'});};
  assert.equal((await app.actions.approve(parent)).code,'SESSION_CHANGED');assert.equal(app.control.approvalCalls,0);assert.equal(app.control.childWrites,0);
 });
 await scenario('a queued legacy reconciliation cannot overwrite a later branch state',async app=>{
  await app.create();await app.actions.approve(parent);app.replace({...app.state(),transfers:app.state().transfers.filter(row=>row.kind==='request')});
  app.control.deferUpdates=true;assert.equal((await app.actions.approve(parent)).success,true);assert.equal(app.control.updates.length,1);
  const next={...app.state(),currentStoreId:'B'};app.replace(next);app.generation.current++;
  assert.equal(app.control.updates[0](next),next);assert.equal(app.control.childWrites,1);assert.equal(app.control.approvalCalls,1);
 });
 await scenario('session change during digest preparation stops before approval',async app=>{
  await app.create();app.control.identity=async()=>{app.control.epoch++;return expected;};
  assert.equal((await app.actions.approve(parent)).code,'SESSION_CHANGED');assert.equal(app.control.approvalCalls,0);assert.equal(app.control.childWrites,0);
 });
 await scenario('ambiguous/missing/denied durable reads fail closed',async app=>{
  await app.create();app.control.lookupError=true;assert.equal((await app.actions.approve(parent)).success,false);assert.equal(app.control.approvalCalls,0);
  app.control.lookupError=false;await app.db.exec(`DELETE FROM stock_transfer_items;DELETE FROM stock_transfers WHERE id='${parent}'`);
  assert.equal((await app.actions.approve(parent)).success,false);assert.equal(app.control.approvalCalls,0);
 });
 for(const native of [false,true])await scenario(`actual sync item upsert permits same-parent retries and refuses reassignment (native=${native})`,async app=>{
  await app.create();const before=await app.stock();await app.db.exec(sourceFunction('public.sync_apply_stock_transfer_items'));
  const line=(await app.db.query('SELECT * FROM stock_transfer_items')).rows[0];
  const apply=async row=>(await app.db.query(`SELECT public.sync_apply_stock_transfer_items(${quote(JSON.stringify([row]))}::jsonb) n`)).rows[0].n;
  assert.equal(await apply({...line,quantity:2,row_version:line.row_version+3}),1);
  const updated=(await app.db.query('SELECT * FROM stock_transfer_items')).rows[0];assert.equal(updated.transfer_id,parent);assert.equal(updated.quantity,2);
  await app.db.exec(`INSERT INTO stock_transfers(id,ref,kind,status,from_store_id,to_store_id,created_by) VALUES('${ids.child}','OTHER','transfer','draft','A','B','Fixture');`);
  assert.equal(await apply({...line,transfer_id:ids.child,row_version:0}),0);
  const valid=(await app.db.query('SELECT * FROM stock_transfer_items')).rows;
  await assert.rejects(()=>apply({...updated,transfer_id:ids.child,row_version:updated.row_version+1}),error=>error.code==='23514'&&error.message==='TRANSFER_LINE_PARENT_IMMUTABLE');
  assert.deepEqual((await app.db.query('SELECT * FROM stock_transfer_items')).rows,valid);assert.deepEqual(await app.stock(),before);
 },{native});
 await scenario('guard keeps legitimate quantity approval, draft removal and dispatch intact',async app=>{
  const request=await app.create();assert.equal((await app.actions.approve(request.id)).success,true);
  const child=app.state().transfers.find(row=>row.sourceRequestId===parent);assert(child);
  const result=(await app.db.query(`SELECT public.stock_transfer_dispatch_atomic('${child.id}',NULL,'[{"product_id":"${ids.product}","qty":1}]') proof`)).rows[0].proof;
  assert.equal(result.request_closed,true);assert.equal(result.lines[0].source_stock,9);
  await app.db.exec(`INSERT INTO stock_transfers(id,ref,kind,status,from_store_id,to_store_id,created_by) VALUES('${ids.child2}','DRAFT','transfer','draft','A','B','Fixture');INSERT INTO stock_transfer_items(id,transfer_id,product_id,quantity) VALUES('${ids.child}','${ids.child2}','${ids.product}',1);DELETE FROM stock_transfer_items WHERE id='${ids.child}' AND transfer_id='${ids.child2}';INSERT INTO stock_transfer_items(id,transfer_id,product_id,quantity) VALUES('${ids.child}','${ids.child2}','${ids.product}',2);`);
  assert.equal((await app.db.query(`SELECT quantity FROM stock_transfer_items WHERE id='${ids.child}'`)).rows[0].quantity,2);
 });
 await scenario('parent guard migration is idempotent and adds no callable client function',async app=>{
  await app.create();const before=await app.rows();await app.db.exec('BEGIN;'+parentGuard+'COMMIT;');assert.deepEqual(await app.rows(),before);
  for(const role of ['anon','authenticated','service_role'])assert.equal((await app.db.query(`SELECT has_function_privilege('${role}','public.stock_transfer_items_preserve_parent()','EXECUTE') allowed`)).rows[0].allowed,false);
  const triggers=(await app.db.query("SELECT tgname,tgtype,tgenabled FROM pg_trigger WHERE tgrelid='public.stock_transfer_items'::regclass AND tgname='stock_transfer_items_00_parent_identity'")).rows;assert.equal(triggers.length,1);assert.equal(triggers[0].tgtype,19);assert.equal(triggers[0].tgenabled,'O');
 });
 for(const collision of ['function','trigger'])await scenario(`unknown ${collision} collision aborts guard migration without taking over`,async app=>{
  await app.create();const before=await app.rows();
  if(collision==='function')await app.db.exec("CREATE FUNCTION public.stock_transfer_items_preserve_parent() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW;END$$;");
  else await app.db.exec("CREATE FUNCTION public.fixture_other_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW;END$$;CREATE TRIGGER stock_transfer_items_00_parent_identity BEFORE UPDATE OF transfer_id ON stock_transfer_items FOR EACH ROW EXECUTE FUNCTION public.fixture_other_guard();");
  await assert.rejects(()=>app.db.exec('BEGIN;'+parentGuard+'COMMIT;'),/Unexpected transfer line parent guard/);await app.db.exec('ROLLBACK;');assert.deepEqual(await app.rows(),before);
 },{guard:false});
 console.log(JSON.stringify({passed,externalDatabaseAccess:false,sharedCheckoutIdentityChanged:false}));
}catch(error){console.error(error.message);if(error.where)console.error(error.where);process.exitCode=1;}
