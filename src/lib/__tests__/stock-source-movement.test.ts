import {beforeEach,describe,it,expect,vi} from 'vitest';
import {buildStockSourceCohort} from '../../../electron/shared/stock-source-cohort.mjs';
const h=vi.hoisted(()=>({registry:vi.fn()}));
vi.mock('../shift-author-verification.server',()=>({
 verifyStockSourceCohortRegistryProof:h.registry,
 readVerifiedStockEventAuthor:vi.fn(),
 ShiftAuthorError:class extends Error{code:string;constructor(code:string,message:string){super(message);this.code=code;}},
}));
import {verifyStockSourceMovement} from '../stock-source-movement.server';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',product='33333333-3333-4333-8333-333333333333';
const at='2026-11-06T01:02:03.1234567Z',terminal={id:'t',branchId:'a',mode:'operations',platform:'pc'} as const;
async function fixture(){
 const source={version:1 as const,operationId:id,action:'ADJUST' as const,document:{type:'stock_adjustments' as const,id:other},authorId:other,
  terminalId:'t',branchId:'a',productId:product,delta:'-1',effectiveAt:at,recordedAt:at,sourceRefs:[['stock_adjustments',other,'-1']] as [string,string,string][]};
 const cohort=await buildStockSourceCohort([source]),header={version:1 as const,algorithm:'Ed25519' as const,keyId:id,projectOrigin:'https://stock.fixture',terminalId:'t',
  authorId:other,subject:'original-cashier',branchId:'a',operationId:id,sourceDatabaseId:other,sourceSequence:'1',sourcePredecessorRoot:null,
  action:'ADJUST' as const,sourceRoot:cohort.root,sourceCount:1,signature:'A'.repeat(86)};
 const envelope={proofJson:JSON.stringify(header),member:cohort.members[0]!,sourceBatchId:other};
 const proof={version:1 as const,algorithm:'Ed25519' as const,keyId:id,projectOrigin:header.projectOrigin,terminalId:'t',authorId:other,subject:header.subject,branchId:'a',
  operationId:id,movementId:id,action:'ADJUST' as const,payloadHash:'a'.repeat(64),sourceManifestJson:cohort.members[0]!.manifestJson,signature:'A'.repeat(86)};
 const claim={id,operationId:id,productId:product,branchId:'a',terminalId:'t',authorId:other,kind:'stock',quantity:'-1',effectiveAt:at,recordedAt:at,
  clockState:'unverified' as const,refs:source.sourceRefs,localDelta:'-1'};
 return{envelope,input:{sourceCohortJson:JSON.stringify(envelope),checked:{proof,claim},terminal:terminal as never,branchId:'a'}};
}
beforeEach(()=>{h.registry.mockReset().mockImplementation(async proof=>Object.freeze(proof));});
describe('source membership composition after original signature verification',()=>{
 it('matches every original row field and keeps author-claimed time distinct from clock/coverage proof',async()=>{
  const f=await fixture(),checked=await verifyStockSourceMovement(f.input,{});
  expect(checked).toEqual({verified:true,sourceBatchId:other,proofJson:f.envelope.proofJson,manifestJson:f.envelope.member.manifestJson,memberIndex:0,timeGrade:'author_claimed'});
  expect(Object.isFrozen(checked)).toBe(true);
 });
 it.each(['keyId','authorId','subject','projectOrigin','action'])('rejects a different event author-proof %s',async(field)=>{
  const f=await fixture();Object.assign(f.input.checked.proof,{[field]:field==='keyId'||field==='authorId'?product:'changed'});
  await expect(verifyStockSourceMovement(f.input,{})).rejects.toMatchObject({code:'ESTOCK_AUTHOR_INVALID'});
 });
 it.each(['operationId','authorId','branchId','terminalId','productId','quantity','effectiveAt','recordedAt','refs'])('rejects different actual claim %s',async(field)=>{
  const f=await fixture();Object.assign(f.input.checked.claim,{[field]:field.endsWith('At')?'2026-11-06T01:02:03.1234568Z':field==='refs'?[]:'changed'});
  await expect(verifyStockSourceMovement(f.input,{})).rejects.toMatchObject({code:'ESTOCK_AUTHOR_INVALID'});
 });
 it.each(['member','root','count','index','sourceBatchId','extra','sourceManifestJson'])('rejects envelope or member substitution: %s',async(mode)=>{
  const f=await fixture(),e=JSON.parse(f.input.sourceCohortJson);
  if(mode==='member')e.member.manifestJson=e.member.manifestJson.replace('"-1"','"-2"');
  if(mode==='root')e.member.root='b'.repeat(64);if(mode==='count')e.member.count=2;if(mode==='index')e.member.index=1;
  if(mode==='sourceBatchId')e.sourceBatchId='invalid';if(mode==='extra')e.authority=true;
  if(mode==='sourceManifestJson')f.input.checked.proof.sourceManifestJson+=' ';
  f.input.sourceCohortJson=JSON.stringify(e);await expect(verifyStockSourceMovement(f.input,{})).rejects.toMatchObject({code:'ESTOCK_AUTHOR_INVALID'});
 });
 it('coalesces identical signed headers only inside the same verified request/scope',async()=>{
  const f=await fixture(),request={};await verifyStockSourceMovement(f.input,request);await verifyStockSourceMovement(f.input,request);
  expect(h.registry).toHaveBeenCalledTimes(1);await verifyStockSourceMovement(f.input,{});expect(h.registry).toHaveBeenCalledTimes(2);
  await expect(verifyStockSourceMovement({...f.input,terminal:{...terminal,branchId:'A'} as never,branchId:'A'},request)).rejects.toMatchObject({code:'ESTOCK_AUTHOR_INVALID'});
 });
 it('preserves temporary registry errors rather than treating them as a valid proof or permission denial',async()=>{
  const f=await fixture(),error=Object.assign(new Error('temporary registry outage'),{status:503,code:'ESHIFT_AUTHOR_UNAVAILABLE'});h.registry.mockRejectedValue(error);
  await expect(verifyStockSourceMovement(f.input,{})).rejects.toMatchObject({status:503,code:'ESHIFT_AUTHOR_UNAVAILABLE'});
 });
});
