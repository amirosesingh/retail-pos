import {createRequire} from 'node:module';
import {generateKeyPairSync,sign,verify} from 'node:crypto';
import {describe,it,expect} from 'vitest';
const require=createRequire(import.meta.url),p=require('../../../electron/security/stock-event-author-protocol.cjs');
const pair=generateKeyPairSync('ed25519');
const base={version:1,algorithm:'Ed25519',keyId:'11111111-1111-4111-8111-111111111111',projectOrigin:'https://stock.fixture',
 terminalId:'t',authorId:'22222222-2222-4222-8222-222222222222',subject:'cashier',branchId:'a',
 operationId:'33333333-3333-4333-8333-333333333333',sourceDatabaseId:'55555555-5555-4555-8555-555555555555',sourceSequence:'1',sourcePredecessorRoot:null,action:'ADJUST',sourceRoot:'a'.repeat(64),sourceCount:3};
const proof=(value=base)=>({...value,signature:sign(null,Buffer.from(p.stockSourceCohortMessage(value)),pair.privateKey).toString('base64url')});
describe('bounded original stock source cohort proof purpose',()=>{
 it('binds root AND count, including the duplicate-last tree count ambiguity',()=>{
  const signed=proof();expect(p.normalizeStockSourceCohortProof(signed)).toEqual(signed);
  expect(verify(null,Buffer.from(p.stockSourceCohortMessage({...base,sourceCount:4})),pair.publicKey,Buffer.from(signed.signature,'base64url'))).toBe(false);
 });
 it.each(['keyId','projectOrigin','terminalId','authorId','subject','branchId','operationId','sourceDatabaseId','sourceSequence','action','sourceRoot','sourceCount'])('protects original %s from substitution',field=>{
  const signed=proof(),change:Record<string,unknown>={...base};
  if(['keyId','authorId','operationId','sourceDatabaseId'].includes(field))change[field]='44444444-4444-4444-8444-444444444444';
  else if(field==='projectOrigin')change[field]='https://other.fixture';else if(field==='action')change[field]='RECEIVE';
  else if(field==='sourceSequence'){change[field]='2';change.sourcePredecessorRoot='b'.repeat(64);}
  else if(field==='sourceRoot')change[field]='b'.repeat(64);else if(field==='sourceCount')change[field]=2;else change[field]='other';
  expect(verify(null,Buffer.from(p.stockSourceCohortMessage(change)),pair.publicKey,Buffer.from(signed.signature,'base64url'))).toBe(false);
 });
 it.each([{sourceCount:0},{sourceCount:2001},{sourceCount:1.5},{sourceCount:'3'},{sourceCount:NaN},{sourceRoot:'A'.repeat(64)},
  {sourceRoot:'a'.repeat(63)},{action:'SALE'},{action:'REFUND'},{action:'GENERAL'},{algorithm:'RSA'},{version:2},{sourceRows:[]},
  {sourceRoot:'x'},{terminalId:' t'},{subject:'cashier\n'},{branchId:' a'},{keyId:'bad'},{sourceDatabaseId:'bad'},
  {sourceSequence:1},{sourceSequence:'0'},{sourceSequence:'01'},{sourceSequence:'9223372036854775808'},{sourceSequence:'2'},
  {sourcePredecessorRoot:'a'.repeat(64)}])('denies malformed/widened source cohort %j',patch=>{
  expect(()=>p.unsignedStockSourceCohort({...base,...patch})).toThrow();
 });
 it('keeps branch codes case-sensitive and canonicalizes only UUID branch spelling',()=>{
  expect(p.stockSourceCohortMessage({...base,branchId:'A'})).not.toBe(p.stockSourceCohortMessage(base));
  const branch='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  expect(p.stockSourceCohortMessage({...base,branchId:branch.toUpperCase()})).toBe(p.stockSourceCohortMessage({...base,branchId:branch}));
 });
 it('cannot replay an ordinary movement or a different domain/purpose as a source cohort',()=>{
  const signed=proof(),ordinary={version:1,algorithm:'Ed25519',keyId:base.keyId,projectOrigin:base.projectOrigin,terminalId:base.terminalId,authorId:base.authorId,subject:base.subject,branchId:base.branchId,operationId:base.operationId,action:base.action,movementId:base.operationId,payloadHash:base.sourceRoot};
  expect(()=>p.normalizeStockEvent(signed)).toThrow();expect(()=>p.normalizeStockSourceCohortProof({...ordinary,signature:signed.signature})).toThrow();
  const message=p.stockSourceCohortMessage(base);
  for(const changed of [message.replace('source_cohort.v1','source_cohort.v2'),message.replace('retail-pos.stock-event.v1','retail-pos.financial-operation.v1'),p.stockEventMessage(ordinary)])
   expect(verify(null,Buffer.from(changed),pair.publicKey,Buffer.from(signed.signature,'base64url'))).toBe(false);
 });
});
