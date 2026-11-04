import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {describe,it,expect,vi} from 'vitest';
const require=createRequire(import.meta.url);
const {ShiftFinancialBases}=require('../../../electron/db/shift-financial-bases.cjs');
const branch='branch-a',shift='11111111-1111-4111-8111-111111111111',count='22222222-2222-4222-8222-222222222222';
const raw=JSON.stringify({prototypeVersion:2,formula:'canonical-exact-decimal-v2',branchId:branch,shiftId:shift,openingFloat:'20',inputs:[]});
function fixture(resolveBaseline:unknown=null){
 const store=new ShiftFinancialBases(null,{enabled:true,resolveBaseline});
 store.schema=vi.fn(async()=>{});
 store.query=vi.fn(async(_tx:unknown,sql:string)=>({recordset:sql.startsWith('SELECT id')?[]:[{basis_json:raw}]}));
 const tx=new EventEmitter();return{store,tx};
}
describe('Main-private financial captures',()=>{
 it('legacy disabled has no SQL, filesystem read, resolver or transaction dependency',async()=>{
  const resolveBaseline=vi.fn(),store=new ShiftFinancialBases(null,{resolveBaseline});
  expect(await store.capture(null,{})).toBeNull();expect(await store.get('bad','bad')).toBeNull();expect(await store.save(null,null)).toBeNull();expect(resolveBaseline).not.toHaveBeenCalled();
 });
 it('keeps raw data private and exposes only frozen exact totals',async()=>{
  const {store,tx}=fixture();const capture=await store.capture(tx,{branchId:branch,shiftId:shift,countId:count});
  expect(capture).toEqual({financialRequired:true,status:'pending',expected:{cash:'20.00',card:'0.00',digital:'0.00'}});expect(Object.isFrozen(capture)).toBe(true);expect(Object.isFrozen(capture.expected)).toBe(true);
  expect(capture).not.toHaveProperty('basisJson');expect(tx.listenerCount('rollback')).toBe(1);tx.emit('rollback');expect(tx.listenerCount('commit')).toBe(0);
 });
 for(const event of ['commit','rollback'])it(`invalidates capture after ${event}, even same transaction object`,async()=>{
  const {store,tx}=fixture(),capture=await store.capture(tx,{branchId:branch,shiftId:shift,countId:count});tx.emit(event);
  await expect(store.save(tx,capture,{countId:count})).rejects.toMatchObject({code:'EFINANCIAL_CAPTURE_INVALID'});
 });
 it('rejects foreign and caller-constructed captures before querying',async()=>{
  const {store,tx}=fixture(),capture=await store.capture(tx,{branchId:branch,shiftId:shift,countId:count});const before=store.query.mock.calls.length;
  await expect(store.save(tx,{...capture},{countId:count})).rejects.toMatchObject({code:'EFINANCIAL_CAPTURE_INVALID'});
  await expect(store.save(new EventEmitter(),capture,{countId:count})).rejects.toMatchObject({code:'EFINANCIAL_CAPTURE_INVALID'});expect(store.query).toHaveBeenCalledTimes(before);tx.emit('rollback');
 });
 it('cleans capture listeners when capture fails',async()=>{
  const {store,tx}=fixture();store.schema.mockRejectedValue(new Error('unavailable'));
  await expect(store.capture(tx,{branchId:branch,shiftId:shift,countId:count})).rejects.toThrow('unavailable');expect(tx.eventNames()).toEqual([]);
 });
 it('rejects a transaction ending during private baseline resolution',async()=>{
  const {store,tx}=fixture(async()=>{tx.emit('rollback');return null;});
  await expect(store.capture(tx,{branchId:branch,shiftId:shift,countId:count})).rejects.toMatchObject({code:'EFINANCIAL_CAPTURE_INVALID'});expect(tx.eventNames()).toEqual([]);
 });
 for(const baseline of [{serverBasisId:shift},{serverBasisId:shift,versionReferences:[{saleId:shift,receiptId:count,side:'bad'}]}, {serverBasisId:shift,versionReferences:[{saleId:shift,receiptId:count,side:'after',unknown:1n}]}])it('retains pending status for incomplete or malformed private baseline',async()=>{
  const {store,tx}=fixture(async()=>baseline),capture=await store.capture(tx,{branchId:branch,shiftId:shift,countId:count});expect(capture.status).toBe('pending');tx.emit('rollback');
 });
 it('recognizes explicit verified baseline refs without exposing them',async()=>{
  const {store,tx}=fixture(async()=>({serverBasisId:shift,versionReferences:[]})),capture=await store.capture(tx,{branchId:branch,shiftId:shift,countId:count});expect(capture.status).toBe('ready');expect(capture).not.toHaveProperty('serverBasisId');tx.emit('rollback');
 });
 it('rejects an already-present count before financial capture',async()=>{
  const {store,tx}=fixture();store.query.mockResolvedValue({recordset:[{id:count}]});await expect(store.capture(tx,{branchId:branch,shiftId:shift,countId:count})).rejects.toMatchObject({code:'EFINANCIAL_CAPTURE_COUNT_EXISTS'});expect(store.query).toHaveBeenCalledTimes(1);expect(tx.eventNames()).toEqual([]);
 });
});
