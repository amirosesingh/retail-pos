import{createRequire}from'node:module';
import{describe,it,expect}from'vitest';
const require=createRequire(import.meta.url),{normalizeStockArrival}=require('../../../electron/stock-arrival.cjs'),c=require('../../../electron/db/stock-history-contract.cjs');
const operationId='11111111-1111-4111-8111-111111111111';
describe('explicit original receiving arrival data',()=>{
 it('preserves exact authorized-entered100ns and a separate explanation without replacing invoice data',()=>{
  const value=normalizeStockArrival({effectiveAt:'2026-11-06T08:00:00.1234567+08:00',reason:'Goods arrived before entry 📦'});
  expect(value).toEqual({effectiveAt:'2026-11-06T00:00:00.1234567Z',reason:'Goods arrived before entry 📦'});expect(Object.isFrozen(value)).toBe(true);
  expect(value).not.toHaveProperty('invoiceDate');expect(value).not.toHaveProperty('authorized');
 });
 it('defaults an unmodified receiving context to its original SQL save time',()=>{
  const context=c.normalizeContext({operationId,branchId:'a',terminalId:'t',kind:'receiving'},'2026-11-06T00:00:01.1234567Z');
  expect(context.effectiveAt).toBe(context.recordedAt);expect(context).not.toHaveProperty('arrivalReason');
 });
 it('rejects future arrival against the original SQL save instant and refuses other action kinds',()=>{
  const input={operationId,branchId:'a',terminalId:'t',kind:'receiving',effectiveAt:'2026-11-06T00:00:01.1234567Z',arrivalReason:'Original arrival'};
  expect(c.normalizeContext(input,'2026-11-06T00:00:01.1234567Z').arrivalReason).toBe('Original arrival');
  expect(()=>c.normalizeContext(input,'2026-11-06T00:00:01.1234566Z')).toThrowError(expect.objectContaining({code:'ESTOCK_HISTORY_FUTURE'}));
  for(const kind of ['sale','refund','stock','product'])expect(()=>c.normalizeContext({...input,kind},'2026-11-06T00:00:02Z')).toThrowError(expect.objectContaining({code:'ESTOCK_ARRIVAL_INVALID'}));
 });
 it.each([null,{},[],{effectiveAt:'2026-11-06T00:00:00Z',reason:'ok',authorized:true},
  {effectiveAt:'2026-11-06T00:00:00',reason:'ok'},{effectiveAt:'2026-11-06T00:00:00Z',reason:''},
  {effectiveAt:'2026-11-06T00:00:00Z',reason:' x'},{effectiveAt:'2026-11-06T00:00:00Z',reason:'x\ny'},
  {effectiveAt:'2026-11-06T00:00:00Z',reason:'x'.repeat(501)},{effectiveAt:'2026-11-06T00:00:00Z',reason:'\ud800'},
 ])('rejects malformed original arrival %j',value=>expect(()=>normalizeStockArrival(value)).toThrowError(expect.objectContaining({code:'ESTOCK_ARRIVAL_INVALID'})));
 it('rejects hidden and accessor values without executing attacker-controlled code',()=>{
  const values={effectiveAt:'2026-11-06T00:00:00Z',reason:'Original goods arrival'};
  for(const candidate of [Object.defineProperty({...values},'extra',{value:true}),Object.defineProperty({...values},'reason',{get(){throw new Error('getter executed');}})])
   expect(()=>normalizeStockArrival(candidate)).toThrowError(expect.objectContaining({code:'ESTOCK_ARRIVAL_INVALID'}));
 });
 it('keeps the existing receiving permission gate and admits the option only for the receiving envelope',()=>{
  const guard=require('../../../electron/ipc-guard.cjs'),session=require('../../../electron/admin-session.cjs'),privilege=require('../../../electron/ipc-privilege.cjs');
  const stockArrival={effectiveAt:'2026-11-06T00:00:00.1234567Z',reason:'Original goods arrival'};
  try{
   const envelope={kind:'receiving',operations:[],stockArrival};expect(guard.aggregate(envelope).stockArrival).toEqual(stockArrival);
   for(const kind of ['sale','refund','stock','product','general'])expect(()=>guard.aggregate({...envelope,kind})).toThrow();
   session.grant('staff','receiver',{can_receive_purchase_order:true},'pos','a');expect(privilege.allowed('business:commit-aggregate',[envelope])).toBe(true);
   session.grant('staff','receiver',{can_receive_purchase_order:false},'pos','a');expect(privilege.allowed('business:commit-aggregate',[envelope])).toBe(false);
  }finally{session.clear();}
 });
});
