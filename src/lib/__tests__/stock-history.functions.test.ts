import {beforeEach,describe,it,expect,vi} from 'vitest';
const {rest,verify}=vi.hoisted(()=>({rest:vi.fn(),verify:vi.fn()}));
vi.mock('@/core/api/pos-relay.server',()=>({serviceRest:rest,verifyRelayCaller:verify}));
vi.mock('@tanstack/react-start',()=>({createServerFn:()=>({validator:(parse:(value:unknown)=>unknown)=>({handler:(fn:(input:{data:unknown})=>unknown)=>async(input:{data:unknown})=>fn({data:parse(input.data)})})})}));
import {loadStockHistoryPageDirect} from '../stock-history.functions';
import {checkedStockHistoryPage} from '../stock-history-validation';
const terminal='10000000-0000-4000-8000-000000000001',product='20000000-0000-4000-8000-000000000001';
const request={cutoff:'2026-11-05T01:00:00.0000001Z',timeZone:'Asia/Brunei',branchId:'a'};
let row:Record<string,unknown>;
const complete=()=>({status:'complete',reasons:[],cutoff:request.cutoff,timeZone:'Asia/Brunei',branchId:'a',baselineAt:'2026-11-05T00:00:00.0000000Z',
 readAt:'2026-11-06T00:00:00.0000000Z',sourceRevision:'source-1',pendingCount:'0',restatable:true,rows:[{productId:product,locationId:'a',name:'鞋',sku:null,barcode:'0001',quantity:'9007199254740993',negative:false}],next:null});
