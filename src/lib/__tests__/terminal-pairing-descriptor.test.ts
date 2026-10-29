import {beforeEach,expect,it,vi} from "vitest";
const rest=vi.hoisted(()=>vi.fn());
vi.mock("@/core/api/pos-relay.server",()=>({serviceRest:rest}));
vi.mock("@tanstack/react-router",()=>({createFileRoute:()=>()=>({})}));
vi.mock("../public-api-guard.server",()=>({callerVerifiedDownstream:()=>null}));
vi.mock("../public-cors",()=>({withCors:(r:Response)=>r,corsPreflight:()=>new Response(null)}));
vi.mock("../external-supabase-config",()=>({supabaseConfig:()=>({url:"https://example.test",key:"public"}),publicSupabaseConfig:()=>null}));
import {handlePost} from "@/routes/api/public/terminal-pairing";
const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",proof="a".repeat(64);
const row={id,status:"active",location_id:"A",location_name:"Shop A",device_name:"Till",expires_at:null,claim_proof:proof,revoked_at:null,platform:"pc",is_claimed:false,claimed_at:null,management_registration:false};
const request=()=>new Request("https://pos.example/api/public/terminal-pairing",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({tokenId:id,proofHash:proof})});
beforeEach(()=>rest.mockReset().mockResolvedValue(Response.json([row])));
it("preserves approved preclaim discovery without blessing an unclaimed descriptor",async()=>{
 const response=await handlePost(request());const data=await response.json();
 expect(data).toMatchObject({approved:true,status:"active",locationId:"A",supabaseUrl:"https://example.test"});
 expect(data.terminal).toBeUndefined();expect(response.headers.get("Cache-Control")).toBe("no-store");
});
it.each(["pc","mobile"])("adds canonical claimed %s descriptor and supports valid legacy proofcolumn",async(platform)=>{
 rest.mockResolvedValueOnce(Response.json([{...row,platform,status:"used",is_claimed:true,claimed_at:"now",claim_proof:null,claimed_proof_hash:proof,location_id:null,management_registration:true}]));
 expect(await (await handlePost(request())).json()).toMatchObject({approved:true,terminal:{id,platform,mode:"management",branchId:null}});
});
it("does not reveal an unproven UUID or bless an unclassified null-branch registration",async()=>{
 rest.mockResolvedValueOnce(Response.json([{...row,claim_proof:"b".repeat(64)}]));
 expect(await (await handlePost(request())).json()).toEqual({approved:false});
 rest.mockResolvedValueOnce(Response.json([{...row,status:"used",is_claimed:true,location_id:null}]));
 expect((await handlePost(request())).status).toBe(409);
});
