import {createRequire} from 'node:module';
import {generateKeyPairSync,sign} from 'node:crypto';
import {beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rest:vi.fn(),authority:vi.fn()}));
vi.mock('@/core/api/pos-relay.server',()=>({serviceRest:mocks.rest,verifyRelayCaller:vi.fn()}));
vi.mock('../desktop-database-authority.server',()=>({databaseAuthority:mocks.authority}));
vi.mock('../external-supabase-config',()=>({supabaseConfig:()=>({url:'https://stock.fixture',key:'fixture'}),runtimeEnvValue:()=>undefined}));
import {verifyStockSourceCohort,readStockSourceCohortPermission,verifyStockSourceCohortMember} from '../stock-source-cohort-verification.server';
import {createStockEventVerificationRequest} from '../shift-author-verification.server';
import {buildStockSourceCohort} from '../../../electron/shared/stock-source-cohort.mjs';
const require=createRequire(import.meta.url),p=require('../../../electron/security/stock-event-author-protocol.cjs');
const author='11111111-1111-4111-8111-111111111111',keyId='22222222-2222-4222-8222-222222222222',operation='33333333-3333-4333-8333-333333333333';
const pair=generateKeyPairSync('ed25519'),publicKey=pair.publicKey.export({type:'spki',format:'der'}).toString('base64url');
const terminal={id:'t',platform:'pc' as const,mode:'operations' as const,branchId:'a'};
const base={version:1,algorithm:'Ed25519',keyId,projectOrigin:'https://stock.fixture',terminalId:'t',authorId:author,subject:'cashier',branchId:'a',operationId:operation,sourceDatabaseId:'44444444-4444-4444-8444-444444444444',sourceSequence:'1',sourcePredecessorRoot:null,action:'ADJUST',sourceRoot:'a'.repeat(64),sourceCount:1000};
const proof=(patch={})=>{const value={...base,...patch};return{...value,signature:sign(null,Buffer.from(p.stockSourceCohortMessage(value)),pair.privateKey).toString('base64url')};};
let key:Record<string,unknown>,person:{authorId:string;subject:string;level:string;branchId:string|null;permissions:Record<string,boolean>};
beforeEach(()=>{
 key={key_id:keyId,author_id:author,terminal_id:'t',project_origin:'https://stock.fixture',public_key:publicKey,subject:'cashier',revoked_at:null};
 person={authorId:author,subject:'cashier',level:'staff',branchId:'a',permissions:{can_adjust_stock:true}};
 mocks.rest.mockReset().mockImplementation(async()=>Response.json({terminal_enrolled:true,key}));mocks.authority.mockReset().mockImplementation(async()=>person);
});
const check=(patch={})=>verifyStockSourceCohort({proof:proof(),terminal,branchId:'a',...patch});
describe('original bounded source cohort author verification',()=>{
 it('requires the cryptographically verified original header and exact signed count/root for later membership',async()=>{
  const source={version:1,operationId:operation,action:'ADJUST',document:{type:'stock_adjustments',id:operation},authorId:author,terminalId:'t',branchId:'a',
   productId:keyId,delta:'-1',effectiveAt:'2026-11-06T00:00:00.0000001Z',recordedAt:'2026-11-06T00:00:00.0000001Z',sourceRefs:[]};
  const cohort=await buildStockSourceCohort([source]),signed=proof({sourceRoot:cohort.root,sourceCount:cohort.count});
  await expect(verifyStockSourceCohortMember(signed as never,cohort.members[0]!)).rejects.toMatchObject({code:'ESTOCK_AUTHOR_INVALID'});
  const checked=await check({proof:signed});expect(await verifyStockSourceCohortMember(checked.proof,cohort.members[0]!)).toMatchObject(source);
  await expect(verifyStockSourceCohortMember(checked.proof,{...cohort.members[0]!,count:2})).rejects.toMatchObject({code:'ESTOCK_AUTHOR_INVALID'});
  const other=await check({proof:proof({sourceRoot:cohort.root,sourceCount:1,operationId:keyId})});
  await expect(verifyStockSourceCohortMember(other.proof,cohort.members[0]!)).rejects.toMatchObject({code:'ESTOCK_AUTHOR_INVALID'});
 });
 it('verifies one original author signature for a large source count without reporting actual time or stock acceptance',async()=>{
  const request=createStockEventVerificationRequest(),result=await verifyStockSourceCohort({proof:proof(),terminal,branchId:'a'},request);expect(result.proof.sourceCount).toBe(1000);expect(Object.isFrozen(result.proof)).toBe(true);expect(result.timeGrade).toBe('author_claimed');
  expect(await readStockSourceCohortPermission(result.proof,request)).toMatchObject({allowed:true});
  expect(mocks.rest).toHaveBeenCalledTimes(1);expect(mocks.authority).toHaveBeenCalledTimes(1);
  expect(person.permissions.can_view_inventory).toBeUndefined();
 });
 it('cannot forge an in-process verified header to call current authority',async()=>{
  expect(await readStockSourceCohortPermission(proof() as never)).toMatchObject({allowed:false});expect(mocks.authority).not.toHaveBeenCalled();
 });
 it.each(['terminal','branch','management','phone','author','key','subject','project','signature','purpose','count'])('rejects cohort substitution %s',async mode=>{
  let supplied=proof(),descriptor=terminal,branchId='a';
  if(mode==='terminal')descriptor={...terminal,id:'other'};if(mode==='branch')branchId='b';if(mode==='management')descriptor={...terminal,mode:'management' as 'operations'};if(mode==='phone')descriptor={...terminal,platform:'mobile' as 'pc'};
  if(mode==='author')supplied=proof({authorId:keyId});if(mode==='key')supplied=proof({keyId:author});if(mode==='subject')supplied=proof({subject:'other'});if(mode==='project')supplied=proof({projectOrigin:'https://other.fixture'});
  if(mode==='signature')supplied={...supplied,signature:'A'.repeat(86)};if(mode==='count')supplied={...supplied,sourceCount:999};
  if(mode==='purpose')supplied={...supplied,signature:sign(null,Buffer.from(p.stockSourceCohortMessage(base).replace('source_cohort.v1','source_cohort.v2')),pair.privateKey).toString('base64url')};
  await expect(check({proof:supplied,terminal:descriptor,branchId})).rejects.toMatchObject({code:'ESTOCK_AUTHOR_INVALID'});
 });
 it.each(['revoked','inactive','permission','branch-code-case','subject','different-author'])('does not grant new source admission after original author %s change',async mode=>{
  const result=await check();if(mode==='revoked')key.revoked_at='2026-11-07T00:00:00Z';if(mode==='inactive')mocks.authority.mockResolvedValue(null);
  if(mode==='permission')person.permissions={};if(mode==='branch-code-case')person.branchId='A';if(mode==='subject')person.subject='other';if(mode==='different-author')person.authorId=keyId;
  expect(await readStockSourceCohortPermission(result.proof)).toMatchObject({allowed:false});
 });
 it('coalesces actual registry/account reads only within one private bounded request',async()=>{
  const request=createStockEventVerificationRequest();
  for(let n=0;n<2;n++){const result=await verifyStockSourceCohort({proof:proof(),terminal,branchId:'a'},request);expect(await readStockSourceCohortPermission(result.proof,request)).toMatchObject({allowed:true});}
  expect(mocks.rest).toHaveBeenCalledTimes(1);expect(mocks.authority).toHaveBeenCalledTimes(1);
  person.permissions={};const next=createStockEventVerificationRequest(),result=await verifyStockSourceCohort({proof:proof(),terminal,branchId:'a'},next);
  expect(await readStockSourceCohortPermission(result.proof,next)).toMatchObject({allowed:false});expect(mocks.authority).toHaveBeenCalledTimes(2);
 });
 it('retains a connection outage as unavailable instead of denying the account',async()=>{
  mocks.rest.mockRejectedValue(new TypeError('fetch failed'));await expect(check()).rejects.toMatchObject({code:'ESHIFT_AUTHOR_UNAVAILABLE',status:503});
 });
});
