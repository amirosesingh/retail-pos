import{createRequire}from'node:module';
import{afterEach,describe,it,expect,vi}from'vitest';
const require=createRequire(import.meta.url),{withStockHistoryReadSession:read,stockHistoryReadRequest:request}=require('../../../electron/db/stock-history-read-session.cjs');
function fixture(){
 const commands:string[]=[],state={transaction:0,options:0,current:true,fail:'',rollbackFails:false};let releases=0,closed=0;
 const connection={hasError:false,close(callback:()=>void){closed++;callback();}};
 const pool={config:{},connected:true,acquire(_owner:unknown,callback:(e:null,c:unknown,s:unknown)=>void){callback(null,connection,{});},release(){releases++;}};
 class Request{constructor(_parent:unknown,public options:{requestTimeout:number}){}input(){return this;}async query(text:string){
  commands.push(text);expect(this.options.requestTimeout).toBe(1000);
  if(state.fail&&text.includes(state.fail)||state.rollbackFails&&text.includes('ROLLBACK'))throw Object.assign(new Error('Fixture timeout'),{code:'ETIMEOUT'});
  if(text.includes('stock-history-read:session'))return{recordset:[{transaction_count:state.transaction,session_options:state.options}]};
  if(text.includes('BEGIN'))state.transaction=1;if(text.includes('COMMIT')||text.includes('ROLLBACK'))state.transaction=0;return{recordset:[]};
 }}
 const manager={pool,sql:()=>({Request})},guard=()=>{if(!state.current)throw Object.assign(new Error('Changed'),{code:'CONTEXT_CHANGED'});};
 return{manager,state,commands,connection,run:(work:(parent:object)=>unknown=async parent=>{await request(parent).query('SELECT bounded');return'page';})=>read(manager,guard,work),counts:()=>({releases,closed})};
}
afterEach(()=>vi.useRealTimers());
describe('private stock report read transaction ownership',()=>{
 it('pins requests, commits bounded data and never changes caller session settings',async()=>{const f=fixture();expect(await f.run()).toBe('page');expect(f.counts()).toEqual({releases:1,closed:0});expect(f.state.transaction).toBe(0);expect(f.commands.join('\n')).not.toMatch(/\bSET\b/);});
 it.each([[1,0],[0,2]])('refuses caller transaction/options %s/%s without rolling it back',async(transaction,options)=>{const f=fixture();Object.assign(f.state,{transaction,options});await expect(f.run()).rejects.toMatchObject({code:'ESTOCK_HISTORY_CALLER_TRANSACTION'});expect(f.commands.some(sql=>/BEGIN|COMMIT|ROLLBACK/.test(sql))).toBe(false);expect(f.state.transaction).toBe(transaction);expect(f.counts().releases).toBe(1);});
 it('rolls back only its own data failure and removes the private request witness',async()=>{const f=fixture();let seen:object;await expect(f.run(async parent=>{seen=parent;throw Error('Data failed');})).rejects.toThrow('Data failed');expect(f.state.transaction).toBe(0);expect(request(seen!)).toBeNull();expect(f.counts()).toEqual({releases:1,closed:0});});
 it('rolls back a scope change after BEGIN before any result is exposed',async()=>{const f=fixture();await expect(f.run(async()=>{f.state.current=false;return'secret';})).rejects.toMatchObject({code:'CONTEXT_CHANGED'});expect(f.state.transaction).toBe(0);expect(f.commands.at(-1)).toContain('ROLLBACK');});
 it('retires an uncertain open connection when rollback fails',async()=>{const f=fixture();f.state.rollbackFails=true;await expect(f.run(async()=>{throw Error('No data');})).rejects.toThrow('No data');expect(f.connection.hasError).toBe(true);expect(f.counts()).toEqual({releases:1,closed:1});});
 it('does not begin a read after initial context loss',async()=>{const f=fixture();f.state.current=false;await expect(f.run()).rejects.toMatchObject({code:'CONTEXT_CHANGED'});expect(f.commands).toEqual([]);expect(f.counts().releases).toBe(0);});
 it('preserves a native SQL timeout while releasing its owned transaction',async()=>{const f=fixture();f.state.fail='SELECT bounded';await expect(f.run()).rejects.toMatchObject({code:'ETIMEOUT'});expect(f.state.transaction).toBe(0);expect(f.counts().releases).toBe(1);});
});
