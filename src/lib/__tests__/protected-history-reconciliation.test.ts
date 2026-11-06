import {beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rest:vi.fn()}));
vi.mock('@/core/api/pos-relay.server',()=>({serviceRest:mocks.rest}));
import {protectedHistoryReconciliation} from '../protected-history-reconciliation.server';
const args={read:{action:'begin' as const,organizationId:'default',branchId:'A'},terminalId:'terminal',keepCommerce:false};
function response(text='{"fixture":true}',overrides:Record<string,string>={},body?:BodyInit){return new Response(body??text,{headers:{'content-type':'application/json','X-POS-History-Reconcile-Version':'1','X-POS-History-Reconcile-Kind':'index','X-POS-History-Reconcile-Bytes':String(Buffer.byteLength(text)),'X-POS-History-Reconcile-Rows':'1',...overrides}});}
beforeEach(()=>mocks.rest.mockReset());
describe('bounded protected history reconciliation transport',()=>{
 it('forwards protected bytes without reparsing or changing the current scope',async()=>{const text='{"large":9007199254740993}';mocks.rest.mockResolvedValue(response(text));const result=await protectedHistoryReconciliation(args);expect(result.status).toBe(200);expect(await result.text()).toBe(text);expect(JSON.parse(mocks.rest.mock.calls[0][1].body)).toMatchObject({p_branch_id:'A',p_terminal_id:'terminal',p_keep_commerce:false,p_limit:1000});});
 it.each([{name:'X-POS-History-Reconcile-Version',value:'2'},{name:'X-POS-History-Reconcile-Kind',value:'rows'},{name:'X-POS-History-Reconcile-Bytes',value:'131073'},{name:'X-POS-History-Reconcile-Rows',value:'1001'},{name:'content-encoding',value:'gzip'},{name:'content-length',value:'1'}])('refuses malformed attestation $name',async({name,value})=>{mocks.rest.mockResolvedValue(response(undefined,{[name]:value}));expect((await protectedHistoryReconciliation(args)).status).toBe(502);});
 it('rejects truncated and excess streamed bytes before returning data',async()=>{for(const bytes of ['x','xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx']){mocks.rest.mockResolvedValue(response('{"fixture":true}',{},new TextEncoder().encode(bytes)));expect((await protectedHistoryReconciliation(args)).status).toBe(502);}});
 it.each([401,403,503])('preserves upstream status%s with no unprotected fallback',async status=>{mocks.rest.mockResolvedValue(Response.json({code:'UNCHANGED'},{status}));const r=await protectedHistoryReconciliation(args);expect(r.status).toBe(status);expect(await r.json()).toEqual({code:'UNCHANGED'});expect(mocks.rest).toHaveBeenCalledOnce();});
});
