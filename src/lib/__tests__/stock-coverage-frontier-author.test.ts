import{createRequire}from'node:module';
import{mkdtempSync,readdirSync,rmSync,unlinkSync}from'node:fs';
import{join,resolve,sep}from'node:path';
import{tmpdir}from'node:os';
import{createHash,createPublicKey,verify}from'node:crypto';
import{afterEach,describe,it,expect}from'vitest';
import{stockCoverageFrontierJson}from'../../../electron/shared/stock-coverage-frontier.mjs';
const require=createRequire(import.meta.url),p=require('../../../electron/security/stock-event-author-protocol.cjs'),{createShiftAuthorKeys}=require('../../../electron/security/shift-author-key.cjs');
const author='11111111-1111-4111-8111-111111111111',challenge='22222222-2222-4222-8222-222222222222';
const binding={projectOrigin:'https://stock.fixture',terminalId:'t',authorId:author};
const data=()=>({version:1,...binding,branchId:'a',databaseId:challenge,challengeId:challenge,nonce:'A'.repeat(43),cohortHash:'a'.repeat(64),writerRevision:'stock-history-source.v1',
 sourceSequence:'0',sourceRoot:null,sourceGeneration:'b'.repeat(64),gapHash:'c'.repeat(64),pending:{business:'0',metadata:'0',unsigned:'0',unknown:'0'},observedAt:'2026-11-06T00:00:00.1234567Z'});
const directories:string[]=[];
afterEach(()=>{for(const directory of directories.splice(0)){const resolved=resolve(directory);expect(resolved.startsWith(resolve(tmpdir())+sep)&&resolved.includes('stock-frontier-keys-')).toBe(true);rmSync(resolved,{recursive:true,force:true});}});
function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'stock-frontier-keys-'));directories.push(directory);
 const keys=createShiftAuthorKeys({directory:()=>directory,safeStorage:{isEncryptionAvailable:()=>true,encryptString:(value:string)=>Buffer.from(value),decryptString:(value:Buffer)=>value.toString()}});
 const info=keys.prepare(binding);keys.markEnrolled(binding,{keyId:info.keyId,publicKey:info.publicKey});
 return{keys,info,directory,sign:(frontierJson=stockCoverageFrontierJson(data()))=>keys.signStockCoverageFrontier(binding,{expectedKeyId:info.keyId,subject:'cashier',branchId:'a',frontierJson})};
}
describe('typed coverage frontier in the existing enrolled stock-author domain',()=>{
 it('signs only canonical owned frontier bytes with exact existing enrolled key and explicit purpose',()=>{
  const f=fixture(),before=readdirSync(f.directory),raw=stockCoverageFrontierJson(data()),proof=f.sign(raw);
  expect(proof.frontierHash).toBe(createHash('sha256').update(raw).digest('hex'));expect(proof.challengeId).toBe(challenge);expect(Object.isFrozen(proof)).toBe(true);
  expect(readdirSync(f.directory)).toEqual(before);expect(p.normalizeStockCoverageFrontierProof(proof)).toEqual(proof);
  const{signature,...fields}=proof,key=createPublicKey({key:Buffer.from(f.info.publicKey,'base64url'),format:'der',type:'spki'});
  expect(verify(null,Buffer.from(p.stockCoverageFrontierMessage(fields)),key,Buffer.from(signature,'base64url'))).toBe(true);
  for(const purpose of ['source_cohort.v1','coverage_frontier.v2','retail-pos.financial-operation.v1'])
   expect(verify(null,Buffer.from(p.stockCoverageFrontierMessage(fields).replace('coverage_frontier.v1',purpose)),key,Buffer.from(signature,'base64url'))).toBe(false);
  expect(()=>p.normalizeStockEvent(proof)).toThrow();expect(()=>p.normalizeStockSourceCohortProof(proof)).toThrow();
 });
 it('changing any committed frontier count, generation, challenge or claimed time invalidates its signed hash',()=>{
  const f=fixture(),raw=stockCoverageFrontierJson(data()),proof=f.sign(raw),{signature,...fields}=proof;
  const key=createPublicKey({key:Buffer.from(f.info.publicKey,'base64url'),format:'der',type:'spki'});
  for(const change of [{pending:{...data().pending,business:'1'}},{sourceGeneration:'d'.repeat(64)},{gapHash:'d'.repeat(64)},
   {challengeId:author},{observedAt:'2099-01-01T00:00:00Z'},{nonce:'B'.repeat(42)+'A'}]){
   const changed=stockCoverageFrontierJson({...data(),...change}),frontierHash=createHash('sha256').update(changed).digest('hex');
   expect(verify(null,Buffer.from(p.stockCoverageFrontierMessage({...fields,frontierHash})),key,Buffer.from(signature,'base64url'))).toBe(false);
  }
 });
 it('rejects arbitrary/noncanonical text, forged scope and caller-selected hashes rather than offering a generic signer',()=>{
  const f=fixture();for(const raw of ['{}',JSON.stringify(data()),stockCoverageFrontierJson({...data(),branchId:'A'}),stockCoverageFrontierJson({...data(),authorId:challenge}),stockCoverageFrontierJson({...data(),projectOrigin:'https://other.fixture'}),'x'.repeat(8193)])
   expect(()=>f.sign(raw)).toThrow();
  expect(()=>f.keys.signStockCoverageFrontier(binding,{expectedKeyId:f.info.keyId,subject:'cashier',branchId:'a',frontierJson:stockCoverageFrontierJson(data()),frontierHash:'a'.repeat(64)})).toThrow();
 });
 it('missing original enrolled key remains pending and never creates or rotates material',()=>{
  const f=fixture();for(const name of readdirSync(f.directory))unlinkSync(join(f.directory,name));
  expect(()=>f.sign()).toThrowError(expect.objectContaining({code:'ESYNC_SHIFT_AUTHOR_KEY_MISSING'}));expect(readdirSync(f.directory)).toEqual([]);
 });
});
