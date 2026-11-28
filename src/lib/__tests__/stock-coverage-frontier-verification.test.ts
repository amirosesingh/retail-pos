import{createRequire}from'node:module';
import{generateKeyPairSync,createHash,sign}from'node:crypto';
import{beforeEach,describe,it,expect,vi}from'vitest';
import{stockCoverageFrontierJson}from'../../../electron/shared/stock-coverage-frontier.mjs';
const mocks=vi.hoisted(()=>({rest:vi.fn(),authority:vi.fn()}));
vi.mock('@/core/api/pos-relay.server',()=>({serviceRest:mocks.rest,verifyRelayCaller:vi.fn()}));
vi.mock('../desktop-database-authority.server',()=>({databaseAuthority:mocks.authority}));
vi.mock('../external-supabase-config',()=>({supabaseConfig:()=>({url:'https://stock.fixture',key:'fixture'}),runtimeEnvValue:()=>undefined}));
import{verifyStockCoverageFrontier}from'../stock-coverage-frontier-verification.server';
import{createStockEventVerificationRequest}from'../shift-author-verification.server';
const require=createRequire(import.meta.url),p=require('../../../electron/security/stock-event-author-protocol.cjs');
const author='11111111-1111-4111-8111-111111111111',keyId='22222222-2222-4222-8222-222222222222',challenge='33333333-3333-4333-8333-333333333333';
const pair=generateKeyPairSync('ed25519'),publicKey=pair.publicKey.export({type:'spki',format:'der'}).toString('base64url');
const data=()=>({version:1,projectOrigin:'https://stock.fixture',terminalId:'t',branchId:'a',authorId:author,databaseId:challenge,challengeId:challenge,nonce:'A'.repeat(43),cohortHash:'a'.repeat(64),writerRevision:'stock-history-source.v1',
 sourceSequence:'0',sourceRoot:null,sourceGeneration:'b'.repeat(64),gapHash:'c'.repeat(64),pending:{business:'0',metadata:'0',unsigned:'0',unknown:'0'},observedAt:'2026-11-06T00:00:00.1234567Z'});
function input(change={}){const raw=stockCoverageFrontierJson({...data(),...change}),fields={version:1,algorithm:'Ed25519',keyId,projectOrigin:'https://stock.fixture',terminalId:'t',branchId:'a',authorId:author,subject:'cashier',challengeId:challenge,frontierHash:createHash('sha256').update(raw).digest('hex')};
 return{frontierJson:raw,proof:{...fields,signature:sign(null,Buffer.from(p.stockCoverageFrontierMessage(fields)),pair.privateKey).toString('base64url')},terminal:{id:'t',platform:'pc' as const,mode:'operations' as const,branchId:'a'},branchId:'a'};}
let key:Record<string,unknown>,person:Record<string,unknown>;
beforeEach(()=>{key={key_id:keyId,author_id:author,terminal_id:'t',project_origin:'https://stock.fixture',public_key:publicKey,subject:'cashier',revoked_at:null};person={authorId:author,subject:'cashier',level:'staff',branchId:'a',permissions:{can_process_sale:true}};
 mocks.rest.mockReset().mockImplementation(async()=>Response.json({terminal_enrolled:true,key}));mocks.authority.mockReset().mockImplementation(async()=>person);});
describe('frontier identity remains separate from source/cohort acceptance',()=>{
 it('verifies existing enrolled author and exact canonical hash without requiring report permission or claiming complete',async()=>{
  const checked=await verifyStockCoverageFrontier(input(),createStockEventVerificationRequest());expect(checked.frontier.pending.business).toBe('0');expect(checked.observationGrade).toBe('author_claimed');
  expect(checked).not.toHaveProperty('complete');expect(checked).not.toHaveProperty('allowed');expect(checked).not.toHaveProperty('acceptedPrefix');expect(Object.isFrozen(checked.proof)).toBe(true);
 });
 it.each(['hash','branch','terminal','management','author','revoked-key','reassigned-author','case-terminal'])('rejects substituted %s',async mode=>{
  const value=input();if(mode==='hash')value.frontierJson=stockCoverageFrontierJson({...data(),pending:{...data().pending,business:'1'}});
  if(mode==='branch')value.branchId='A';if(mode==='terminal')value.terminal.id='another';if(mode==='management')value.terminal.mode='management' as never;
  if(mode==='author')person.subject='other';if(mode==='revoked-key')key.revoked_at='2026-11-06T00:00:00Z';if(mode==='reassigned-author')person.branchId='A';
  if(mode==='case-terminal')key.terminal_id='T';await expect(verifyStockCoverageFrontier(value)).rejects.toBeDefined();
 });
 it('keeps registry/authority transport failure distinct from a permission denial',async()=>{
  mocks.rest.mockRejectedValueOnce(new Error('Synthetic unavailable registry'));await expect(verifyStockCoverageFrontier(input())).rejects.toMatchObject({status:503});
  mocks.rest.mockImplementation(async()=>Response.json({terminal_enrolled:true,key}));mocks.authority.mockRejectedValueOnce(Object.assign(new Error('Authority unavailable'),{status:503}));
  await expect(verifyStockCoverageFrontier(input())).rejects.toMatchObject({status:503});
 });
});
