import {describe,it,expect} from 'vitest';
import {parseFinancialOperation,financialOperationEnvelopeSchema} from '../sync-financial-operation.server';
const id='00000000-0000-4000-8000-000000000001',terminal='00000000-0000-4000-8000-000000000002',sale='00000000-0000-4000-8000-000000000003';
const fact={id:sale,branchId:'A',shiftId:id,totalAmount:'9007199254740993.01',paymentType:'cash',paymentsJson:null,discountAmount:'0.00',isRefunded:false,rowVersion:'9007199254740993'};
const fixture=()=>({version:1,operationId:id,branchId:'A',terminalId:terminal,shiftId:id,openingOrigin:{localAggregateId:id,rowHash:'a'.repeat(64)},sequence:'9007199254740993',predecessorOperationId:id,predecessorHash:'b'.repeat(64),action:'SALE',changes:[{saleId:sale,before:null,after:{...fact}}]});
describe('strict financial history transport preparation',()=>{
 it('preserves exact money, sequence and raw payment strings',()=>{
  const raw=JSON.stringify(fixture());const parsed=parseFinancialOperation(raw);
  expect(parsed.sequence).toBe('9007199254740993');expect(parsed.changes[0].after?.totalAmount).toBe('9007199254740993.01');
  expect(financialOperationEnvelopeSchema.parse({organizationId:'org',operationJson:raw,proof:{}}).operationJson).toBe(raw);
 });
 it.each(['branch','shift','sale','duplicate','both-null','extra','numeric','scope-extra'])('rejects invalid %s input',kind=>{
  const value=fixture();
  if(kind==='branch')value.changes[0].after.branchId='B';
  if(kind==='shift')value.changes[0].after.shiftId=terminal;
  if(kind==='sale')value.changes[0].saleId=id;
  if(kind==='duplicate')value.changes.push(value.changes[0]);
  if(kind==='both-null')(value.changes[0] as unknown as Record<string,unknown>).after=null;
  if(kind==='extra')Object.assign(value,{allowed:true});
  if(kind==='numeric')Object.assign(value.changes[0].after,{totalAmount:1});
  if(kind==='scope-extra')Object.assign(value.changes[0].after,{owner:'other'});
  expect(()=>parseFinancialOperation(JSON.stringify(value))).toThrow();
 });
 it('rejects duplicate JSON keys, excessive changes and malformed decimal tokens',()=>{
  const raw=JSON.stringify(fixture());expect(()=>parseFinancialOperation(raw.replace('"version":1','"version":1,"version":1'))).toThrow();
  const value=fixture();value.changes=Array.from({length:501},()=>value.changes[0]);expect(()=>parseFinancialOperation(JSON.stringify(value))).toThrow();
  value.changes=[{saleId:sale,before:null,after:{...fact,totalAmount:'NaN'}}];expect(()=>parseFinancialOperation(JSON.stringify(value))).toThrow();
 });
 it('requires before/after shapes matching the operation class',()=>{
  for(const action of ['REFUND','TENDER','VOID'])expect(()=>parseFinancialOperation(JSON.stringify({...fixture(),action}))).toThrow();
  const changed={...fixture(),action:'REFUND',changes:[{saleId:sale,before:fact,after:{...fact,isRefunded:true}}]};
  expect(parseFinancialOperation(JSON.stringify(changed)).changes[0].before?.isRefunded).toBe(false);
 });
 it('rejects oversized bodies and unknown envelope flags',()=>{
  expect(()=>parseFinancialOperation(' '.repeat(6*1024*1024+1))).toThrow();
  expect(financialOperationEnvelopeSchema.safeParse({organizationId:'org',operationJson:'{}',proof:{},authorized:true}).success).toBe(false);
 });
});
