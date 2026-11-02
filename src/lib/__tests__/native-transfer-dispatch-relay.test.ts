import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
vi.mock('@/lib/external-supabase-config',()=>({supabaseConfig:()=>({url:'https://example.test',key:'k'}),runtimeEnvValue:()=> 'service-key'}));
import {runRelayRpc} from '@/core/api/pos-relay.server';
import {mayReconcileDispatch} from '@/lib/transfer-dispatch-result';
import type {RelayScope} from '@/core/api/relay-policy.server';
const scope:RelayScope={kind:'cashier',label:'Till',storeId:'A',role:'staff',roleSlug:'cashier',permissions:{can_create_transfer:true},isSupervisor:false,staffUserId:'verified',actorName:'Verified',branchRestricted:true};
const op={kind:'rpc' as const,table:'stock_transfers',fn:'stock_transfer_dispatch_atomic',args:{p_transfer_id:'t',p_staff_user_id:'forged',p_bound_store_id:'B',p_dispatched_by:'Administrator',p_lines:[{product_id:'p',qty:2}]}};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
beforeEach(()=>{fetchMock.mockReset();vi.spyOn(console,'warn').mockImplementation(()=>undefined);});
afterEach(()=>vi.restoreAllMocks());
describe('verified native atomic transfer dispatch relay',()=>{
 it('forwards only the resolved operator/binding and returns the server proof',async()=>{
  const proof={version:1,transfer_id:'t',request_closed:true,replayed:false};fetchMock.mockResolvedValueOnce(json([{from_store_id:'A'}])).mockResolvedValueOnce(json(proof));
  expect(await runRelayRpc(op,scope)).toEqual({ok:true,data:proof});
  const[url,init]=fetchMock.mock.calls[1];expect(url).toContain('rpc/stock_transfer_dispatch_atomic_for_staff');
  expect(JSON.parse(init.body)).toEqual({p_transfer_id:'t',p_staff_user_id:'verified',p_bound_store_id:'A',p_lines:op.args.p_lines,p_strict_lines:true});
 });
 it('keeps the legacy native dispatch success shape while using verified identity',async()=>{
  fetchMock.mockResolvedValueOnce(json([{from_store_id:'A'}])).mockResolvedValueOnce(json({version:1}));
  expect(await runRelayRpc({...op,fn:'stock_transfer_dispatch'},scope)).toEqual({ok:true});
  expect(fetchMock.mock.calls[1][0]).toContain('rpc/stock_transfer_dispatch_atomic_for_staff');
 });
 it('does not call the database when the action permission is absent',async()=>{
  expect((await runRelayRpc(op,{...scope,permissions:{}})).code).toBe('PERMISSION_DENIED');expect(fetchMock).not.toHaveBeenCalled();
 });
 it('keeps a wider administrator locked to the registered branch',async()=>{
  fetchMock.mockResolvedValueOnce(json([{from_store_id:'B'}]));
  expect((await runRelayRpc(op,{...scope,role:'admin',isSupervisor:true})).code).toBe('STORE_FORBIDDEN');expect(fetchMock).toHaveBeenCalledTimes(1);
 });
 it('allows an authorized management scope while still passing a verified operator',async()=>{
  fetchMock.mockResolvedValueOnce(json([{from_store_id:'B'}])).mockResolvedValueOnce(json({version:1}));
  expect((await runRelayRpc(op,{...scope,kind:'staff',isSupervisor:true,branchRestricted:false,storeId:null})).ok).toBe(true);
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).p_bound_store_id).toBeNull();
 });
 it.each([{kind:'terminal' as const},{stale:true},{staffUserId:null}])('refuses an unverified native operator %j',async invalid=>{
  fetchMock.mockResolvedValueOnce(json([{from_store_id:'A'}]));
  expect((await runRelayRpc(op,{...scope,...invalid})).code).toBe('PERMISSION_DENIED');expect(fetchMock).toHaveBeenCalledTimes(1);
 });
 it.each([
  ['23514','Short by 1 of PRIVATE PRODUCT at the sending warehouse','TRANSFER_INSUFFICIENT_STOCK'],
  ['42501','PRIVATE permission SQL','PERMISSION_DENIED'],
  ['P0001','TRANSFER_REQUEST_INVALID','TRANSFER_REQUEST_INVALID'],
  ['P0001','TRANSFER_DISPATCH_CONFLICT','TRANSFER_DISPATCH_CONFLICT'],
  ['PGRST202','PRIVATE function definition','TRANSFER_DISPATCH_UPGRADE_REQUIRED'],
 ])('normalizes definitive backend denial %s to safe guidance without retry',async(code,message,safeCode)=>{
  fetchMock.mockResolvedValueOnce(json([{from_store_id:'A'}])).mockResolvedValueOnce(json({code,message,details:'PRIVATE details',hint:'PRIVATE hint'},400));
  const result=await runRelayRpc(op,scope);
  expect(result).toMatchObject({ok:false,code:safeCode,status:400});
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
  expect(mayReconcileDispatch(result)).toBe(false);
  expect(console.warn).toHaveBeenCalledWith('[transfer-dispatch] Backend rejection',{code,status:400});
 });
 it('keeps unknown SQL text private while retaining definitive-denial classification',async()=>{
  fetchMock.mockResolvedValueOnce(json([{from_store_id:'A'}])).mockResolvedValueOnce(json({code:'P0001',message:'PRIVATE SQL password=secret table=private.accounts',details:'PRIVATE details'},500));
  const result=await runRelayRpc(op,scope);
  expect(result).toMatchObject({ok:false,code:'TRANSFER_DISPATCH_UNCONFIRMED',status:500});
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE|password|secret|accounts/);
  expect(mayReconcileDispatch(result)).toBe(false);
  expect(console.warn).toHaveBeenCalledExactlyOnceWith('[transfer-dispatch] Backend rejection',{code:'P0001',status:500});
 });
 it('does not return non-JSON upstream text or internal details',async()=>{
  fetchMock.mockResolvedValueOnce(json([{from_store_id:'A'}])).mockResolvedValueOnce(new Response('internal upstream SQL text',{status:503}));
  const result=await runRelayRpc(op,scope);
  expect(result).toMatchObject({ok:false,status:503});expect(result).not.toHaveProperty('code');
  expect(result.error).not.toContain('internal upstream');expect(mayReconcileDispatch(result)).toBe(true);
 });
 it('preserves ambiguous gateway unavailability for one identical retry without leaking its text',async()=>{
  fetchMock.mockResolvedValueOnce(json([{from_store_id:'A'}])).mockResolvedValueOnce(json({code:'PGRST002',message:'PRIVATE schema-cache connection',details:'PRIVATE host'},503));
  const result=await runRelayRpc(op,scope);
  expect(result).toMatchObject({ok:false,status:503});expect(result).not.toHaveProperty('code');
  expect(JSON.stringify(result)).not.toContain('PRIVATE');expect(mayReconcileDispatch(result)).toBe(true);
 });
 it('also sanitizes native dispatch ownership-lookup failures without issuing dispatch',async()=>{
  fetchMock.mockResolvedValueOnce(json({code:'42501',message:'PRIVATE source ownership query'},403));
  const result=await runRelayRpc(op,scope);
  expect(result).toMatchObject({ok:false,code:'PERMISSION_DENIED',status:403});
  expect(JSON.stringify(result)).not.toContain('PRIVATE');expect(fetchMock).toHaveBeenCalledTimes(1);
 });
});
