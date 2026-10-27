import {beforeEach,describe,expect,it,vi} from "vitest";
const rest=vi.hoisted(()=>vi.fn());
vi.mock("@/core/api/pos-relay.server",()=>({serviceRest:rest}));
import {readVerifiedTerminal,terminalDescriptor,terminalProofMatches,TerminalBindingUnavailableError,TerminalBindingDeniedError} from "../terminal-binding.server";
const proof="a".repeat(64);
const row={id:"terminal",platform:"pc",status:"used",location_id:"A",is_claimed:true,claimed_at:"now",claim_proof:proof,claimed_proof_hash:proof,revoked_at:null,management_registration:false};
beforeEach(()=>rest.mockReset().mockResolvedValue(Response.json([row])));
describe("existing live activation validation",()=>{
 it("separates transport/registry outages from authoritative activation denial",async()=>{
  rest.mockRejectedValueOnce(new Error("network"));
  await expect(readVerifiedTerminal("terminal")).rejects.toBeInstanceOf(TerminalBindingUnavailableError);
  rest.mockResolvedValueOnce(new Response(null,{status:503}));
  await expect(readVerifiedTerminal("terminal")).rejects.toMatchObject({status:503});
  rest.mockResolvedValueOnce(Response.json([]));
  await expect(readVerifiedTerminal("terminal")).rejects.toBeInstanceOf(TerminalBindingDeniedError);
 });
 it("accepts operations and legacy single-column proof without modifying activation",async()=>{
  rest.mockResolvedValueOnce(Response.json([{...row,claim_proof:null}]));
  expect(await readVerifiedTerminal("terminal",proof,true)).toEqual({id:"terminal",platform:"pc",mode:"operations",branchId:"A"});
  expect(rest).toHaveBeenCalledTimes(1);expect(rest.mock.calls[0]).toHaveLength(1);
 });
 it.each(["pc","mobile"])("keeps explicitly registered %s management distinct from a missing branch",platform=>{
  expect(terminalDescriptor({...row,platform,location_id:null,management_registration:true})).toMatchObject({mode:"management",branchId:null,platform});
  expect(()=>terminalDescriptor({...row,platform,location_id:null})).toThrow("management designation");
 });
 it("rejects malformed, wrong or empty proof and inactive/unclaimed registrations",async()=>{
  expect(terminalProofMatches(row,proof.toUpperCase())).toBe(true);
  for(const bad of [undefined,"", "b".repeat(64),"x".repeat(64)])expect(terminalProofMatches(row,bad)).toBe(false);
  await expect(readVerifiedTerminal("terminal",undefined,true)).rejects.toThrow("another device");
  for(const changed of [{...row,status:"revoked"},{...row,revoked_at:"now"},{...row,is_claimed:false,claimed_at:null},{...row,platform:"web"},{...row,claimed_platform:"android"}])
    expect(()=>terminalDescriptor(changed)).toThrow();
 });
});
