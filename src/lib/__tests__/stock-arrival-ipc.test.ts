import{createRequire}from'node:module';
import{describe,it,expect,vi}from'vitest';
const require=createRequire(import.meta.url),{createStockArrivalCapability}=require('../../../electron/stock-arrival-ipc.cjs');
const shape=require('../../../electron/db/stock-history-schema.json'),objects=require('../../../electron/db/stock-history-schema-objects.json');
const id='11111111-1111-4111-8111-111111111111',database='22222222-2222-4222-8222-222222222222';
function fixture(){
 let epoch=1,reads=0,catalog=0,afterCatalog:()=>void=()=>{};
 const person={id,user_id:'receiver',role:'staff',role_slug:'cashier',store_id:'a',is_active:true,permissions:{can_receive_purchase_order:true} as Record<string,boolean>};
 const terminal={tokenId:'t',deviceUse:'operations'};
 const pool={request:()=>({input(){return this;},async query(){reads++;return{recordset:[structuredClone(person)]};}})};
 class Request{input(){return this;}async query(sql:string){catalog++;let rows;
  if(sql.includes('database_guid'))rows=[{database_guid:database,schema_generation:'31:fixture'}];
  else if(sql.includes('c.max_length [length]'))rows=shape.columns;else rows=objects;
  afterCatalog();return{recordset:rows};}}
 const captureReady=vi.fn(async()=>true),session={hasPosAuthority:()=>true,identity:()=>({source:'pos',authorId:id,subject:'receiver'}),epoch:()=>epoch,touch:vi.fn()};
 const options={manager:{pool,sql:()=>({Request})},session,terminal:()=>terminal,branch:()=> 'a',isPosSender:(event:unknown)=>event==='pos',captureReady};
 return{read:createStockArrivalCapability(options),options,person,terminal,captureReady,session,counts:()=>({reads,catalog}),after:(fn:()=>void)=>{afterCatalog=fn;},revoke:()=>{epoch++;}};
}
describe('Main-owned receiving arrival capability',()=>{
 it('allows a real receiver without inventory/report/export permission only after original capture and exact031 checks',async()=>{
  const f=fixture();expect(await f.read('pos')).toEqual({ok:true,available:true});expect(f.counts().reads).toBe(2);expect(f.captureReady).toHaveBeenCalledTimes(2);
  expect(f.session.touch).toHaveBeenCalledOnce();expect(f.person.permissions).not.toHaveProperty('can_view_inventory');
 });
 it('an installed schema alone never advertises active capture',async()=>{
  const f=fixture();f.captureReady.mockResolvedValue(false);expect(await f.read('pos')).toEqual({ok:true,available:false,reason:'CAPTURE_NOT_ENABLED'});
  expect(f.counts()).toEqual({reads:2,catalog:0});
 });
 it.each(['sender','inactive','permission','foreign-branch','page','management','client-flag'])('rejects untrusted %s without enabling the picker',async change=>{
  const f=fixture();if(change==='inactive')f.person.is_active=false;if(change==='permission')f.person.permissions={};if(change==='foreign-branch')f.person.store_id='A';
  if(change==='page')Object.assign(f.person.permissions,{'page:purchasing':false,'page:receiving':false,'page:suppliers':false});if(change==='management')f.terminal.deviceUse='management';
  expect(await f.read(change==='sender'?'customer':'pos',...(change==='client-flag'?[{available:true}]:[]))).toMatchObject({ok:false,available:false,code:'PERMISSION_DENIED'});
  expect(f.session.touch).not.toHaveBeenCalled();expect(f.counts().catalog).toBe(0);
 });
 it('keeps legacy admin permission-null compatibility without granting a normal receiver a role default',async()=>{
  const f=fixture();f.person.role='admin';f.person.permissions=null as never;expect(await f.read('pos')).toMatchObject({ok:true,available:true});
 });
 it('rechecks runtime readiness and session scope after await',async()=>{
  const f=fixture();f.captureReady.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  expect(await f.read('pos')).toEqual({ok:true,available:false,reason:'CAPTURE_NOT_ENABLED'});expect(f.session.touch).not.toHaveBeenCalled();
  const changed=fixture();changed.after(changed.revoke);expect(await changed.read('pos')).toMatchObject({ok:false,code:'ESTOCK_HISTORY_CONTEXT_CHANGED'});
 });
 it('rechecks actual SQL permission after the schema read',async()=>{
  const f=fixture();f.after(()=>{f.person.permissions={};});expect(await f.read('pos')).toMatchObject({ok:false,code:'PERMISSION_DENIED'});expect(f.session.touch).not.toHaveBeenCalled();
 });
});
