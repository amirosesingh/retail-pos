import {createRequire} from 'node:module';
import {generateKeyPairSync,sign,verify} from 'node:crypto';
import {describe,it,expect} from 'vitest';
const require=createRequire(import.meta.url);
const {financialBasisMessage,normalizeFinancialBasisAttestation}=require('../../../electron/security/shift-financial-protocol.cjs');
const {intentMessage,enrollmentMessage}=require('../../../electron/security/shift-author-protocol.cjs');
const pair=generateKeyPairSync('ed25519');
const fields={version:1,algorithm:'Ed25519',keyId:'11111111-1111-4111-8111-111111111111',projectOrigin:'https://fixture.example',terminalId:'terminal',authorId:'22222222-2222-4222-8222-222222222222',subject:'actual.author',branchId:'A',shiftId:'33333333-3333-4333-8333-333333333333',intentId:'44444444-4444-4444-8444-444444444444',action:'ORIGINAL',graphPayloadHash:'a'.repeat(64),basisHash:'b'.repeat(64),serverBasisId:'55555555-5555-4555-8555-555555555555',formula:'canonical-exact-decimal-v2'};
const proof=()=>({...fields,signature:sign(null,Buffer.from(financialBasisMessage(fields)),pair.privateKey).toString('base64url')});
describe('companion shift financial proof domain',()=>{
 it('binds exact graph, basis, server receipt and original author/action context',()=>{
  const saved=proof();expect(normalizeFinancialBasisAttestation(saved)).toEqual(saved);
  expect(verify(null,Buffer.from(financialBasisMessage(fields)),pair.publicKey,Buffer.from(saved.signature,'base64url'))).toBe(true);
  for(const patch of [{projectOrigin:'https://other.example'},{terminalId:'other'},{authorId:fields.shiftId},{subject:'other'},{branchId:'B'},{shiftId:fields.authorId},{intentId:fields.shiftId},{action:'RECOUNT'},{graphPayloadHash:'c'.repeat(64)},{basisHash:'c'.repeat(64)},{serverBasisId:fields.intentId},{keyId:fields.intentId}]){
   expect(verify(null,Buffer.from(financialBasisMessage({...fields,...patch})),pair.publicKey,Buffer.from(saved.signature,'base64url'))).toBe(false);
  }
 });
 it('cannot reuse an old graph or enrollment signature as a financial proof',()=>{
  const {graphPayloadHash,basisHash:_basisHash,serverBasisId:_receipt,formula:_formula,...context}=fields;
  const old={...context,payloadHash:graphPayloadHash};
  const signature=sign(null,Buffer.from(intentMessage(old)),pair.privateKey);
  expect(verify(null,Buffer.from(financialBasisMessage(fields)),pair.publicKey,signature)).toBe(false);
  const enrollment={version:fields.version,algorithm:fields.algorithm,keyId:fields.keyId,projectOrigin:fields.projectOrigin,terminalId:fields.terminalId,authorId:fields.authorId,publicKey:pair.publicKey.export({type:'spki',format:'der'}).toString('base64url')};
  const enrolled=sign(null,Buffer.from(enrollmentMessage(enrollment)),pair.privateKey);
  expect(verify(null,Buffer.from(financialBasisMessage(fields)),pair.publicKey,enrolled)).toBe(false);
  expect(financialBasisMessage(fields)).toContain('retail-pos.shift-financial-basis.v1');
 });
 it.each([{action:'VARIANCE'},{action:'START_CLOSE'},{version:2},{algorithm:'RSA'},{formula:'current-sales-net-refund-v1'},{serverBasisId:null},{serverBasisId:'invalid'},{basisHash:'B'.repeat(64)},{graphPayloadHash:'x'},{subject:' other'},{branchId:'A\n'},{projectOrigin:'http://fixture.example'},{extra:true}])('rejects noncanonical/unsupported context %j',patch=>{expect(()=>normalizeFinancialBasisAttestation({...proof(),...patch})).toThrow();});
 it.each(['','A'.repeat(85)+'B','A'.repeat(87)])('rejects malformed signatures %s',signature=>{expect(()=>normalizeFinancialBasisAttestation({...proof(),signature})).toThrow();});
});

describe('distinct pending opening-origin proof',()=>{
 const {openingFinancialBasisMessage,normalizeOpeningFinancialBasisAttestation}=require('../../../electron/security/shift-financial-protocol.cjs');
 const {serverBasisId:_server,...common}=fields;
 const openingOrigin={localAggregateId:fields.intentId,rowHash:'c'.repeat(64)};
 const origin={...common,openingOrigin};
 const signed=()=>({...origin,signature:sign(null,Buffer.from(openingFinancialBasisMessage(origin)),pair.privateKey).toString('base64url')});
 it('binds the actual opening reference without fabricating a baseline',()=>{
  const p=signed(),normalized=normalizeOpeningFinancialBasisAttestation(p);
  expect(normalized).toEqual(p);expect(normalized).not.toHaveProperty('serverBasisId');expect(Object.isFrozen(normalized.openingOrigin)).toBe(true);
  for(const patch of [{localAggregateId:fields.shiftId},{rowHash:'d'.repeat(64)}])expect(verify(null,Buffer.from(openingFinancialBasisMessage({...origin,openingOrigin:{...openingOrigin,...patch}})),pair.publicKey,Buffer.from(p.signature,'base64url'))).toBe(false);
  expect(verify(null,Buffer.from(financialBasisMessage(fields)),pair.publicKey,Buffer.from(p.signature,'base64url'))).toBe(false);
  expect(()=>normalizeFinancialBasisAttestation(p)).toThrow();expect(()=>normalizeOpeningFinancialBasisAttestation(proof())).toThrow();
 });
 it.each([{serverBasisId:null},{serverBasisId:fields.serverBasisId},{openingOrigin:null},{openingOrigin:{...openingOrigin,extra:true}},{openingOrigin:{rowHash:openingOrigin.rowHash}},{openingOrigin:{...openingOrigin,localAggregateId:'bad'}},{openingOrigin:{...openingOrigin,rowHash:'D'.repeat(64)}},{action:'START_CLOSE'},{formula:'old'},{extra:true}])('rejects ambiguous or unsupported origin shape %j',patch=>{expect(()=>normalizeOpeningFinancialBasisAttestation({...signed(),...patch})).toThrow();});
});
