import{createRequire}from'node:module';
import{createHash,generateKeyPairSync,sign}from'node:crypto';
import{afterEach,beforeEach,describe,it,expect,vi}from'vitest';
import{stockCoverageFrontierJson}from'../../../electron/shared/stock-coverage-frontier.mjs';
const require=createRequire(import.meta.url),{CloudClient}=require('../../../electron/sync/cloud-client.cjs'),protocol=require('../../../electron/security/stock-event-author-protocol.cjs');
const terminalId='11111111-1111-4111-8111-111111111111',author='22222222-2222-4222-8222-222222222222',key='33333333-3333-4333-8333-333333333333',challenge='44444444-4444-4444-8444-444444444444';
const pair=generateKeyPairSync('ed25519'),tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const challengeInput=()=>({branchId:'a',terminalId,challengeId:challenge,authorId:author,keyId:key});
function acceptance(){
 const frontierJson=stockCoverageFrontierJson({version:1,projectOrigin:'https://project.test',branchId:'a',terminalId,authorId:author,databaseId:'55555555-5555-4555-8555-555555555555',
  challengeId:challenge,nonce:'A'.repeat(43),cohortHash:'a'.repeat(64),writerRevision:'stock-history-source.v1',sourceSequence:'0',sourceRoot:null,sourceGeneration:'b'.repeat(64),gapHash:'c'.repeat(64),
  pending:{business:'0',metadata:'0',unsigned:'0',unknown:'0'},observedAt:'2026-11-06T00:00:00.1234567Z'});
 const fields={version:1,algorithm:'Ed25519',keyId:key,projectOrigin:'https://project.test',terminalId,authorId:author,subject:'cashier',branchId:'a',challengeId:challenge,
  frontierHash:createHash('sha256').update(frontierJson).digest('hex')};
 return{branchId:'a',terminalId,frontierJson,proofJson:JSON.stringify({...fields,signature:sign(null,Buffer.from(protocol.stockCoverageFrontierMessage(fields)),pair.privateKey).toString('base64url')})};
}
type Pending={body:Record<string,any>;resolve:(value:Response)=>void};let pending:Pending[];
beforeEach(()=>{pending=[];vi.stubGlobal('fetch',vi.fn((_url:unknown,options:RequestInit)=>new Promise(resolve=>pending.push({body:JSON.parse(String(options.body)),resolve}))));});
afterEach(()=>vi.unstubAllGlobals());
function fixture(){const terminal={tokenId:terminalId,branchId:'a',locationId:'a',deviceUse:'operations',deviceBindingProof:'a'.repeat(64)},manager={pool:{},profile:{id:'profile',host:'SQL',database:'fixture'}};
 const backend={value:'https://pos.test'},client=new CloudClient({configStore:{get:()=>backend.value},terminalStore:{read:()=>terminal},connectionManager:manager,financialBasisContext:()=>({branchId:'a',projectOrigin:'https://project.test'})});
 return{client,terminal,manager,backend};}
const respond=(index:number,value={})=>pending[index]!.resolve(Response.json(value));
describe('original frontier metadata on the existing serialized data lane',()=>{
 it('gives bounded frontier metadata an upload turn between existing downloads without overlap',async()=>{
  const{client}=fixture(),first=client.counts({branchId:'a'}),download=client.pullBatch({branchId:'a',cursor:0,limit:10}),frontier=client.requestStockFrontierChallenge(challengeInput());
  expect(pending).toHaveLength(1);respond(0);await first;await tick();expect(pending[1]!.body).toHaveProperty('sqlServerStockFrontier.action','challenge');
  respond(1);await frontier;await tick();expect(pending[2]!.body).toHaveProperty('sqlServerPull');respond(2);await download;
 });
 it('retains exact frontier/proof bytes through queueing and lost-response retries',async()=>{
  const{client}=fixture(),input=acceptance(),first=client.counts({branchId:'a'}),accepted=client.acceptStockFrontier(input),original=structuredClone(input);
  input.frontierJson='mutated';respond(0);await first;await tick();expect(pending[1]!.body.sqlServerStockFrontier).toMatchObject(original);respond(1);await accepted;
  const retry=client.acceptStockFrontier(original);await tick();expect(pending[2]!.body).toEqual(pending[1]!.body);respond(2);await retry;
 });
 it.each(['branch','terminal','hash','extra'])('refuses substituted %s before a network request',mode=>{
  const{client}=fixture(),input:Record<string,unknown>=acceptance();if(mode==='branch')input.branchId='A';if(mode==='terminal')input.terminalId=author;
  if(mode==='hash')input.frontierJson=String(input.frontierJson).replace('"business":"0"','"business":"1"');if(mode==='extra')input.authorVerified=true;
  expect(()=>client.acceptStockFrontier(input)).toThrow();expect(pending).toHaveLength(0);
 });
 it('rejects an old queued observation after a SQL profile change without sending it',async()=>{
  const f=fixture(),first=f.client.counts({branchId:'a'}).catch((error:unknown)=>error),next=f.client.requestStockFrontierChallenge(challengeInput()).catch((error:unknown)=>error);
  f.manager.profile.database='changed';respond(0);expect(await first).toMatchObject({code:'ESYNC_REQUEST_CONTEXT_CHANGED'});expect(await next).toMatchObject({code:'ESYNC_REQUEST_CONTEXT_CHANGED'});expect(pending).toHaveLength(1);
 });
});
