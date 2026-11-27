import{createRequire}from'node:module';
import{randomUUID}from'node:crypto';
import{beforeAll,beforeEach,afterAll,describe,it,expect}from'vitest';
const require=createRequire(import.meta.url),{createActualStockWriter}=require('../../../scripts/lib/stock-actual-writer-fixture.cjs');
describe.each([false,true])('genuine writer plus original stock admission, captured adjustment=%s',capturedAdjustment=>{
 let f:Awaited<ReturnType<typeof createActualStockWriter>>;
 beforeAll(async()=>{f=await createActualStockWriter({capturedAdjustment,sourceAdmission:true});},30000);
 afterAll(async()=>f?.db.close());
 beforeEach(async()=>{await f.db.exec(`RESET ROLE;SELECT set_config('request.jwt.claim.role','service_role',false);
  TRUNCATE private.stock_history_source_claim_verifications,private.stock_history_claim_receipts,private.stock_history_effect_coverage,public.stock_history_movements,
   private.stock_history_original_sources,private.stock_history_effect_sources,private.stock_history_accepted_effects,private.stock_history_source_receipts,private.stock_history_capture_gaps,
   stock_history_heads,stock_delta_applied,item_activity_logs,stock_adjustments,purchase_orders,purchase_order_items,sync_idempotency_receipts;
  UPDATE products SET stock_by_store='{"A":10}',stock_quantity=10,row_version=1;
  UPDATE app_users SET permissions='{"can_adjust_stock":true,"can_receive_purchase_order":true}' WHERE id='${f.author}';
  SET CONSTRAINTS ALL IMMEDIATE;
  TRUNCATE private.stock_history_effect_coverage,private.stock_history_effect_sources,private.stock_history_accepted_effects,private.stock_history_capture_gaps;`);});
 it.each(['ADJUST','RECEIVE'])('admits original %s only from the unchanged real business writer/effect, without another quantity write',async action=>{
  const op=await f.sourceOperation({action,...(action==='RECEIVE'?{arrivalReason:'Goods arrived before invoice entry'}:{})});
  expect(await op.upload()).toMatchObject({ok:true,stockSourceStatus:'captured_unverified'});expect(await f.stock()).toBe(op.after);
  expect(await f.scalar('SELECT count(*)::int FROM private.stock_history_accepted_effects')).toBe(1);
  const accepted=await op.accept();expect(accepted).toMatchObject({ok:true,receipts:[{id:op.row.id}]});expect(await f.stock()).toBe(op.after);
  expect(await f.scalar('SELECT count(*)::int FROM private.stock_history_source_claim_verifications')).toBe(1);
  expect(await f.scalar('SELECT time_grade FROM private.stock_history_source_claim_verifications')).toBe('author_claimed');
  expect(await f.scalar('SELECT coverage_state FROM stock_history_heads')).toBe('incomplete');
  expect(await op.upload()).toMatchObject({ok:true});expect(await op.accept()).toEqual(accepted);expect(await f.stock()).toBe(op.after);
 });
 it('rejects current permission loss, then acknowledges exact accepted history after later revocation without rewriting it',async()=>{
  const op=await f.sourceOperation();await op.upload();await f.db.query("UPDATE app_users SET permissions='{}' WHERE id=$1",[f.author]);
  await expect(op.accept()).rejects.toThrow('STOCK_HISTORY_AUTHOR_PERMISSION_REVOKED');expect(await f.scalar('SELECT count(*)::int FROM stock_history_movements')).toBe(0);
  await f.db.query("UPDATE app_users SET permissions='{\"can_adjust_stock\":true}' WHERE id=$1",[f.author]);const accepted=await op.accept();
  await f.db.query("UPDATE app_users SET permissions='{}' WHERE id=$1",[f.author]);expect(await op.accept()).toEqual(accepted);expect(await f.stock()).toBe('7');
 });
 it('an ordinary legacy accepted batch cannot reconstruct its missing original source witness from later rows',async()=>{
  const op=await f.sourceOperation();expect(await f.push(op.batch,op.operations)).toMatchObject({ok:true});
  expect(await op.upload()).toMatchObject({ok:true,stockSourceStatus:'held'});expect(await f.scalar('SELECT count(*)::int FROM private.stock_history_original_sources')).toBe(0);
  await expect(op.accept()).rejects.toThrow('STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN');expect(await f.stock()).toBe('7');
 });
});

