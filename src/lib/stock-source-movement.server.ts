import type {StockEventProof} from '../../electron/security/stock-event-author-protocol.cjs';
import type {StockSourceMembership} from '../../electron/shared/stock-source-cohort.mjs';
import type {StockEventClaim} from './stock-event-author-verification.server';
import type {VerifiedTerminalDescriptor} from './terminal-binding.server';
import {ShiftAuthorError} from './shift-author-verification.server';
import {verifyStockSourceCohort,verifyStockSourceCohortMember} from './stock-source-cohort-verification.server';
const cache=new WeakMap<object,Map<string,ReturnType<typeof verifyStockSourceCohort>>>();
const fail=():never=>{throw new ShiftAuthorError('ESTOCK_AUTHOR_INVALID','The original stock source membership could not be verified.');};
/** A bounded original member, not a business write or coverage declaration.
 * The SQL admission still proves its private accepted-business witness/effect. */
export async function verifyStockSourceMovement(input:{sourceCohortJson:string;checked:{proof:StockEventProof;claim:StockEventClaim};
 terminal:VerifiedTerminalDescriptor;branchId:string},request:object){
 const proof=Object.freeze({...input.checked.proof}),claim=Object.freeze({...input.checked.claim,refs:input.checked.claim.refs.map(ref=>[...ref])});
 const terminal=Object.freeze({...input.terminal}),branchId=input.branchId;
 if(typeof input.sourceCohortJson!=='string'||new TextEncoder().encode(input.sourceCohortJson).length>65536)return fail();
 let envelope:{proofJson:string;member:StockSourceMembership;sourceBatchId:string};
 try{envelope=JSON.parse(input.sourceCohortJson);}catch{return fail();}
 if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)||Object.keys(envelope).length!==3||
  !['proofJson','member','sourceBatchId'].every(key=>Object.hasOwn(envelope,key))||typeof envelope.proofJson!=='string'||
  new TextEncoder().encode(envelope.proofJson).length>8192||typeof envelope.sourceBatchId!=='string'||
  !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(envelope.sourceBatchId))return fail();
 let candidate:unknown;try{candidate=JSON.parse(envelope.proofJson);}catch{return fail();}
 let requests=cache.get(request);if(!requests){requests=new Map();cache.set(request,requests);}
 const key=JSON.stringify([envelope.proofJson,branchId,terminal.id,terminal.branchId,terminal.mode,terminal.platform]);
 let waiting=requests.get(key);if(!waiting){waiting=verifyStockSourceCohort({proof:candidate,terminal,branchId},request);requests.set(key,waiting);}
 const cohort=await waiting,source=await verifyStockSourceCohortMember(cohort.proof,envelope.member);
 if(cohort.proof.keyId!==proof.keyId||cohort.proof.authorId!==proof.authorId||cohort.proof.subject!==proof.subject||
  cohort.proof.projectOrigin!==proof.projectOrigin||cohort.proof.action!==proof.action||source.operationId!==claim.operationId||
  source.authorId!==claim.authorId||source.branchId!==claim.branchId||source.terminalId!==claim.terminalId||source.productId!==claim.productId||
  source.delta!==claim.quantity||source.effectiveAt!==claim.effectiveAt||source.recordedAt!==claim.recordedAt||
  JSON.stringify(source.sourceRefs)!==JSON.stringify(claim.refs)||
  (proof.sourceManifestJson!==undefined&&proof.sourceManifestJson!==envelope.member.manifestJson))return fail();
 return Object.freeze({verified:true as const,sourceBatchId:envelope.sourceBatchId,proofJson:envelope.proofJson,
  manifestJson:envelope.member.manifestJson,memberIndex:envelope.member.index,timeGrade:'author_claimed' as const});
}
