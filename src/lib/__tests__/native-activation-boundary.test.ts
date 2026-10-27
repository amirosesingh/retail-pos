import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require=createRequire(import.meta.url);
const policy=require('../../../electron/verified-activation.cjs');
const a={tokenId:'token-a',deviceUse:'operations',locationId:'A',deviceType:'pc'};
const descriptor={id:'token-a',platform:'pc',mode:'operations',branchId:'A'};
describe('native activation identity boundary',()=>{
 it('preserves registered A for cashier and manager account scopes',()=>{
  expect(policy.authorizedBranch(a,'A')).toBe('A');
  expect(policy.authorizedBranch(a,null)).toBe('A');
  expect(()=>policy.authorizedBranch(a,'B')).toThrow('not authorized');
 });
 it('refuses renderer branch, token and mode reassignment',()=>{
  for(const change of [{locationId:'B'},{tokenId:'token-b'},{locationId:'',deviceUse:'management'}])
   expect(()=>policy.assertUnchanged(a,{...a,...change})).toThrow('explicit unpairing');
 });
 it('requires canonical claimed pc registration for first mirror',()=>{
  expect(policy.canonicalConfig(a,descriptor)).toMatchObject({locationId:'A',deviceUse:'operations'});
  expect(()=>policy.canonicalConfig(a,null)).toThrow();
  expect(()=>policy.canonicalConfig(a,{...descriptor,platform:'mobile'})).toThrow();
  expect(()=>policy.canonicalConfig(a,{...descriptor,branchId:'b'})).toThrow();
 });
 it('allows identical offline mirror but not contradictory aliases',()=>{
  expect(policy.assertUnchanged(a,{...a,locationName:'Updated label'})).toEqual(descriptor);
  expect(()=>policy.binding({...a,storeId:'B'})).toThrow('inconsistent');
 });
 it('never uses account assignment as an absent activation',()=>{
  expect(()=>policy.authorizedBranch(null,'A')).toThrow('registered');
 });
 it('preserves verified Management without inventing an operations branch',()=>{
  const management={tokenId:'m',deviceUse:'management',deviceType:'pc',locationId:''};
  expect(policy.canonicalConfig(management,{id:'m',platform:'pc',mode:'management',branchId:null})).toMatchObject({locationId:'',deviceUse:'management'});
  expect(()=>policy.authorizedBranch(management,null)).toThrow();
 });
 it('keeps operator connection settings and existing secrets during adoption',()=>{
  const existing={...a,backendUrl:'https://saved.test',supabaseUrl:'https://saved-cloud.test',deviceBindingProof:'a'.repeat(64),deviceClaimProof:'saved-replica'};
  expect(policy.canonicalConfig({...a,backendUrl:'https://other.test',supabaseUrl:'https://other-cloud.test',deviceBindingProof:'b'.repeat(64),deviceClaimProof:'replacement'},descriptor,existing)).toMatchObject(existing);
 });
 it('fills a legacy missing proof after descriptor verification without replacing connection settings',()=>{
  const existing={...a,backendUrl:'https://saved.test'};
  expect(policy.canonicalConfig({...a,backendUrl:'https://other.test',deviceBindingProof:'a'.repeat(64)},descriptor,existing)).toMatchObject({...existing,deviceBindingProof:'a'.repeat(64)});
 });
});
import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
it('installed Main query handler refuses a foreign assigned account before SQL and keeps cashier A reads',async()=>{
 const session=require('../../../electron/admin-session.cjs');
 const guard=require('../../../electron/ipc-guard.cjs');
 const {install}=require('../../../electron/ipc-privilege.cjs');
 const handlers=new Map<string,(...args:unknown[])=>unknown>();
 const ipc={handle:(name:string,fn:(...args:unknown[])=>unknown)=>handlers.set(name,fn)};
 install(ipc,{isManagementDevice:()=>false,isFirstRun:()=>false});
 const source=readFileSync(new URL('../../../electron/main.cjs',import.meta.url),'utf8');
 const from=source.indexOf('  ipcMain.handle("business:query",');
 const to=source.indexOf('  ipcMain.handle("business:shift-expected",',from);
 const query=vi.fn(async()=>({ok:true,rows:[{id:'sale-a'}]}));
 const terminalStore={read:()=>a};
 new Function('ipcMain','guard','databaseManager','terminalStore','operationsRepository','authorizedLocalBranch','redactShiftRow',source.slice(from,to))(
  ipc,guard,{isConnected:()=>true},terminalStore,{query},()=>policy.authorizedBranch(a,session.branchId()),(row:unknown)=>row);
 try{
  session.grant('staff','cashier',{can_process_sale:true},'pos','B');
  expect(await handlers.get('business:query')!({},'sales',{})).toMatchObject({ok:false});
  expect(query).not.toHaveBeenCalled();
  session.grant('staff','cashier',{can_process_sale:true},'pos','A');
  expect(await handlers.get('business:query')!({},'sales',{})).toMatchObject({ok:true});
  expect(query).toHaveBeenCalledWith('A','sales',expect.anything(),'token-a');
 }finally{session.clear();}
});