beforeEach(()=>{
 vi.resetAllMocks();row={id:'00000000-0000-4000-8000-000000000111',user_id:'cashier',role:'staff',role_slug:'cashier',store_id:'a',is_active:true,permissions:{can_view_inventory:true}};
 verify.mockResolvedValue({kind:'cashier',staffUserId:'cashier',storeId:'a',terminalId:terminal,label:'Cashier'});
 rest.mockImplementation(async(path:string)=>path.startsWith('app_users?')?new Response(JSON.stringify([row]),{status:200}):new Response(JSON.stringify(complete()),{status:200}));
});
const call=(extra={})=>loadStockHistoryPageDirect({data:{terminalToken:terminal,deviceBindingProof:'a'.repeat(64),cashierToken:'signed',request:{...request,...extra}}});
describe('actual stock-history function with existing current-account scope resolver',()=>{
 it('propagates secure proof and resolves current actor rather than trusting request identity',async()=>{
  expect(await call()).toMatchObject({status:'complete',rows:[{quantity:'9007199254740993'}]});
  expect(verify).toHaveBeenCalledWith({terminalToken:terminal,deviceBindingProof:'a'.repeat(64),cashierToken:'signed'});
  const sent=JSON.parse(rest.mock.calls.find(([path])=>path==='rpc/pos_stock_history_page')![1].body);
  expect(sent).toMatchObject({p_actor:'cashier',p_terminal:terminal,p_branch:'a',p_cutoff:request.cutoff});
 });
 it('rejects a bare activation before privileged report reads',async()=>{
  verify.mockResolvedValue({kind:'terminal',storeId:'a',terminalId:terminal,label:'Till'});
  await expect(call()).rejects.toThrow(/permission|staff sign-in/i);expect(rest.mock.calls.some(([p])=>p==='rpc/pos_stock_history_page')).toBe(false);
 });
 it('does not let an Administrator widen an Operations terminal branch',async()=>{
  row={...row,role:'admin',role_slug:'admin',store_id:null};
  await expect(call({branchId:'b'})).rejects.toThrow(/authorized branch/);expect(rest.mock.calls.some(([p])=>p==='rpc/pos_stock_history_page')).toBe(false);
 });
 it('allows only existing unrestricted Management scope and pins an assigned manager',async()=>{
  row={...row,role:'manager',role_slug:'supervisor',store_id:null,permissions:{can_view_inventory:true,can_use_management_pc:true}};
  verify.mockResolvedValue({kind:'cashier',staffUserId:'cashier',storeId:null,terminalId:terminal,managementDevice:true,label:'Manager'});
  rest.mockImplementation(async(path:string)=>path.startsWith('app_users?')?new Response(JSON.stringify([row])):new Response(JSON.stringify({...complete(),branchId:'b',rows:[]})));
  expect(await call({branchId:'b'})).toMatchObject({branchId:'b'});
  row.store_id='a';await expect(call({branchId:'b'})).rejects.toThrow(/authorized branch/);
 });
 it('rechecks actual disabled Management capability through the existing helper',async()=>{
  row={...row,role:'manager',role_slug:'supervisor',store_id:null,permissions:{can_view_inventory:true,can_use_management_pc:false}};
  verify.mockResolvedValue({kind:'cashier',staffUserId:'cashier',storeId:null,terminalId:terminal,managementDevice:true,label:'Manager'});
  await expect(call()).rejects.toThrow(/management computers/);expect(rest.mock.calls.some(([p])=>p==='rpc/pos_stock_history_page')).toBe(false);
 });
 it('requires current inventory and export permissions independently',async()=>{
  await expect(call({export:true})).rejects.toThrow(/export permission/);
  row.permissions={can_view_inventory:false};await expect(call()).rejects.toThrow(/permission/);
  expect(rest.mock.calls.some(([p])=>p==='rpc/pos_stock_history_page')).toBe(false);
 });
 it('rejects forged actor/role fields and invalid zone/cursor before verification',async()=>{
  await expect(loadStockHistoryPageDirect({data:{request,actorId:'admin'} as never})).rejects.toThrow();
  await expect(call({timeZone:'Not/AZone'})).rejects.toThrow();await expect(call({limit:501})).rejects.toThrow();
  expect(verify).not.toHaveBeenCalled();
 });
 it('distinguishes a missing upgrade from a failed database read without fabricating data',async()=>{
  rest.mockImplementation(async(path:string)=>path.startsWith('app_users?')?new Response(JSON.stringify([row])):new Response(JSON.stringify({code:'PGRST202',message:'pos_stock_history_page was not found'}),{status:404}));
  expect(await call()).toMatchObject({status:'unavailable',reasons:['SCHEMA_NOT_INSTALLED'],rows:[]});
  rest.mockImplementation(async(path:string)=>path.startsWith('app_users?')?new Response(JSON.stringify([row])):new Response('{}',{status:503}));
  await expect(call()).rejects.toThrow(/database did not answer/);
 });
 it('uses the server-resolved saved shift cutoff and rejects an unexpected ordinary cutoff',async()=>{
  row.permissions={can_view_inventory:true,can_shift_closing_history_view:true};
  const shifted={...complete(),cutoff:'2026-11-05T02:00:00.0000000Z'};
  rest.mockImplementation(async(path:string)=>path.startsWith('app_users?')?new Response(JSON.stringify([row])):new Response(JSON.stringify(shifted)));
  expect(await call({closedShiftId:product})).toMatchObject({cutoff:shifted.cutoff});await expect(call()).rejects.toThrow(/cutoff changed/);
 });
 it('rejects response scope, precision, cursor and false completeness inconsistencies',()=>{
  for(const value of [{...complete(),pendingCount:'1'},{...complete(),sourceRevision:null},{...complete(),baselineAt:null},
   {...complete(),rows:[{...complete().rows[0],locationId:'b'}]},
   {...complete(),rows:[{...complete().rows[0],quantity:'1.5'}]},
   {...complete(),rows:[{...complete().rows[0],negative:true}]},
   {...complete(),next:'20000000-0000-4000-8000-000000000099'}])expect(()=>checkedStockHistoryPage(value,'a')).toThrow();
 });
});
