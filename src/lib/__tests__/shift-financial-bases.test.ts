import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
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
  expect(await store.readDraft({})).toBeNull();expect(await store.capture(null,{})).toBeNull();expect(await store.get('bad','bad')).toBeNull();expect(await store.save(null,null)).toBeNull();expect(resolveBaseline).not.toHaveBeenCalled();
 });
 it('keeps raw data private and exposes only frozen exact totals',async()=>{
  const {store,tx}=fixture();const capture=await store.capture(tx,{branchId:branch,shiftId:shift,countId:count});
  expect(capture).toEqual({financialRequired:true,status:'pending',sourceHash:createHash('sha256').update(raw).digest('hex'),expected:{cash:'20.00',card:'0.00',digital:'0.00'}});expect(Object.isFrozen(capture)).toBe(true);expect(Object.isFrozen(capture.expected)).toBe(true);
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


describe('opening-origin resolver separation',()=>{
 it('does not consult origin when a real server baseline is available',async()=>{const {store,tx}=fixture(async()=>({serverBasisId:shift,versionReferences:[]}));store.resolveOpeningOrigin=vi.fn(async()=>{throw new Error('should not run');});expect((await store.capture(tx,{branchId:branch,shiftId:shift,countId:count})).status).toBe('ready');expect(store.resolveOpeningOrigin).not.toHaveBeenCalled();tx.emit('rollback');});
 it('does not hide malformed baseline evidence by falling back to origin',async()=>{const {store,tx}=fixture(async()=>({serverBasisId:'invalid',versionReferences:[]}));store.resolveOpeningOrigin=vi.fn(async()=>null);expect((await store.capture(tx,{branchId:branch,shiftId:shift,countId:count})).status).toBe('pending');expect(store.resolveOpeningOrigin).not.toHaveBeenCalled();tx.emit('rollback');});
 it.each([{openingOrigin:{localAggregateId:shift,rowHash:'a'.repeat(64)},versionReferences:[],serverBasisId:count},{openingOrigin:{localAggregateId:shift,rowHash:'a'.repeat(64),unknown:1},versionReferences:[]},{openingOrigin:{localAggregateId:shift,rowHash:'bad'},versionReferences:[]}])('never fabricates a baseline from malformed origin',async origin=>{const {store,tx}=fixture();store.resolveOpeningOrigin=vi.fn(async()=>origin);expect((await store.capture(tx,{branchId:branch,shiftId:shift,countId:count})).status).toBe('pending');expect(store.query).toHaveBeenCalledTimes(2);tx.emit('rollback');});
});

describe('financial frontier binding',()=>{
 const frontier={openingOrigin:{localAggregateId:shift,rowHash:'b'.repeat(64)},sequence:'0',operationId:shift,hash:'b'.repeat(64),reservedSequence:'1'};
 function historyFixture(){const f=fixture();f.store.financialOperations={enabled:true,readFrontier:vi.fn(async()=>frontier),validateKnownSnapshot:vi.fn(async()=>{})};f.store.query=vi.fn(async(_tx:unknown,sql:string)=>({recordset:sql.startsWith('SELECT id FROM dbo.shifts')?[{id:shift}]:sql.startsWith('SELECT id')?[]:[{basis_json:raw}]}));return f;}
 it('binds actual frontier into raw source hash while retaining identical tender totals',async()=>{const {store,tx}=historyFixture();const source=await store.readSource(tx,{branchId:branch,shiftId:shift});expect(source.sourceHash).not.toBe(createHash('sha256').update(raw).digest('hex'));expect(source.computed.expected.cash).toBe('20.00');expect(source.basis.financialFrontier).toEqual(frontier);tx.emit('rollback');});
 it('rejects missing reserved context instead of signing an unbound frontier',async()=>{const {store,tx}=historyFixture();await expect(store.capture(tx,{branchId:branch,shiftId:shift,countId:count})).rejects.toMatchObject({code:'EFINANCIAL_FRONTIER_CONFLICT'});expect(tx.eventNames()).toEqual([]);});
 it('accepts only matching actual reserved frontier',async()=>{const {store,tx}=historyFixture();await expect(store.capture(tx,{branchId:branch,shiftId:shift,countId:count,financialFrontier:frontier})).resolves.toMatchObject({financialRequired:true,status:'pending'});tx.emit('rollback');});
});
