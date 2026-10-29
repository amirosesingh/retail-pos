import { timingSafeEqual } from "node:crypto";
import { serviceRest } from "@/core/api/pos-relay.server";
import { sameRecordId } from "./sale-identity";

export type VerifiedTerminalDescriptor={id:string;platform:"pc"|"mobile";mode:"operations"|"management";branchId:string|null};
export type TerminalBindingRow={id:string;platform?:string;status?:string;location_id?:string|null;revoked_at?:string|null;
 is_claimed?:boolean;claimed_at?:string|null;claim_proof?:string|null;claimed_proof_hash?:string|null;
 claimed_platform?:string|null;management_registration?:boolean;location_name?:string|null;device_name?:string|null};

export class TerminalBindingUnavailableError extends Error { readonly status=503; }
export class TerminalBindingDeniedError extends Error { readonly status=401; }

/** Existing claim fingerprint comparison; this is not hardware attestation. */
export function terminalProofMatches(row:TerminalBindingRow,proof:string|undefined):boolean {
 const expected=String(row.claim_proof || row.claimed_proof_hash || "").toLowerCase();
 const supplied=String(proof??"").toLowerCase();
 if(!/^[a-f0-9]{64}$/.test(expected)||!/^[a-f0-9]{64}$/.test(supplied))return false;
 return timingSafeEqual(Buffer.from(expected,"hex"),Buffer.from(supplied,"hex"));
}

export function terminalDescriptor(row:TerminalBindingRow):VerifiedTerminalDescriptor {
 if(!row.id || row.revoked_at || !["active","used"].includes(row.status??"") || !(row.is_claimed===true || row.claimed_at))
  throw new TerminalBindingDeniedError("This terminal has not completed a valid activation.");
 if(row.platform!=="pc" && row.platform!=="mobile")throw new TerminalBindingDeniedError("This activation has an unsupported device type.");
 if(!/^[a-f0-9]{64}$/i.test(String(row.claim_proof || row.claimed_proof_hash || "")))
  throw new TerminalBindingDeniedError("This activation must renew its device binding.");
 if(row.claimed_platform && !(row.platform==="pc" ? row.claimed_platform==="electron" : ["android","ios"].includes(row.claimed_platform)))
  throw new TerminalBindingDeniedError("The activation device types do not match.");
 const branch=typeof row.location_id==="string" ? row.location_id.trim() : "";
 if(!branch && row.management_registration!==true)throw new TerminalBindingDeniedError("This activation has no registered branch or management designation.");
 return {id:row.id,platform:row.platform,mode:branch?"operations":"management",branchId:branch||null};
}

/** Read-only validation: never claims, provisions or repairs a registration. */
export async function readVerifiedTerminal(id:string,proof?:string,requireProof=false):Promise<VerifiedTerminalDescriptor>{
 let response:Response;
 try { response=await serviceRest(`terminal_tokens?id=eq.${encodeURIComponent(id)}&select=id,platform,status,location_id,revoked_at,is_claimed,claimed_at,claim_proof,claimed_proof_hash,claimed_platform,management_registration&limit=1`); } catch { throw new TerminalBindingUnavailableError("The terminal activation could not be verified. Check the connection and retry."); }
 if(!response.ok)throw new TerminalBindingUnavailableError("The terminal activation could not be verified. Check the connection and retry.");
 let rows:TerminalBindingRow[];
 try { rows=await response.json() as TerminalBindingRow[]; if(!Array.isArray(rows))throw new Error("Invalid registry response"); } catch { throw new TerminalBindingUnavailableError("The terminal activation could not be verified. Check the connection and retry."); }
 const [row]=rows;
 if(!row || !sameRecordId(row.id,id))throw new TerminalBindingDeniedError("This terminal activation is unavailable.");
 const terminal=terminalDescriptor(row);
 if((requireProof || proof!==undefined) && !terminalProofMatches(row,proof))throw new TerminalBindingDeniedError("This activation belongs to another device.");
 return terminal;
}
