import { createRequire } from "node:module";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({rest:vi.fn(),authority:vi.fn()}));
vi.mock("@/core/api/pos-relay.server",()=>({serviceRest:mocks.rest,verifyRelayCaller:vi.fn()}));
vi.mock("../desktop-database-authority.server",()=>({databaseAuthority:mocks.authority}));
vi.mock("../external-supabase-config",()=>({supabaseConfig:()=>({url:"https://stock.fixture",key:"fixture"}),runtimeEnvValue:()=>undefined}));
import { verifyStockEventAuthor, readStockEventAuthorPermission, stockEventClaim } from "../stock-event-author-verification.server";
import { readVerifiedStockEventAuthor } from "../shift-author-verification.server";
const require=createRequire(import.meta.url),contract=require("../../../electron/db/stock-history-contract.cjs"),protocol=require("../../../electron/security/stock-event-author-protocol.cjs");
const author="10000000-0000-4000-8000-000000000001",keyId="10000000-0000-4000-8000-000000000002",operation="20000000-0000-4000-8000-000000000001",product="30000000-0000-4000-8000-000000000001";
const pair=generateKeyPairSync("ed25519"),publicKey=pair.publicKey.export({type:"spki",format:"der"}).toString("base64url");
const terminal={id:"terminal-a",platform:"pc" as const,mode:"operations" as const,branchId:"a"};
let key:Record<string,unknown>,person:{authorId:string;subject:string;level:string;branchId:string|null;permissions:Record<string,boolean>};
const movement=(effectiveAt?:string,recordedAt="2026-11-06T00:00:00.1234567Z")=>contract.changes(contract.normalizeContext({operationId:operation,branchId:"a",terminalId:"terminal-a",actorId:author,kind:"sale",effectiveAt},recordedAt),[{id:product,name:"Fixture",stock_by_store:{a:2}}],[{id:product,name:"Fixture",stock_by_store:{a:1}}])[0];
function proof(payloadJson:string,patch={}){
 const raw=JSON.parse(payloadJson),value={version:1,algorithm:"Ed25519",keyId,projectOrigin:"https://stock.fixture",terminalId:"terminal-a",authorId:author,subject:"cashier-a",branchId:"a",operationId:operation,movementId:raw[1],action:"SALE",payloadHash:createHash("sha256").update(payloadJson).digest("hex"),...patch};
 return{...value,signature:sign(null,Buffer.from(protocol.stockEventMessage(value)),pair.privateKey).toString("base64url")};
}
const check=(payloadJson=movement().payload_json,patch={})=>verifyStockEventAuthor({proof:proof(payloadJson),payloadJson,terminal,branchId:"a",...patch});
beforeEach(()=>{
 key={key_id:keyId,author_id:author,terminal_id:"terminal-a",project_origin:"https://stock.fixture",public_key:publicKey,subject:"cashier-a",revoked_at:null};
 person={authorId:author,subject:"cashier-a",level:"staff",branchId:"a",permissions:{can_process_sale:true}};
 mocks.rest.mockReset().mockImplementation(async()=>Response.json({terminal_enrolled:true,key}));mocks.authority.mockReset().mockImplementation(async()=>person);
});
describe("stock-domain signature and original actor verification",()=>{
 it("authenticates exact original bytes without asserting physical clock or stock-effect acceptance",async()=>{
  const result=await check();expect(result.claim).toMatchObject({authorId:author,quantity:"-1",localDelta:"-1"});expect(result.timeGrade).toBe("author_claimed");
  expect(await readStockEventAuthorPermission(result.proof)).toMatchObject({allowed:true});
  expect(Object.isFrozen(result.proof)).toBe(true);
  expect(()=>{result.proof.action="MISSED_BILL";}).toThrow();
  expect(mocks.authority).toHaveBeenCalledWith({appUserId:author},{strictAvailability:true});
  expect(mocks.rest.mock.calls.every(([route])=>route==="rpc/pos_shift_author_key")).toBe(true);
 });
 it.each(["branch","terminal","platform","management","hash","author","subject","operation","movement","project","key","domain"])('rejects substituted %s',async field=>{
  const raw=movement().payload_json,original=proof(raw);let supplied=original,descriptor=terminal,branchId="a",payloadJson=raw;
  if(field==="branch")branchId="b";if(field==="terminal")descriptor={...terminal,id:"other"};if(field==="platform")descriptor={...terminal,platform:"mobile" as "pc"};if(field==="management")descriptor={...terminal,mode:"management" as "operations"};
  if(field==="hash")payloadJson=raw+" ";
  const changes:Record<string,unknown>={author:{authorId:keyId},subject:{subject:"other"},operation:{operationId:keyId},movement:{movementId:keyId},project:{projectOrigin:"https://other.fixture"},key:{keyId:author}};
  if(changes[field])supplied=proof(raw,changes[field] as object);
  if(field==="domain")supplied={...original,signature:sign(null,Buffer.from(protocol.stockEventMessage(unsigned(original)).replace("retail-pos.stock-event.v1","retail-pos.financial-operation.v1")),pair.privateKey).toString("base64url")};
  await expect(verifyStockEventAuthor({proof:supplied,payloadJson,terminal:descriptor,branchId})).rejects.toMatchObject({code:"ESTOCK_AUTHOR_INVALID"});
 });
 it("does not let an arbitrary normalized proof call current authority without prior crypto verification",async()=>{
  expect(await readVerifiedStockEventAuthor(proof(movement().payload_json) as never)).toMatchObject({allowed:false,code:"ESTOCK_AUTHOR_INVALID"});expect(mocks.authority).not.toHaveBeenCalled();
 });
 it.each(["revoked","inactive","permission","branch","subject","recycled"])('keeps verified accepted history but denies a new claim for %s',async kind=>{
  const result=await check();
  if(kind==="revoked")key.revoked_at="2026-11-07T00:00:00Z";if(kind==="inactive")mocks.authority.mockResolvedValue(null);if(kind==="permission")person.permissions={};
  if(kind==="branch")person.branchId="b";if(kind==="subject")person.subject="other";if(kind==="recycled")person.authorId=keyId;
  expect((await check()).proof).toEqual(result.proof);expect(await readStockEventAuthorPermission(result.proof)).toMatchObject({allowed:false});
 });
 it("preserves existing administrator authority but cannot widen normal terminal scope",async()=>{
  person.level="admin";person.permissions={};person.branchId=null;
  expect(await readStockEventAuthorPermission((await check()).proof)).toMatchObject({allowed:true});await expect(check(undefined,{branchId:"b"})).rejects.toThrow();
 });
 it("keeps non-UUID branch code case distinct after original-author reassignment",async()=>{
  const result=await check();person.branchId="A";
  expect(await readStockEventAuthorPermission(result.proof)).toMatchObject({allowed:false,code:"ESTOCK_AUTHOR_BRANCH_FORBIDDEN"});
 });
 it("preserves UUID branch equivalence without widening code scope",async()=>{
  const branch="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",raw=JSON.parse(movement().payload_json);raw[4]=branch;
  const payloadJson=JSON.stringify(raw);person.branchId=branch.toUpperCase();
  const result=await verifyStockEventAuthor({proof:proof(payloadJson,{branchId:branch}),payloadJson,terminal:{...terminal,branchId:branch.toUpperCase()},branchId:branch});
  expect(await readStockEventAuthorPermission(result.proof)).toMatchObject({allowed:true});
 });
 it.each(["2020-01-01T00:00:00.0000000Z","2026-11-06T00:00:00.1234567Z"])('retains long-offline/backdated %s only as an author-claimed time',async effective=>{
  const result=await check(movement(effective).payload_json);expect(result.timeGrade).toBe("author_claimed");expect(result.claim.clockState).toBe("unverified");
 });
 it("a future device clock remains unproven, while effective-after-recorded corruption is rejected",async()=>{
  const raw=movement("2030-01-01T00:00:00.0000000Z","2030-01-02T00:00:00.0000000Z").payload_json;
  expect((await check(raw)).timeGrade).toBe("author_claimed");
  const invalid=JSON.parse(raw);invalid[9]="2030-01-03T00:00:00.0000000Z";invalid[10]=String(contract.instant(invalid[9]));
  await expect(check(JSON.stringify(invalid))).rejects.toMatchObject({code:"ESTOCK_AUTHOR_INVALID"});
 });
 it("does not treat a native verified-clock label as independently verified physical time",async()=>{
  const row=JSON.parse(movement().payload_json);row[15]="verified";
  expect((await check(JSON.stringify(row))).timeGrade).toBe("author_claimed");
 });
 it("retains outages separately from denied original-author permissions",async()=>{
  mocks.rest.mockRejectedValue(new TypeError("fetch failed"));await expect(check()).rejects.toMatchObject({status:503,code:"ESHIFT_AUTHOR_UNAVAILABLE"});
 });
 it("rejects duplicate source identities, mixed representation totals and malformed raw JSON",()=>{
  const row=JSON.parse(movement().payload_json);row[16]=[["item_activity_logs",product,"-1"],["item_activity_logs",product,"-1"]];
  expect(()=>stockEventClaim(JSON.stringify(row))).toThrow();row[16]=[["item_activity_logs",product,"-1"],["stock_delta_applied",operation,"-2"]];expect(()=>stockEventClaim(JSON.stringify(row))).toThrow();
  for(const bad of ["{}","[]","[","x".repeat(126977)])expect(()=>stockEventClaim(bad)).toThrow();
 });
});
function unsigned(value:Record<string,unknown>){const{signature:_signature,...fields}=value;return fields;}
