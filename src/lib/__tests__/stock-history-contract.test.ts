import {createRequire} from 'node:module';
import {describe,it,expect} from 'vitest';
import {stockInstant} from '../stock-as-of';
const require=createRequire(import.meta.url);
const c=require('../../../electron/db/stock-history-contract.cjs');
const {physicalShape,productsIn,StockHistoryStore}=require('../../../electron/db/stock-history.cjs');
const shape=require('../../../electron/db/stock-history-schema.json');
const objects=require('../../../electron/db/stock-history-schema-objects.json');
const {physicalObjects}=require('../../../electron/db/stock-history-schema-check.cjs');
const id='11111111-1111-4111-8111-111111111111',op='22222222-2222-4222-8222-222222222222';
const context=()=>c.normalizeContext({operationId:op,branchId:'a',terminalId:'t',actorId:'cashier',kind:'sale'},'2026-11-05T01:00:00.0000001Z');
describe('durable stock-history evidence contract',()=>{
 it.each(['2026-11-05T01:00:00.0000001Z','2026-11-05T09:00:00.0000001+08:00','1969-12-31T23:59:59.9999999Z'])(
  'preserves exact100ns and matches the report kernel (%s)',value=>{
   expect(c.instant(value)).toBe(stockInstant(value));expect(c.instant(c.canonicalInstant(value))).toBe(stockInstant(value));
 });
 it.each(['2026-02-30T00:00:00Z','2026-01-01T00:00:00','2026-01-01T00:00:00+14:01','2026-01-01T00:00:00.00000001Z'])(
  'rejects ambiguous/invalid instant %s',value=>expect(()=>c.instant(value)).toThrow());
 it('captures actual persisted deltas and retains original source instant across a later upload',()=>{
  const source=context(),rows=c.changes(source,[{id,name:'Shoes',stock_by_store:{a:3,b:4}}],[{id,name:'Shoes',stock_by_store:{a:2,b:4}}]);
  expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({operation_id:op,product_id:id,store_id:'a',quantity_delta:'-1',effective_at_raw:source.effectiveAt,recorded_at_raw:source.recordedAt});
  expect(c.changes(source,[{id,stock_by_store:{a:3,b:4}}],[{id,name:'Shoes',stock_by_store:{a:2,b:4}}])[0].id).toBe(rows[0].id);
  expect(c.changes(source,[{id,name:'Shoes',stock_by_store:{a:2}}],[{id,name:'Shoes',stock_by_store:{a:2}}])).toEqual([]);
 });
 it('preserves transfer legs, negative quantities and legacy UUID stock aliases without mixing branches',()=>{
  const branch='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const rows=c.changes(context(),[{id,stock_by_store:{[branch]:1,[branch.toUpperCase()]:2,a:-1}}],[{id,stock_by_store:{[branch]:1,a:1}}]);
  expect(rows.map((r:{store_id:string;quantity_delta:string})=>[r.store_id,r.quantity_delta])).toEqual([['a','2'],[branch,'-2']]);
 });
 it('does not round decimal stock or sanitize malformed maps into valid history',()=>{
  for(const value of [{a:1.5},'{bad}',[],{a:'1x'}])expect(()=>c.stockMap(value)).toThrow();
 });
 it('allows original authorized physical time and refuses future effective claims',()=>{
  const input={operationId:op,branchId:'a',terminalId:'t',kind:'receiving',effectiveAt:'2026-11-04T23:00:00Z'};
  expect(c.normalizeContext(input,'2026-11-05T01:00:00Z').effectiveAt).toBe('2026-11-04T23:00:00.0000000Z');
  expect(()=>c.normalizeContext({...input,effectiveAt:'2026-11-06T00:00:00Z'},'2026-11-05T01:00:00Z')).toThrowError(expect.objectContaining({code:'ESTOCK_HISTORY_FUTURE'}));
 });
 it('recognizes only the entire exact optional physical schema',()=>{
  expect(physicalShape(shape.columns)).toBe(true);expect(physicalShape(shape.columns.slice(1))).toBe(false);
  expect(physicalShape(shape.columns.map((r:Record<string,unknown>,i:number)=>i? r:{...r,nullable:true}))).toBe(false);
  expect(physicalShape([...shape.columns,shape.columns[0]])).toBe(false);
 });
 it('requires exact constraints, indexes and immutable-trigger definitions as well as columns',()=>{
  expect(physicalObjects(objects,objects)).toBe(true);
  expect(physicalObjects(objects.slice(1),objects)).toBe(false);
  expect(physicalObjects(objects.map((row:Record<string,string>,n:number)=>n?row:{...row,object_hash:'0'.repeat(64)}),objects)).toBe(false);
 });
 it('retains original bounded JSON bytes for Unicode/null/exact quantity and source references',()=>{
  const rows=c.changes(context(),[{id,stock_by_store:{a:3}}],[{id,name:'鞋 “A” /\\\n',sku:null,barcode:'00001',stock_by_store:{a:3}}],
   [{table:'item_activity_logs',id:op,productId:id,branchId:'a',delta:'2'}]);
  expect(rows[0]).toMatchObject({quantity_delta:'2',local_delta:'0',source_refs:[['item_activity_logs',op,'2']]});
  expect(JSON.parse(rows[0].payload_json)).toContain('鞋 “A” /\\\n');expect(rows[0].payload_hash).toBe(c.movementFingerprint(rows[0]));
  expect(JSON.parse(rows[0].payload_json)[16]).toEqual([['item_activity_logs',op,'2']]);
 });
 it('collects bounded real product keys, skips price-only updates and flags unresolved absolute writes',()=>{
  expect(productsIn([{kind:'update',table:'products',match:{id},values:{selling_price:10}}])).toEqual({ids:[],unbounded:false});
  expect(productsIn([{kind:'update',table:'products',match:{id},values:{stock_quantity:0}},{kind:'upsert',table:'products',rows:[{id}]}])).toEqual({ids:[id],unbounded:false});
  expect(productsIn([{kind:'update',table:'products',match:{category:'unknown'},values:{stock_quantity:0}}])).toEqual({ids:[],unbounded:true});
 });
 it('does not double-count matching activity/adjustment/receipt representations of one physical effect',()=>{
  const claim=(table:string,n:string,delta:string)=>({table,id:n,productId:id,branchId:'a',delta});
  const claims=[claim('item_activity_logs',op,'-2'),claim('stock_delta_applied','33333333-3333-4333-8333-333333333333','-2'),claim('stock_adjustments','44444444-4444-4444-8444-444444444444','-2')];
  const rows=c.changes(context(),[{id,stock_by_store:{a:3}}],[{id,name:'Fixture',stock_by_store:{a:1}}],claims);
  expect(rows).toHaveLength(1);expect(rows[0].quantity_delta).toBe('-2');expect(rows[0].source_refs).toHaveLength(3);
  expect(c.changes(context(),[{id,stock_by_store:{a:3}}],[{id,name:'Fixture',stock_by_store:{a:3}}],claims)[0].quantity_delta).toBe('-2');
 });
 it('sums distinct same-source legs and ignores exact repeated references without losing receipt identities',()=>{
  const claim={table:'item_activity_logs',id:op,productId:id,branchId:'a',delta:'-1'};
  const row=c.changes(context(),[{id,stock_by_store:{a:3}}],[{id,name:'Fixture',stock_by_store:{a:1}}],[claim,claim,{...claim,id:'33333333-3333-4333-8333-333333333333'}])[0];
  expect(row.quantity_delta).toBe('-2');expect(row.source_refs).toHaveLength(2);
 });
 it('holds conflicting source or local effects instead of inventing an accepted quantity',()=>{
  const claim={table:'item_activity_logs',id:op,productId:id,branchId:'a',delta:'-1'},before=[{id,stock_by_store:{a:3}}],after=[{id,name:'Fixture',stock_by_store:{a:1}}];
  expect(()=>c.changes(context(),before,after,[claim])).toThrow();
  expect(()=>c.changes(context(),before,before,[claim,{...claim,table:'stock_delta_applied',delta:'-2'}])).toThrow();
  expect(()=>c.changes(context(),before,before,[claim,{...claim,delta:'-2'}])).toThrow();
  expect(()=>c.changes(context(),before,before,[{...claim,table:'unknown'}])).toThrow();
 });
 it.each([[],shape.columns.slice(0,10),shape.columns.map((r:Record<string,unknown>,i:number)=>i?r:{...r,length:4})].map(rows=>({rows})))(
  'keeps optional missing/partial/unknown schema unusable without auto-DDL',async({rows})=>{
   const queries:string[]=[];
   class Request{input(){return this;}async query(text:string){queries.push(text);return {recordset:text.includes('database_guid')?[{database_guid:id,schema_generation:31}]:rows};}}
   const manager={pool:{},sql:()=>({Request})},store=new StockHistoryStore(manager);
   expect((await store.capability({})).available).toBe(false);expect(queries.every(q=>! /CREATE|ALTER|UPDATE|INSERT|DELETE/.test(q))).toBe(true);
  });
 it('binds capability cache to current database GUID, generation and pool and can invalidate on upgrade',async()=>{
  let generation=24,guid=id,rows:unknown[]=[],reads=0;
  class Request{input(){return this;}async query(text:string){if(text.includes('database_guid'))return{recordset:[{database_guid:guid,schema_generation:generation}]};if(text.includes('WITH objects AS'))return{recordset:objects};reads++;return{recordset:rows};}}
  const manager={pool:{},sql:()=>({Request})},store=new StockHistoryStore(manager);
  expect((await store.capability({})).available).toBe(false);await store.capability({});expect(reads).toBe(1);
  rows=shape.columns;generation=31;expect((await store.capability({})).available).toBe(true);expect(reads).toBe(2);
  manager.pool={};await store.capability({});expect(reads).toBe(3);
  guid=op;await store.capability({});expect(reads).toBe(4);
  store.invalidateCapability();await store.capability({});expect(reads).toBe(5);
 });
});
