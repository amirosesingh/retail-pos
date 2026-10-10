import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
vi.mock('@/lib/external-supabase-config', () => ({ supabaseConfig:()=>({url:'https://test.invalid',anonKey:'test'}), runtimeEnvValue:()=> 'test-service-key' }));
import { runRelayRpc } from '@/core/api/pos-relay.server';
import { normalisePermissions } from '@/core/api/relay-claims.server';
import type { RelayScope } from '@/core/api/relay-policy.server';
const require = createRequire(import.meta.url);
const session = require('../../../electron/admin-session.cjs');
const privilege = require('../../../electron/ipc-privilege.cjs');
const { aggregatePolicy } = require('../../../electron/db/write-policy.cjs');
const scope = (permissions: Record<string,boolean>): RelayScope => ({kind:'cashier',label:'cashier',role:'staff',roleSlug:'cashier',isSupervisor:false,storeId:'branch-a',permissions:normalisePermissions(permissions)});
const sale = {kind:'upsert',table:'sales',rows:[{id:'sale-1',store_id:'branch-a',member_id:null,total_amount:12}]};
afterEach(()=>{session.clear();vi.unstubAllGlobals();});
describe('cashier sale permissions with no member',()=>{
 it('Electron commits only with the verified sale grant, never role defaults',()=>{
  session.grant('staff','cashier',{can_process_sale:true},'pos','branch-a');
  expect(privilege.allowed('business:commit-aggregate',[{kind:'sale'}])).toBe(true);
  expect(aggregatePolicy('sale',[sale],session.identity()).enforcePermissions).toBe(true);
  session.grant('staff','cashier',{can_process_sale:false},'pos','branch-a');
  expect(privilege.allowed('business:commit-aggregate',[{kind:'sale'}])).toBe(false);
  expect(()=>aggregatePolicy('sale',[sale],session.identity())).toThrow('Sale permission');
  session.grant('staff','cashier',{can_process_sale:true,'page:register':false},'pos','branch-a');
  expect(privilege.allowed('business:commit-aggregate',[{kind:'sale'}])).toBe(false);
  expect(privilege.allowed('pos:connect')).toBe(false);
 });
 it.each(['admin', 'supervisor', 'staff'])('Electron accepts a granted sale for %s without member or inventory grants', (level) => {
  session.grant(level, level, {can_process_sale:true}, 'pos', 'branch-a');
  expect(privilege.allowed('business:commit-aggregate', [{kind:'sale'}])).toBe(true);
  expect(aggregatePolicy('sale', [sale], session.identity()).enforcePermissions).toBe(true);
 });
 it.each(['admin', 'supervisor', 'staff'])('browser and Android accept an authorized %s sale', async (role) => {
  const fetch=vi.fn(async()=>new Response('{}',{status:200}));vi.stubGlobal('fetch',fetch);
  const identity = {...scope({can_process_sale:true}), role, roleSlug:role, isSupervisor:role!=='staff'} as RelayScope;
  const result=await runRelayRpc({kind:'rpc',table:'sales',fn:'pos_sale_commit',args:{_sale:sale.rows[0],_member:null}},identity);
  expect(result.ok).toBe(true);expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('browser accepts the granted sale and sends one atomic RPC',async()=>{
  const fetch=vi.fn(async()=>new Response('{}',{status:200}));vi.stubGlobal('fetch',fetch);
  const result=await runRelayRpc({kind:'rpc',table:'sales',fn:'pos_sale_commit',args:{_sale:sale.rows[0],_member:null}},scope({can_process_sale:true}));
  expect(result.ok).toBe(true);expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('browser refuses revoked, hidden-page and cross-branch sales before a database call',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  const deniedPermissions: Record<string, boolean>[] = [{can_process_sale:false},{can_process_sale:true,'page:register':false}];
  for (const permissions of deniedPermissions) {
   expect((await runRelayRpc({kind:'rpc',table:'sales',fn:'pos_sale_commit',args:{_sale:sale.rows[0],_member:null}},scope(permissions))).ok).toBe(false);
  }
  expect((await runRelayRpc({kind:'rpc',table:'sales',fn:'pos_sale_commit',args:{_sale:{...sale.rows[0],store_id:'branch-b'}}},scope({can_process_sale:true}))).ok).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
 });
});

it('browser refuses old-POS exchanges for cashiers before calling the database',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 const result=await runRelayRpc({kind:'rpc',table:'sales',fn:'pos_sale_commit',args:{_sale:{...sale.rows[0],original_bill_number:'OLDPOS:7'},_member:null}},scope({can_process_sale:true,can_process_exchange:true}));
 expect(result.ok).toBe(false);expect(fetch).not.toHaveBeenCalled();
});