import { runInNewContext } from 'node:vm';
it('revocation keeps only a sealed non-secret origin tombstone and removes usable activation',()=>{
 const files=new Map<string,Buffer|string>();
 const fs={existsSync:(p:string)=>files.has(p),writeFileSync:(p:string,v:Buffer|string)=>files.set(p,v),readFileSync:(p:string)=>{if(!files.has(p))throw Error('missing');return files.get(p);},rmSync:(p:string)=>files.delete(p)};
 const mod={exports:{} as {write:(value:unknown)=>{ok:boolean};read:()=>unknown;wasProvisioned:()=>boolean;lastBinding:()=>unknown}};
 runInNewContext(readFileSync(new URL('../../../electron/terminal-store.cjs',import.meta.url),'utf8'),{module:mod,require:(name:string)=>name==='node:fs'?fs:name==='electron'?{app:{getPath:()=>'/user'},safeStorage:{isEncryptionAvailable:()=>true,encryptString:(s:string)=>Buffer.from(s),decryptString:(b:Buffer)=>b.toString()}}:require(name)});
 const store=mod.exports;
 expect(store.write({...a,deviceBindingProof:'secret-proof',deviceClaimProof:'replica-secret'}).ok).toBe(true);
 expect(store.write(null).ok).toBe(true);
 expect(store.read()).toBeNull();
 expect(store.wasProvisioned()).toBe(true);
 expect(store.lastBinding()).toMatchObject({tokenId:'token-a',locationId:'A'});
 expect(JSON.stringify(store.lastBinding())).not.toContain('secret');
});
it('installed adoption handler cannot replace Operations A with B even with valid cashier credentials',async()=>{
 const session=require('../../../electron/admin-session.cjs');
 const guard=require('../../../electron/ipc-guard.cjs');
 const {install}=require('../../../electron/ipc-privilege.cjs');
 const handlers=new Map<string,(...args:unknown[])=>unknown>();
 const ipc={handle:(name:string,fn:(...args:unknown[])=>unknown)=>handlers.set(name,fn)};
 install(ipc,{isManagementDevice:()=>false,isFirstRun:()=>false});
 const source=readFileSync(new URL('../../../electron/main.cjs',import.meta.url),'utf8');
 const from=source.indexOf('  ipcMain.handle("admin:adopt-session",');
 const to=source.indexOf('  ipcMain.handle("admin:unlock",',from);
 const write=vi.fn();const fetch=vi.fn();
 new Function('ipcMain','guard','adminSession','terminalStore','activationBoundary','fetch',`let sessionAdoptionRevision=0;${source.slice(from,to)}`)(ipc,guard,session,{read:()=>a,write},policy,fetch);
 try{
  session.grant('staff','cashier',{can_process_sale:true},'pos','A');
  await expect(handlers.get('admin:adopt-session')!({}, {cashierToken:'valid-session'}, {...a,locationId:'B'})).rejects.toThrow('explicit unpairing');
  expect(fetch).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();
 }finally{session.clear();}
});

it('ordinary adoption preserves cashier sale grants and repairs a verified legacy proof',async()=>{
 const session=require('../../../electron/admin-session.cjs');
 const guard=require('../../../electron/ipc-guard.cjs');
 const {install}=require('../../../electron/ipc-privilege.cjs');
 const handlers=new Map<string,(...args:unknown[])=>unknown>();
 const ipc={handle:(name:string,fn:(...args:unknown[])=>unknown)=>handlers.set(name,fn)};
 install(ipc,{isManagementDevice:()=>false,isFirstRun:()=>false});
 const source=readFileSync(new URL('../../../electron/main.cjs',import.meta.url),'utf8');
 const from=source.indexOf('  ipcMain.handle("admin:adopt-session",');
 const to=source.indexOf('  ipcMain.handle("admin:unlock",',from);
 const existing={...a,backendUrl:'https://saved.test',supabaseUrl:'https://saved-cloud.test'};
 const write=vi.fn(()=>({ok:true}));const fetch=vi.fn(async(_url:string,_options:RequestInit)=>Response.json({ok:true,terminal:descriptor,level:'staff',subject:'cashier',branchId:'A',permissions:{can_process_sale:true}}));
 new Function('ipcMain','guard','adminSession','terminalStore','activationBoundary','fetch','authorizationServerUrl','syncCloud','rememberVerifiedBranch','assertSafeRegistrationChange','recordRegistrationChange',`let sessionAdoptionRevision=0;${source.slice(from,to)}`)(ipc,guard,session,{read:()=>existing,write,lastBinding:()=>a},policy,fetch,()=>existing.backendUrl,{setAuthorizationProof:vi.fn()},vi.fn(),vi.fn(),vi.fn());
 try{
  session.grant('staff','cashier',{can_process_sale:true},'pos','A');
  expect(await handlers.get('admin:adopt-session')!({}, {cashierToken:'valid-session',deviceBindingProof:'a'.repeat(64)}, {...a,backendUrl:'https://untrusted.test'})).toMatchObject({ok:true});
  expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toMatchObject({terminalToken:'token-a',deviceBindingProof:'a'.repeat(64)});
  expect(write).toHaveBeenCalledWith(expect.objectContaining({...existing,deviceBindingProof:'a'.repeat(64)}));
  expect(session.hasPermission('can_process_sale')).toBe(true);
  expect(session.hasPermission('can_manage_sync_backup')).toBe(false);
 }finally{session.clear();}
});

