import{createRequire}from'node:module';
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
