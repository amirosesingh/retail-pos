import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {describe,it,expect,vi} from 'vitest';
function fixture(){
 const state={epoch:1,identity:{source:'manual',subject:'existing legacy operator',authorId:null,permissions:{can_process_sale:true}},pool:{},terminal:{tokenId:'till',branchId:'A'},project:'https://fixture.supabase.co',backend:'https://fixture-pos.test'};
 const strictCapture=vi.fn(()=>{throw new Error('strict financial author unavailable');}),main=readFileSync('electron/main.cjs','utf8'),start=main.indexOf('function captureLocalOperationIdentity()'),end=main.indexOf('\nfunction enrollCurrentShiftAuthor',start);
 expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start);
 const context={adminSession:{epoch:()=>state.epoch,identity:()=>state.identity},databaseManager:{get pool(){return state.pool;}},terminalStore:{read:()=>state.terminal},cloudCredentials:{read:()=>({url:state.project})},authorizationServerUrl:()=>state.backend,shiftAuthority:{captureFinancial:strictCapture}};
 const capture=runInNewContext(main.slice(start,end)+'\ncaptureLocalOperationIdentity;',context);
 return{state,strictCapture,capture};
}
describe('Main request identity before capability awaits',()=>{
 it('preserves a legacy/manual authorized request without requiring a POS author or creating keys',()=>{const f=fixture(),guard=f.capture();expect(()=>guard.assertCurrent()).not.toThrow();expect(f.strictCapture).not.toHaveBeenCalled();});
 it.each(['epoch','identity','pool','terminal','project','backend'])('rejects %s changes before a delayed action commits',key=>{const f=fixture(),guard=f.capture();if(key==='epoch')f.state.epoch++;else if(key==='identity')f.state.identity={...f.state.identity,subject:'another operator'};else if(key==='pool')f.state.pool={};else if(key==='terminal')f.state.terminal={...f.state.terminal,branchId:'B'};else if(key==='project')f.state.project='https://another.supabase.co';else f.state.backend='https://another-pos.test';expect(()=>guard.assertCurrent()).toThrowError(expect.objectContaining({code:'ESYNC_SHIFT_AUTHOR_CHANGED'}));expect(f.strictCapture).not.toHaveBeenCalled();});
 it('defers strict financial author checks until the approved financial path requests them',()=>{const f=fixture(),guard=f.capture();expect(()=>guard.financialCapture('REFUND')).toThrow('strict financial author unavailable');expect(f.strictCapture).toHaveBeenCalledWith('REFUND');});
});
