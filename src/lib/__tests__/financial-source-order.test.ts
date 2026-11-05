import {createRequire} from 'node:module';import {describe,it,expect} from 'vitest';
const require=createRequire(import.meta.url);const {normalizeFinancialSourceEvidence,assertFinancialSourceAfter}=require('../../../electron/sync/financial-source-order.cjs');
describe('actual PostgreSQL financial source visibility',()=>{
 const previous={creatorXid:'100',snapshot:'90:101:95',evidenceOrder:'900'};
 it('accepts committed visible predecessors independent of helper sequence or clock',()=>{expect(assertFinancialSourceAfter(previous,{creatorXid:'102',snapshot:'101:103:102',evidenceOrder:'1'})).toBe(true);expect(assertFinancialSourceAfter(previous,{creatorXid:'104',snapshot:'90:105:95,102',evidenceOrder:'1'})).toBe(true);});
 it('uses helper order only inside the SAME transaction',()=>{expect(assertFinancialSourceAfter(previous,{...previous,evidenceOrder:'901'})).toBe(true);expect(()=>assertFinancialSourceAfter(previous,{...previous,evidenceOrder:'899'})).toThrow();});
 it.each(['90:105:95,100','90:100:95','90:99:95'])('rejects invisible or future predecessor %s',snapshot=>{expect(()=>assertFinancialSourceAfter(previous,{creatorXid:'110',snapshot,evidenceOrder:'999999'})).toThrow();});
 it('keeps xid values beyond Number precision exact',()=>{expect(assertFinancialSourceAfter({creatorXid:'9007199254740993',snapshot:'9007199254740990:9007199254740994:',evidenceOrder:'1'},{creatorXid:'9007199254740995',snapshot:'9007199254740994:9007199254740996:',evidenceOrder:'2'})).toBe(true);});
 it.each([{snapshot:'10:9:'},{snapshot:'10:20:12,12'},{snapshot:'10:20:13,12'},{snapshot:'10:20:9'},{snapshot:'10:20:20'},{creatorXid:1},{evidenceOrder:'0'},{evidenceOrder:'9223372036854775808'},{extra:true}])('rejects malformed evidence %j',patch=>{expect(()=>normalizeFinancialSourceEvidence({...previous,...patch})).toThrow();});
});
