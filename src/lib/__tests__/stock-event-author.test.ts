import { createRequire } from "node:module";
import { mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateKeyPairSync, sign, verify, createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const protocol = require("../../../electron/security/stock-event-author-protocol.cjs");
const { createShiftAuthorKeys } = require("../../../electron/security/shift-author-key.cjs");
const { StockEventAuthority } = require("../../../electron/stock-event-authority.cjs");
const contract = require("../../../electron/db/stock-history-contract.cjs");
const author = "10000000-0000-4000-8000-000000000001", other = "10000000-0000-4000-8000-000000000002";
const operation = "20000000-0000-4000-8000-000000000001", product = "30000000-0000-4000-8000-000000000001";
const binding = { projectOrigin: "https://stock.fixture", terminalId: "terminal-a", authorId: author };
const unsigned = { version:1, algorithm:"Ed25519", keyId:other, ...binding, subject:"cashier-a", branchId:"a", operationId:operation, movementId:product, action:"SALE", payloadHash:"a".repeat(64) };
const pair = generateKeyPairSync("ed25519");
const signed = () => ({ ...unsigned, signature:sign(null,Buffer.from(protocol.stockEventMessage(unsigned)),pair.privateKey).toString("base64url") });
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory,{recursive:true,force:true}); });
function fixture() {
 const directory=mkdtempSync(join(tmpdir(),"stock-author-fixture-"));directories.push(directory);
 const safeStorage={isEncryptionAvailable:()=>true,encryptString:(value:string)=>Buffer.from(value),decryptString:(value:Buffer)=>value.toString()};
 const keys=createShiftAuthorKeys({safeStorage,directory:()=>directory}),info=keys.prepare(binding);
 keys.markEnrolled(binding,{keyId:info.keyId,publicKey:info.publicKey});
 const person={source:"pos",level:"staff",authorId:author,canonicalSubject:"cashier-a",branchId:"a"};
 const context={epoch:1,terminal:{tokenId:"terminal-a",locationId:"a",deviceUse:"operations",deviceType:"pc"},project:binding.projectOrigin,branch:"a",profile:"fixture-database",rows:[{project_origin:binding.projectOrigin,terminal_id:"terminal-a",author_id:author,key_id:info.keyId,public_key:info.publicKey}],permission:true};
 const queries:string[]=[];
 class Request { input(){return this;} async query(sql:string){queries.push(sql);return{recordset:context.rows};} }
 const permissionCalls:string[]=[];
 const manager={pool:{},sql:()=>({Request})},session={identity:()=>person,epoch:()=>context.epoch,hasPermission:(flag:string)=>{permissionCalls.push(flag);return context.permission&&flag==='can_process_sale';}};
 const authority=new StockEventAuthority({keys,session,connectionManager:manager,terminal:()=>context.terminal,project:()=>context.project,branch:()=>context.branch,context:()=>context.profile});
 const row=contract.changes(contract.normalizeContext({operationId:operation,branchId:"a",terminalId:"terminal-a",actorId:author,kind:"sale"},"2026-11-06T00:00:00.1234567Z"),[{id:product,name:"Fixture",stock_by_store:{a:2}}],[{id:product,name:"Fixture",stock_by_store:{a:1}}])[0];
 return{directory,keys,info,person,context,queries,manager,authority,row,safeStorage,permissionCalls};
}
describe("dedicated stock author domain",()=>{
 it("binds original author, domain, action, movement and exact hash",()=>{
  const proof=signed();expect(protocol.normalizeStockEvent(proof)).toEqual(proof);
  for(const patch of [{projectOrigin:"https://other.fixture"},{terminalId:"other"},{authorId:other},{keyId:author},{subject:"cashier-b"},{branchId:"b"},{operationId:other},{movementId:other},{action:"REFUND"},{payloadHash:"b".repeat(64)}])
   expect(verify(null,Buffer.from(protocol.stockEventMessage({...unsigned,...patch})),pair.publicKey,Buffer.from(proof.signature,"base64url"))).toBe(false);
  for(const domain of ["retail-pos.financial-operation.v1","retail-pos.shift-author.intent.v1","retail-pos.shift-author.closing-start.v1"])
   expect(verify(null,Buffer.from(protocol.stockEventMessage(unsigned).replace("retail-pos.stock-event.v1",domain)),pair.publicKey,Buffer.from(proof.signature,"base64url"))).toBe(false);
 });
 it.each([{action:"GENERAL"},{action:"ORIGINAL"},{algorithm:"RSA"},{version:2},{keyId:"invalid"},{branchId:" a"},{subject:"cashier\n"},{payloadHash:"A".repeat(64)},{projectOrigin:"http://stock.fixture"},{extra:true},{signature:"A".repeat(85)+"B"}])("rejects malformed or widened evidence %j",patch=>{
  expect(()=>protocol.normalizeStockEvent({...signed(),...patch})).toThrow();
 });
 it("signs with the exact existing enrolled key without rewriting its bytes",()=>{
  const f=fixture(),file=join(f.directory,readdirSync(f.directory)[0]),before=readFileSync(file);
  const proof=f.keys.signStockEvent(binding,{expectedKeyId:f.info.keyId,subject:"cashier-a",branchId:"a",operationId:operation,movementId:product,action:"SALE",payloadHash:"a".repeat(64)});
  expect(verify(null,Buffer.from(protocol.stockEventMessage(unsignedFor(proof))),{key:Buffer.from(f.info.publicKey,"base64url"),type:"spki",format:"der"},Buffer.from(proof.signature,"base64url"))).toBe(true);
  expect(readFileSync(file)).toEqual(before);expect(readdirSync(f.directory)).toHaveLength(1);
 });
 it("never generates missing material, signs with unregistered keys or accepts arbitrary fields",()=>{
  const f=fixture(),file=join(f.directory,readdirSync(f.directory)[0]);
  const input={expectedKeyId:f.info.keyId,subject:"cashier-a",branchId:"a",operationId:operation,movementId:product,action:"SALE",payloadHash:"a".repeat(64)};
  for(const patch of [{expectedKeyId:undefined},{expectedKeyId:other},{payloadJson:"arbitrary"},{payloadHash:"not-hash"}])expect(()=>f.keys.signStockEvent(binding,{...input,...patch})).toThrow();
  unlinkSync(file);expect(()=>f.keys.signStockEvent(binding,input)).toThrow();expect(readdirSync(f.directory)).toHaveLength(0);
  const unenrolled=f.keys.prepare(binding);expect(()=>f.keys.signStockEvent(binding,{...input,expectedKeyId:unenrolled.keyId})).toThrow();
 });
});
function unsignedFor(proof:Record<string,unknown>){const{signature:_signature,...fields}=proof;return fields;}
describe("Main-owned stock author capture",()=>{
 it("uses an existing key reference and freezes real author evidence before another cashier uploads",async()=>{
  const f=fixture(),prepared=await f.authority.prepare(f.authority.capture("SALE")),proof=prepared.signMovement(f.row);
  expect(proof).toMatchObject({authorId:author,subject:"cashier-a",movementId:f.row.id,payloadHash:f.row.payload_hash});
  expect(f.queries).toHaveLength(1);expect(f.queries[0]).toMatch(/^SELECT /);
  f.person.authorId=other;f.person.canonicalSubject="cashier-b";f.context.epoch++;
  expect(()=>prepared.signMovement(f.row)).toThrow();expect(f.authority.validatePending(proof)).toEqual(proof);
 });
 it("records a permitted cashier sale without any inventory/report/export permission",async()=>{
  const f=fixture(),prepared=await f.authority.prepare(f.authority.capture('SALE'));
  expect(prepared.signMovement(f.row)).toMatchObject({action:'SALE',authorId:author});
  expect(new Set(f.permissionCalls)).toEqual(new Set(['can_process_sale']));
 });
 it.each(["epoch","author","subject","branch","terminal","project","pool","profile","permission","management"])('rejects changed %s before a new signature',async change=>{
  const f=fixture(),prepared=await f.authority.prepare(f.authority.capture("SALE"));
  if(change==="epoch")f.context.epoch++;if(change==="author")f.person.authorId=other;if(change==="subject")f.person.canonicalSubject="other";
  if(change==="branch")f.context.branch="b";if(change==="terminal")f.context.terminal.tokenId="other";if(change==="project")f.context.project="https://other.fixture";
  if(change==="pool")f.manager.pool={};if(change==="profile")f.context.profile="other";if(change==="permission")f.context.permission=false;if(change==="management")f.context.terminal.deviceUse="management";
  expect(()=>prepared.signMovement(f.row)).toThrow();
 });
 it("rejects missing key metadata, invalid capture injection, other branches and raw-payload tampering",async()=>{
  const f=fixture();await expect(f.authority.prepare({})).rejects.toThrow();
  const prepared=await f.authority.prepare(f.authority.capture("SALE"));
  for(const row of [{...f.row,actor_id:other},{...f.row,store_id:"b"},{...f.row,payload_json:f.row.payload_json+" "},{...f.row,source_kind:"stock"}])expect(()=>prepared.signMovement(row)).toThrow();
  f.context.rows=[];await expect(f.authority.prepare(f.authority.capture("SALE"))).rejects.toMatchObject({code:"ESYNC_SHIFT_AUTHOR_ENROLLMENT_PENDING"});
  expect(readdirSync(f.directory)).toHaveLength(1);
 });
 it("keeps device clock claims unverified and signatures bind original time bytes",async()=>{
  const f=fixture(),prepared=await f.authority.prepare(f.authority.capture("SALE"));
  const proof=prepared.signMovement(f.row);expect(f.row.clock_state).toBe("unverified");
  const changed=JSON.parse(f.row.payload_json);changed[9]="2020-01-01T00:00:00.0000000Z";
  expect(createHash("sha256").update(JSON.stringify(changed)).digest("hex")).not.toBe(proof.payloadHash);
 });
});
