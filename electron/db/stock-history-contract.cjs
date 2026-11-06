const { createHash } = require('node:crypto');
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const KINDS = new Set(['sale','refund','receiving','stock','product','transfer','sponsorship','missed_bill','general']);
const TABLES = ['stock_history_heads','stock_history_movements','stock_history_baselines','stock_history_openings','stock_history_source_cohorts'];
function fail(code='ESTOCK_HISTORY_INVALID') {
  throw Object.assign(new Error('The stock-history evidence could not be verified.'), {code});
}
function identifier(value, uuid=false) {
  if(typeof value!=='string'||!value||value.trim()!==value||value.length>128||(uuid&&!UUID.test(value)))fail();
  return UUID.test(value)?value.toLowerCase():value;
}
function quantity(value) {
  const text=typeof value==='bigint'?String(value):typeof value==='number'&&Number.isSafeInteger(value)?String(value):value;
  if(typeof text!=='string'||! /^-?(?:0|[1-9]\d{0,37})$/.test(text))fail();
  return BigInt(text);
}
// Keep the original 100ns instant. PostgreSQL timestamptz alone has only 6
// fractional digits and must never become the authoritative cutoff.
function instant(value) {
  if(typeof value!=='string')fail();
  const p=/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if(!p||+p[1]<1||+p[4]>23||+p[5]>59||+p[6]>59)fail();
  const iso=`${p[1]}-${p[2]}-${p[3]}T${p[4]}:${p[5]}:${p[6]}.000Z`,ms=Date.parse(iso);
  if(!Number.isFinite(ms)||new Date(ms).toISOString()!==iso)fail();
  let offset=0n;
  if(p[8]!=='Z'){
    const h=+p[8].slice(1,3),m=+p[8].slice(4);
    if(h>14||m>59||(h===14&&m!==0))fail();
    offset=BigInt(h*60+m)*(p[8][0]==='-'?-1n:1n);
  }
  return BigInt(ms)*10000n-offset*600000000n+BigInt((p[7]??'').padEnd(7,'0'));
}
function utc(ticks) {
  let seconds=ticks/10000000n,fraction=ticks%10000000n;
  if(fraction<0){seconds--;fraction+=10000000n;}
  const date=new Date(Number(seconds*1000n));
  if(!Number.isFinite(date.getTime()))fail();
  const prefix=date.toISOString().slice(0,19);
  if(prefix.length!==19)fail();
  return `${prefix}.${String(fraction).padStart(7,'0')}Z`;
}
function canonicalInstant(value){return utc(instant(value));}
function stableId(parts){
  const hash=createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
}
function uploadAggregateId(operationId,branchId){return stableId(['stock-history.upload.v1',identifier(operationId,true),identifier(branchId)]);}
function stockMap(input){
  if(typeof input==='string'){try{input=JSON.parse(input);}catch{fail('ESTOCK_HISTORY_STOCK_INVALID');}}
  if(input==null)input={};
  if(typeof input!=='object'||Array.isArray(input)||Object.keys(input).length>2000)fail('ESTOCK_HISTORY_STOCK_INVALID');
  const result=new Map();
  for(const [branch,value]of Object.entries(input)){
    const key=identifier(branch),n=quantity(value);
    result.set(key,(result.get(key)??0n)+n);
  }
  return result;
}
function normalizeContext(value,recordedAt){
  if(!value||!KINDS.has(value.kind))fail();
  const recorded=canonicalInstant(recordedAt);
  const effective=value.effectiveAt?canonicalInstant(value.effectiveAt):recorded;
  // Main supplies an explicit arrival time only after the existing action
  // authorization; a renderer cannot select this internal context directly.
  if(instant(effective)>instant(recorded))fail('ESTOCK_HISTORY_FUTURE');
  let arrivalReason;
  if(value.arrivalReason!==undefined){
    if(value.kind!=='receiving'||!value.effectiveAt)fail('ESTOCK_ARRIVAL_INVALID');
    arrivalReason=require('../stock-arrival.cjs').normalizeStockArrival({effectiveAt:effective,reason:value.arrivalReason}).reason;
  }
  return Object.freeze({operationId:identifier(value.operationId,true),branchId:identifier(value.branchId),
    terminalId:identifier(value.terminalId),actorId:value.actorId==null?null:identifier(value.actorId),
    kind:value.kind,effectiveAt:effective,effectiveTicks:String(instant(effective)),recordedAt:recorded,
    clockState:value.clockState==='verified'?'verified':'unverified',...(arrivalReason!==undefined?{arrivalReason}:{})});
}
function movementPayload(row){
  return JSON.stringify([1,row.id,row.operation_id,row.product_id,row.store_id,
    row.terminal_id,row.actor_id,row.source_kind,String(row.quantity_delta),row.effective_at_raw,
    String(row.effective_ticks),row.recorded_at_raw,row.product_name,row.sku,row.barcode,row.clock_state,
    row.source_refs??[],row.local_delta??null]);
}
function movementFingerprint(row){return createHash('sha256').update(movementPayload(row)).digest('hex');}
function changes(context,before,after,sourceClaims=[]){
  const old=new Map(before.map(row=>[identifier(row.id,true),row])),now=new Map(after.map(row=>[identifier(row.id,true),row]));
  const source=new Map();
  for(const claim of sourceClaims){
    if(!['item_activity_logs','stock_adjustments','stock_delta_applied'].includes(claim.table))fail();
    const key=JSON.stringify([identifier(claim.productId,true),identifier(claim.branchId)]),value=source.get(key)??{groups:new Map(),seen:new Map(),refs:[]};
    const delta=quantity(claim.delta),id=identifier(claim.id,true),identity=claim.table+':'+id;
    if(value.seen.has(identity)){if(value.seen.get(identity)!==delta)fail();continue;}
    value.seen.set(identity,delta);value.groups.set(claim.table,(value.groups.get(claim.table)??0n)+delta);
    value.refs.push([claim.table,id,String(delta)]);source.set(key,value);
  }
  const result=[];
  for(const id of [...new Set([...old.keys(),...now.keys()])].sort()){
    const left=old.get(id),right=now.get(id),a=stockMap(left?.stock_by_store),b=stockMap(right?.stock_by_store);
    const sourceBranches=[...source.keys()].map(value=>JSON.parse(value)).filter(([product])=>product===id).map(([,branch])=>branch);
    for(const branch of [...new Set([...a.keys(),...b.keys(),...sourceBranches])].sort()){
      const localDelta=(b.get(branch)??0n)-(a.get(branch)??0n),claim=source.get(JSON.stringify([id,branch]));
      // Activity, adjustment and receipt rows can describe the same physical
      // movement. Sum distinct legs within each source type; matching source
      // representations must agree, never be added together a second time.
      const claims=claim?[...claim.groups.values()]:[];
      if(claims.some(delta=>delta!==claims[0])||(localDelta!==0n&&claims.length&&claims[0]!==localDelta))fail();
      const delta=localDelta!==0n?localDelta:claims[0]??0n;if(!delta)continue;
      const product=right??left;
      const row={id:stableId(['stock-history.v1',context.operationId,id,branch]),operation_id:context.operationId,
        product_id:id,store_id:branch,terminal_id:context.terminalId,actor_id:context.actorId,source_kind:context.kind,
        quantity_delta:String(delta),effective_at_raw:context.effectiveAt,effective_ticks:context.effectiveTicks,
        recorded_at_raw:context.recordedAt,product_name:product.name??'',sku:product.sku??null,barcode:product.barcode??null,
        clock_state:context.clockState,source_refs:claim?claim.refs.sort((x,y)=>JSON.stringify(x).localeCompare(JSON.stringify(y))):[],local_delta:String(localDelta)};
      row.payload_json=movementPayload(row);row.payload_hash=movementFingerprint(row);result.push(Object.freeze(row));
    }
  }
  return result;
}
module.exports={TABLES,KINDS,identifier,quantity,instant,utc,canonicalInstant,stableId,uploadAggregateId,stockMap,normalizeContext,movementPayload,movementFingerprint,changes,fail};