it('re-pairing Management requires admin, connected SQL and no pending work across any branch',async()=>{
 const source=readFileSync(new URL('../../../electron/main.cjs',import.meta.url),'utf8');
 const from=source.indexOf('async function assertSafeRegistrationChange(');
 const to=source.indexOf('function recordRegistrationChange(',from);
 const management={tokenId:'old-management',deviceType:'pc',deviceUse:'management',locationId:''};
 let privileged=false,connected=true,pending=0;
 const query=vi.fn(async()=>({recordset:[{pending}]}));const conflicts=vi.fn<()=>Promise<unknown[]>>(async()=>[]);
 const check=new Function('terminalStore','activationBoundary','adminSession','databaseManager','changeReader','conflictRepository',`${source.slice(from,to)};return assertSafeRegistrationChange;`)({lastBinding:()=>management},policy,{hasLevel:()=>privileged,recoveryActive:()=>false},{isConnected:()=>connected,pool:{request:()=>({query})}},{pendingSummary:vi.fn()}, {unresolved:conflicts});
 const next={...management,tokenId:'new-management'};
 await expect(check(next)).rejects.toThrow('administrator');
 privileged=true;connected=false;await expect(check(next)).rejects.toThrow('Connect the local');
 connected=true;pending=1;await expect(check(next)).rejects.toThrow('pending transactions');
 pending=0;await expect(check(next)).resolves.toBeUndefined();
 expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE acknowledged_at IS NULL'));
 conflicts.mockResolvedValueOnce([{}]);await expect(check(next)).rejects.toThrow('pending transactions');
});

it('offline unchanged legacy mirroring remains available and proof repair validates online',async()=>{
 const source=readFileSync(new URL('../../../electron/main.cjs',import.meta.url),'utf8');
 const from=source.indexOf('async function verifiedTerminalMirror(');
 const to=source.indexOf('function stampVerifiedBranchOperations(',from);
 const existing={...a,backendUrl:'https://saved.test'};
 const fetch=vi.fn(async()=>Response.json({approved:true,terminal:descriptor}));
 const mirror=new Function('terminalStore','activationBoundary','authorizationServerUrl','fetch',`${source.slice(from,to)};return verifiedTerminalMirror;`)({read:()=>existing},policy,()=>existing.backendUrl,fetch);
 expect(await mirror({...a,backendUrl:'https://untrusted.test'})).toEqual(existing);expect(fetch).not.toHaveBeenCalled();
 expect(await mirror({...a,deviceBindingProof:'a'.repeat(64)})).toMatchObject({...existing,deviceBindingProof:'a'.repeat(64)});
 fetch.mockResolvedValueOnce(Response.json({approved:false},{status:403}));
 await expect(mirror({...a,deviceBindingProof:'b'.repeat(64)})).rejects.toThrow('not be verified');
});

it('records reassignment attribution without logging activation or database secrets',()=>{
 const source=readFileSync(new URL('../../../electron/main.cjs',import.meta.url),'utf8');
 const from=source.indexOf('function recordRegistrationChange('),to=source.indexOf('async function verifiedTerminalMirror(',from);
 const log=vi.fn();
 const record=new Function('activationBoundary','diagnostics','adminSession',`${source.slice(from,to)};return recordRegistrationChange;`)(policy,{logConnection:log},{identity:()=>({subject:'admin'})});
 record(a,{...a,tokenId:'replacement-secret',locationId:'B',deviceBindingProof:'claim-secret',supabaseKey:'database-secret'});
 expect(log).toHaveBeenCalledWith('activation.reassignment.succeeded',expect.objectContaining({actor:'admin',previousBranch:'A',branch:'B'}));
 expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
 log.mockClear();record(a,a);expect(log).not.toHaveBeenCalled();
});
