import {createRequire} from 'node:module';
import {generateKeyPairSync,sign,verify} from 'node:crypto';
import {describe,it,expect} from 'vitest';
const require=createRequire(import.meta.url);
const {financialOperationMessage,normalizeFinancialAttestation}=require('../../../electron/security/financial-author-protocol.cjs');
const unsigned={version:1,algorithm:'Ed25519',keyId:'11111111-1111-4111-8111-111111111111',projectOrigin:'https://fixture.example',terminalId:'fixture-terminal',authorId:'22222222-2222-4222-8222-222222222222',subject:'cashier',branchId:'branch-a',operationId:'33333333-3333-4333-8333-333333333333',action:'SALE',payloadHash:'a'.repeat(64)};
const pair=generateKeyPairSync('ed25519');
const proof=()=>({...unsigned,signature:sign(null,Buffer.from(financialOperationMessage(unsigned)),pair.privateKey).toString('base64url')});
describe('separate financial author protocol',()=>{
 it('binds the complete operation context with a distinct message domain',()=>{
  const saved=proof();expect(normalizeFinancialAttestation(saved)).toEqual(saved);
  expect(verify(null,Buffer.from(financialOperationMessage(unsigned)),pair.publicKey,Buffer.from(saved.signature,'base64url'))).toBe(true);
  for(const patch of [{branchId:'branch-b'},{subject:'other'},{action:'REFUND'},{payloadHash:'b'.repeat(64)},{operationId:unsigned.authorId},{terminalId:'other'},{projectOrigin:'https://other.example'}])expect(verify(null,Buffer.from(financialOperationMessage({...unsigned,...patch})),pair.publicKey,Buffer.from(saved.signature,'base64url'))).toBe(false);
  const oldDomain=financialOperationMessage(unsigned).replace('retail-pos.financial-operation.v1','retail-pos.shift-author.intent.v1');
  expect(verify(null,Buffer.from(oldDomain),pair.publicKey,Buffer.from(saved.signature,'base64url'))).toBe(false);
 });
 it.each([{action:'ORIGINAL'},{action:'EXCHANGE'},{version:2},{algorithm:'RSA'},{branchId:' a'},{subject:'x\n'},{payloadHash:'A'.repeat(64)},{keyId:'invalid'},{projectOrigin:'http://fixture.example'},{invented:true}])('rejects unsupported or malformed context %j',patch=>{expect(()=>normalizeFinancialAttestation({...proof(),...patch})).toThrow();});
 it.each(['','x'.repeat(86),'A'.repeat(85)+'B','A'.repeat(87)])('rejects malformed signature %s',signature=>{expect(()=>normalizeFinancialAttestation({...proof(),signature})).toThrow();});
});