it('accepts a same-ID adjustment audit and receipt through the captured Retail POS Beta writers',async()=>{
 const f=await createActualStockWriter({betaAdjustmentDelegates:true,sourceAdmission:true});
 try {
  await f.db.query(`UPDATE products SET stock_by_store='{"A":10,"B":4}',stock_quantity=14 WHERE id=$1`,[f.product]);
  const legacy=f.adjustment();
  expect(await f.push(randomUUID(),[{table:'stock_adjustments',rows:[legacy],changes:[]}])).toMatchObject({ok:true});
  expect(await f.stock()).toBe('10');
  expect(await f.scalar('SELECT count(*)::int FROM stock_delta_applied')).toBe(0);

  const op=await f.sourceOperation({includeAdjustmentReceipt:true});
  const movement=op.source.document.id;
  const receipt=op.operations.find((part:{table:string})=>part.table==='stock_delta_applied');
  expect(op.source.sourceRefs).toEqual([['stock_adjustments',movement,'-3'],['stock_delta_applied',movement,'-3']]);
  expect(await f.push(randomUUID(),[{table:'stock_delta_applied',rows:[{
   movement_id:randomUUID(),product_id:f.product,store_id:'A',delta:2,
  }],changes:[]}])).toMatchObject({ok:true});
  expect(await f.stock()).toBe('12');

  const wrongBranch=op.operations.map((part:{table:string})=> part.table===receipt.table
   ? {...receipt,rows:[{...receipt.rows[0],store_id:'B'}]} : part);
  await expect(f.push(randomUUID(),wrongBranch)).rejects.toThrow('SYNC_BRANCH_FORBIDDEN');
  expect(await f.scalar('SELECT count(*)::int FROM stock_adjustments WHERE id=$1',[movement])).toBe(0);
  expect(await f.scalar('SELECT count(*)::int FROM stock_delta_applied WHERE movement_id=$1',[movement])).toBe(0);
  expect(await f.stock()).toBe('12');

  expect(await op.upload()).toMatchObject({ok:true,stockSourceStatus:'captured_unverified'});
  expect(await f.scalar('SELECT stock_by_store FROM products WHERE id=$1',[f.product])).toEqual({A:9,B:4});
  const witness=await f.scalar('SELECT accepted_sources FROM private.stock_history_original_sources WHERE batch_id=$1',[op.batch]);
  expect(witness.stock_adjustments).toEqual([expect.objectContaining({id:movement,previous_stock:10,updated_stock:7,delta:-3})]);
  expect(witness.stock_delta_applied).toEqual([{movement_id:movement,product_id:f.product,store_id:'A',delta:-3}]);
  const accepted=await op.accept();
  expect(accepted).toMatchObject({ok:true,receipts:[{id:op.row.id}]});
  expect(await f.scalar('SELECT count(*)::int FROM private.stock_history_effect_sources WHERE movement_id=$1',[movement])).toBe(1);

  expect(await op.upload()).toMatchObject({ok:true,replayed:true});
  expect(await op.accept()).toEqual(accepted);
  expect(await f.push(randomUUID(),op.operations)).toMatchObject({ok:true});
  await expect(f.push(randomUUID(),[{...receipt,rows:[{...receipt.rows[0],delta:-9}]}])).rejects.toThrow('POS_STOCK_MOVEMENT_EVIDENCE_CONFLICT');
  expect(await f.scalar('SELECT stock_by_store FROM products WHERE id=$1',[f.product])).toEqual({A:9,B:4});
  expect(await f.scalar('SELECT count(*)::int FROM public.stock_history_movements WHERE id=$1',[op.row.id])).toBe(1);
 } finally { await f.db.close(); }
},60000);
