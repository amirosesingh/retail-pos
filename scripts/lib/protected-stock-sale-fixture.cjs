'use strict';
// Shared disposable fixture for the existing guarded checkout and stock claim.
const assert=require('node:assert/strict');
const {randomUUID,createHash,sign}=require('node:crypto');
const operationProtocol=require('../../electron/security/financial-author-protocol.cjs');
const stockProtocol=require('../../electron/security/stock-event-author-protocol.cjs');
const contract=require('../../electron/db/stock-history-contract.cjs');
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
const child=(parent,group,index=0)=>{const hex=parent.replaceAll('-','').toLowerCase();return hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-a'+hex.slice(17,20)+'-'+group+index.toString(16).padStart(11,'0');};
async function commitProtectedStockSale(f,{pair,keyId,project,recorded='2026-11-06T00:00:00.1234567Z',
 productIds=[f.product],flushEffects,afterFirstClaim,pass=()=>{}}){
 const {db,terminal,author,shift}=f;
 const scalar=async(sql,args=[])=>(Object.values((await db.query(sql,args)).rows[0]))[0];
 const common={version:1,algorithm:'Ed25519',keyId,projectOrigin:project,terminalId:terminal,authorId:author,subject:author,branchId:'A'};
 const signed=(facts,protocol)=>({...facts,signature:sign(null,Buffer.from(protocol(facts)),pair.privateKey).toString('base64url')});
 const opening=await scalar('SELECT to_jsonb(s) FROM shifts s WHERE id=$1',[shift]);await db.query('DELETE FROM shifts WHERE id=$1',[shift]);
 const local=randomUUID(),raw=JSON.stringify(opening),envelope=JSON.stringify({version:1,localAggregateId:local,branchId:'A',terminalId:terminal,shiftId:shift,rowHash:hash(raw),rowJson:raw});
 const openProof=signed({...common,operationId:local,action:'OPEN',payloadHash:hash(envelope)},operationProtocol.financialOperationMessage);
 const ack=await scalar('SELECT pos_sync_register_financial_open($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb)',[randomUUID(),'default','A',terminal,local,raw,hash(raw),JSON.stringify([{table:'shifts',rows:[opening],changes:[],dependencyOrder:1}]),envelope,JSON.stringify(openProof)]);
 assert.equal(ack.ok,true);pass('actual enrolled author and protected OPEN origin remain compatible');
 const total=productIds.length*10;
 const saleId=randomUUID(),operation=randomUUID(),fact={id:saleId,branchId:'A',shiftId:shift,totalAmount:String(total),paymentType:'cash',paymentsJson:'[]',discountAmount:'0',isRefunded:false,rowVersion:'1'};
 const event={version:1,operationId:operation,branchId:'A',terminalId:terminal,shiftId:shift,openingOrigin:ack.openingOrigin,sequence:'1',predecessorOperationId:local,predecessorHash:ack.openingOrigin.rowHash,action:'SALE',changes:[{saleId,before:null,after:fact}]};
 const eventRaw=JSON.stringify(event),eventProof=signed({...common,operationId:operation,action:'SALE',payloadHash:hash(eventRaw)},operationProtocol.financialOperationMessage);
 await scalar('SELECT pos_sync_register_financial_event($1,$2,$3,$4,$5::jsonb)',['default','A',terminal,eventRaw,JSON.stringify(eventProof)]);
 const sale=await scalar('SELECT to_jsonb(jsonb_populate_record(NULL::sales,$1::jsonb))',[JSON.stringify({id:saleId,bill_number:'STOCK-FIXTURE',store_id:'A',shift_id:shift,cashier_name:author,total_amount:total,subtotal_amount:total,discount_amount:0,tax_amount:0,payment_type:'cash',payments:[],is_refunded:false,row_version:1,points_earned:0,points_redeemed:0,is_exchange:false,paid_amount:total,change_amount:0,exchange_credit:0,coupon_discount:0,rounding_adjustment:0,rounding_label:'',created_at:'2026-11-06T00:00:00Z'})]);
 const items=[],activities=[],before=[];
 for(const [index,product] of productIds.entries()){
  before.push({id:product,name:'Fixture',stock_by_store:{A:await scalar("SELECT stock_by_store->>'A' FROM products WHERE id=$1",[product])}});
  items.push(await scalar('SELECT to_jsonb(jsonb_populate_record(NULL::sale_items,$1::jsonb))',[JSON.stringify({id:child(saleId,'1',index),sale_id:saleId,branch_id:'A',product_id:product,product_name:'Fixture',quantity:1,refunded_qty:0,unit_price:10,discount_percent:0,discount_amount:0,tax_rate:0,is_return:false,is_foc:false,unit_cost:0,coupon_discount:0,row_version:1,created_at:'2026-11-06T00:00:00Z'})]));
  activities.push(await scalar('SELECT to_jsonb(jsonb_populate_record(NULL::item_activity_logs,$1::jsonb))',[JSON.stringify({id:child(saleId,'3',index),product_id:product,product_name:'Fixture',store_id:'A',activity_type:'sale',reference:sale.bill_number,quantity_delta:-1,unit_cost:0,staff_name:author,note:'',row_version:1,created_at:'2026-11-06T00:00:00Z'})]));
 }
 const operations=[{table:'sales',rows:[sale],changes:[],dependencyOrder:1},{table:'sale_items',rows:items,changes:[],dependencyOrder:2},{table:'item_activity_logs',rows:activities,changes:[],dependencyOrder:3}];
 const businessBatch=randomUUID(),upload=()=>scalar('SELECT pos_sync_push_financial_business_aggregate($1,$2,$3,$4,$5::jsonb)',[businessBatch,'default','A',terminal,JSON.stringify(operations)]);
 const effectCount=Number(await scalar('SELECT count(*)::int FROM private.stock_history_effect_sources'));
 const movementCount=Number(await scalar('SELECT count(*)::int FROM stock_history_movements'));
 assert.equal((await upload()).ok,true);
 await flushEffects?.();
 const after=before.map(p=>({...p,stock_by_store:{A:String(BigInt(p.stock_by_store.A)-1n)}}));
 const checkStock=async()=>{for(const product of after)assert.equal(await scalar("SELECT stock_by_store->>'A' FROM products WHERE id=$1",[product.id]),product.stock_by_store.A);};
 await checkStock();
 const effect=await scalar('SELECT count(*)::int FROM private.stock_history_effect_sources');assert.equal(Number(effect),effectCount+productIds.length);pass('actual guarded sale/item/activity writer creates physical source/effect publication');
 const movements=contract.changes(contract.normalizeContext({operationId:operation,branchId:'A',terminalId:terminal,actorId:author,kind:'sale'},recorded),before,after,
  activities.map(activity=>({table:'item_activity_logs',id:activity.id,productId:activity.product_id,branchId:'A',delta:'-1'})));
 const rows=movements.map(movement=>{
  const stockProof=signed({...common,operationId:operation,movementId:movement.id,action:'SALE',payloadHash:movement.payload_hash},stockProtocol.stockEventMessage);
  return {id:movement.id,payloadHash:movement.payload_hash,payloadJson:movement.payload_json,authorProofJson:JSON.stringify(stockProof),authorState:{allowed:true}};
 });
 const accept=(selected=rows)=>scalar('SELECT pos_stock_history_accept_claims($1,$2,$3,$4::jsonb)',[project,'A',terminal,JSON.stringify(selected)]);
 if(afterFirstClaim){const first=await accept(rows.slice(0,1));assert.equal(first.receipts.length,1);await afterFirstClaim(first.receipts[0]);}
 const stockAck=await accept();assert.equal(stockAck.ok,true);assert.equal(stockAck.receipts.length,productIds.length);await checkStock();
 pass('stock claim binds original financial actor/node, exact accepted document/product/delta and physical transaction without a second deduction');
 await upload();assert.deepEqual(await accept(),stockAck);assert.equal(Number(await scalar('SELECT count(*)::int FROM stock_history_movements')),movementCount+productIds.length);pass('business and history retries preserve the exact effects, movements and accepted receipts');
 return {stockAck,rows,accept};
}
module.exports={commitProtectedStockSale};
