import{createRequire}from'node:module';
import{mkdtempSync,readdirSync,rmSync,unlinkSync}from'node:fs';
import{join,resolve,sep}from'node:path';
import{tmpdir}from'node:os';
import{createHash,verify}from'node:crypto';
import{afterEach,describe,it,expect}from'vitest';
const require=createRequire(import.meta.url),{createStockCoverageFrontierRuntime:create}=require('../../../electron/stock-coverage-frontier-runtime.cjs');
const{createShiftAuthorKeys}=require('../../../electron/security/shift-author-key.cjs'),p=require('../../../electron/security/stock-event-author-protocol.cjs');
const author='11111111-1111-4111-8111-111111111111',database='22222222-2222-4222-8222-222222222222',binding={projectOrigin:'https://stock.fixture',terminalId:'t',authorId:author};
const directories:string[]=[];
afterEach(()=>{for(const directory of directories.splice(0)){const target=resolve(directory),root=resolve(tmpdir());expect(target.startsWith(root+sep)&&target.includes('stock-frontier-runtime-')).toBe(true);rmSync(target,{recursive:true,force:true});}});
function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'stock-frontier-runtime-'));directories.push(directory);
 const keys=createShiftAuthorKeys({directory:()=>directory,safeStorage:{isEncryptionAvailable:()=>true,encryptString:(s:string)=>Buffer.from(s),decryptString:(b:Buffer)=>b.toString()}});
 const info=keys.prepare(binding);keys.markEnrolled(binding,{keyId:info.keyId,publicKey:info.publicKey});
 const state={epoch:1,pos:true,lease:true,branch:'a',project:binding.projectOrigin,profile:'profile-a',now:0,sqlActive:false,available:true,rows:true,
  generation:'a'.repeat(64),afterChallenge:()=>{},duringSnapshot:(_index:number)=>{},acceptFail:'',snapshotReads:0};
 const person={source:'pos',level:'staff',authorId:author,canonicalSubject:'cashier',branchId:'a'},terminal={tokenId:'t',locationId:'a',deviceUse:'operations',deviceType:'pc'};
 const queries:string[]=[],proofs:Record<string,string>[]=[],challenges:string[]=[],pending={business:'0',metadata:'0',unsigned:'0',unknown:'0'};
 class Request{input(){return this;}async query(sql:string){queries.push(sql);return{recordset:state.rows?[{project_origin:state.project,terminal_id:'t',author_id:author,key_id:info.keyId,public_key:info.publicKey}]:[]};}}
 const manager={pool:{},sql:()=>({Request})},session={identity:()=>person,epoch:()=>state.epoch,hasPosAuthority:()=>state.pos};
 const cloud={async requestStockFrontierChallenge(input:Record<string,string>){expect(state.sqlActive).toBe(false);challenges.push(input.challengeId!);state.afterChallenge();return{ok:true,version:1,branchId:'a',terminalId:'t',challenge:{challengeId:input.challengeId,nonce:'A'.repeat(43),cohortHash:'b'.repeat(64),issuedAt:'2026-11-06T00:00:00.0000000Z',expiresAt:'2026-11-06T00:05:00.0000000Z'}};},
  async acceptStockFrontier(input:Record<string,string>){expect(state.sqlActive).toBe(false);proofs.push(structuredClone(input));if(state.acceptFail){const code=state.acceptFail;state.acceptFail='';throw Object.assign(Error('Synthetic unavailable ACK'),{code});}
   const proof=JSON.parse(input.proofJson!),f=JSON.parse(input.frontierJson!);return{ok:true,version:1,branchId:'a',terminalId:'t',receipt:{challengeId:f.challengeId,frontierHash:proof.frontierHash,state:f.pending.unknown==='0'?'accepted':'unconfirmed',reasons:f.pending.unknown==='0'?[]:['PENDING_UNKNOWN'],acceptedAt:'2026-11-06T00:01:00.1234567Z',observationGrade:'author_claimed'}};}};
 const runtime=create({manager,keys,session,terminal:()=>terminal,branch:()=>state.branch,project:()=>state.project,context:()=>state.profile,cloud,now:()=>state.now,
  readSnapshot:async({assertCurrent,assertLease}:{assertCurrent:()=>void;assertLease:()=>boolean})=>{
   state.sqlActive=true;try{assertCurrent();assertLease();state.snapshotReads++;state.duringSnapshot(state.snapshotReads);
    return state.available?{available:true,databaseId:database,databaseKey:database+':31:fixture',sourceSequence:'0',sourceRoot:null,sourceGeneration:state.generation,gapHash:'c'.repeat(64),pending:{...pending},observedAt:'2026-11-06T00:00:01.1234567Z',coverageProven:false}:{available:false,reason:'SCHEMA_NOT_INSTALLED'};
   }finally{state.sqlActive=false;}
  }});
 return{directory,info,keys,state,person,terminal,manager,cloud,queries,proofs,challenges,pending,runtime,run:()=>runtime.run({assertLease:()=>state.lease})};
}
describe('private Main-owned current SQL frontier factory',()=>{
 it('signs only its own committed SQL snapshot and never holds SQL while waiting for a network response',async()=>{
  const f=fixture(),before=readdirSync(f.directory);expect(await f.run()).toEqual({state:'accepted',coverageProven:false});expect(f.state.snapshotReads).toBe(3);expect(f.queries).toHaveLength(1);expect(f.proofs).toHaveLength(1);
  const input=f.proofs[0]!,proof=JSON.parse(input.proofJson!),{signature,...fields}=proof,frontier=JSON.parse(input.frontierJson!);
  expect(frontier).toMatchObject({branchId:'a',terminalId:'t',authorId:author,databaseId:database,observedAt:'2026-11-06T00:00:01.1234567Z'});
  expect(proof.frontierHash).toBe(createHash('sha256').update(input.frontierJson!).digest('hex'));
  expect(verify(null,Buffer.from(p.stockCoverageFrontierMessage(fields)),{key:Buffer.from(f.info.publicKey,'base64url'),format:'der',type:'spki'},Buffer.from(signature,'base64url'))).toBe(true);
  expect(readdirSync(f.directory)).toEqual(before);expect(f.runtime).not.toHaveProperty('sign');expect(await f.run()).toMatchObject({state:'deferred'});expect(f.challenges).toHaveLength(1);
 });
 it('does no key or network work when optional031 or a current author is unavailable',async()=>{
  const f=fixture();f.state.available=false;expect(await f.run()).toMatchObject({state:'unavailable',reason:'SCHEMA_NOT_INSTALLED'});expect(f.queries).toHaveLength(0);expect(f.challenges).toHaveLength(0);
  f.state.pos=false;expect(await f.run()).toMatchObject({state:'unavailable',reason:'ESTOCK_FRONTIER_AUTHOR_UNAVAILABLE'});expect(f.queries).toHaveLength(0);
 });
 it('does not reuse an old cooldown after the actual SQL pool is replaced under the same profile name',async()=>{
  const f=fixture();await f.run();f.manager.pool={};expect(await f.run()).toMatchObject({state:'accepted'});expect(f.challenges).toHaveLength(2);
 });
 it.each(['profile','epoch','branch','terminal','pool','lease','author'])('refuses changed %s after the network wait, before signing or submitting',async mode=>{
  const f=fixture();f.state.afterChallenge=()=>{if(mode==='profile')f.state.profile='other';if(mode==='epoch')f.state.epoch++;if(mode==='branch')f.state.branch='A';if(mode==='terminal')f.terminal.locationId='A';if(mode==='pool')f.manager.pool={};if(mode==='lease')f.state.lease=false;if(mode==='author')f.person.authorId=database;};
  expect(await f.run()).toMatchObject({state:'unconfirmed',reason:'ESTOCK_HISTORY_CONTEXT_CHANGED'});expect(f.proofs).toHaveLength(0);
 });
 it('refuses a source generation changed during preparation rather than publishing a stale prefix',async()=>{
  const f=fixture();f.state.duringSnapshot=index=>{if(index===3)f.state.generation='d'.repeat(64);};expect(await f.run()).toMatchObject({state:'unconfirmed',reason:'LOCAL_SOURCE_CHANGED'});expect(f.proofs).toHaveLength(0);
 });
 it('retains unknown/offline evidence and never promotes it to complete coverage',async()=>{
  const f=fixture();f.pending.unknown='1';expect(await f.run()).toEqual({state:'unconfirmed',reason:'PENDING_UNKNOWN',coverageProven:false});expect(JSON.parse(f.proofs[0]!.frontierJson!).pending.unknown).toBe('1');
 });
 it('rejects an accepted response contradicting its actual pending SQL evidence',async()=>{
  const f=fixture(),original=f.cloud.acceptStockFrontier;f.pending.unknown='1';f.cloud.acceptStockFrontier=async input=>{const result=await original(input);result.receipt.state='accepted';result.receipt.reasons=[];return result;};
  expect(await f.run()).toMatchObject({state:'unconfirmed',reason:'ESTOCK_FRONTIER_ACK_UNCONFIRMED'});
 });
 it('never enrolls or creates a replacement when the original key reference or vault file is missing',async()=>{
  const f=fixture();f.state.rows=false;expect(await f.run()).toMatchObject({state:'unconfirmed',reason:'ESYNC_SHIFT_AUTHOR_ENROLLMENT_PENDING'});expect(f.challenges).toHaveLength(0);
  f.state.now+=30001;f.state.rows=true;for(const file of readdirSync(f.directory))unlinkSync(join(f.directory,file));
  expect(await f.run()).toMatchObject({state:'unconfirmed',reason:'ESYNC_SHIFT_AUTHOR_KEY_MISSING'});expect(readdirSync(f.directory)).toEqual([]);expect(f.challenges).toHaveLength(0);
 });
 it('retries the exact original private observation after a lost ACK without re-signing or issuing another challenge',async()=>{
  const f=fixture();f.state.acceptFail='ETIMEDOUT';expect(await f.run()).toMatchObject({state:'unconfirmed',reason:'ETIMEDOUT'});const original=structuredClone(f.proofs[0]);
  f.state.now+=30001;expect(await f.run()).toMatchObject({state:'accepted'});expect(f.challenges).toHaveLength(1);expect(f.proofs[1]).toEqual(original);
 });
 it('starts a new nonce after the server expires an uncertain observation, without touching business work',async()=>{
  const f=fixture();f.state.acceptFail='STOCK_FRONTIER_CHALLENGE_STALE';await f.run();f.state.now+=30001;expect(await f.run()).toMatchObject({state:'accepted'});expect(f.challenges).toHaveLength(2);expect(f.challenges[0]).not.toBe(f.challenges[1]);
 });
 it('requires an existing coordinator lease and exposes no arbitrary signer or report-ready assertion',async()=>{
  const f=fixture();expect(await f.runtime.run()).toMatchObject({state:'unavailable',coverageProven:false});expect(f.queries).toHaveLength(0);expect(f.proofs).toHaveLength(0);
 });
});
