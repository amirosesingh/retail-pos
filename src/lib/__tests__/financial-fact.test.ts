import {createRequire} from 'node:module';
import {describe,expect,it} from 'vitest';
import {financialFact} from '../../../electron/sync/financial-fact.cjs';

const require=createRequire(import.meta.url);
const native=require('../../../electron/db/shift-financial-operations.cjs');
const row=(patch:Record<string,unknown>={})=>({id:'11111111-1111-4111-8111-111111111111',branchId:'A',
  shiftId:'22222222-2222-4222-8222-222222222222',totalAmount:'100.000',discountAmount:'0.00',
  paymentType:'CASH',paymentsJson:null,isRefunded:false,rowVersion:'9',...patch});

describe('shared financial snapshot comparison',()=>{
  it('uses one exact implementation for native and hosted comparisons',()=>{
    expect(native.financialFact(row())).toEqual(financialFact(row()));
    expect(financialFact(row())).toEqual({id:row().id,branchId:'A',shiftId:row().shiftId,
      totalAmount:'100'+'0'.repeat(38),discountAmount:'0',paymentType:'cash',payments:['single'],isRefunded:false});
  });
  it('preserves exact nested tender amounts and semantic equality without rounding',()=>{
    const first=row({paymentsJson:'[{"method":"CASH","amount":9007199254740993.005,"label":"paid"}]'});
    const same=row({paymentsJson:'[{"label":"paid","amount":"9007199254740993.0050","method":"cash"}]'});
    expect(financialFact(first)).toEqual(financialFact(same));
    expect(financialFact(first)).not.toEqual(financialFact(row({paymentsJson:'[{"method":"cash","amount":"9007199254740993.006","label":"paid"}]'})));
    expect(financialFact(row({paymentType:'POINTS'})).paymentType).toBe('POINTS');
  });
  it('keeps refund tender exclusion distinct from protected financial fields',()=>{
    const refunded=row({isRefunded:true,paymentsJson:'unreadable excluded tender'});
    expect(financialFact(refunded)).toEqual(financialFact(row({isRefunded:true,paymentType:'card'})));
    expect(financialFact(refunded)).not.toEqual(financialFact(row({isRefunded:true,totalAmount:'100.0001'})));
    expect(financialFact(refunded).paymentType).toEqual(['excluded']);
  });
  it.each([{id:'wrong'}, {shiftId:'wrong'}, {isRefunded:1}, {totalAmount:100}, {paymentsJson:'[{"amount":true}]'}, {paymentsJson:'[{"amount":1,"amount":2}]'}])('retains the native safe failure for invalid facts %j',patch=>{
    expect(()=>financialFact(row(patch))).toThrow(expect.objectContaining({code:'EFINANCIAL_SOURCE_UNVERIFIED',table:'shifts',message:'The immutable financial operation could not be confirmed.'}));
  });
});
