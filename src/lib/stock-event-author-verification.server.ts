import { ACTIONS, normalizeStockEvent, type StockEventProof, type StockSourceCohortProof } from "../../electron/security/stock-event-author-protocol.cjs";
import type { VerifiedTerminalDescriptor } from "./terminal-binding.server";
import { stockInstant, canonicalStockInstant } from "./stock-as-of";
import { ShiftAuthorError, verifyStockEventRegistryProof, readVerifiedStockEventAuthor } from "./shift-author-verification.server";
import { canonicalBranchId } from "./branch-id";
import { normalizeStockSourceManifest, stockSourceManifestJson, type StockSourceManifest } from "../../electron/shared/stock-source-manifest.mjs";

const encoder = new TextEncoder();
const denied = (): never => { throw new ShiftAuthorError("ESTOCK_AUTHOR_INVALID", "The original stock-event author could not be verified."); };
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const integer = (value: unknown): value is string => typeof value === "string" && /^-?(?:0|[1-9]\d{0,37})$/.test(value);
const label = (value: unknown, max: number): value is string => typeof value === "string" && !!value && value === value.trim() && value.length <= max && ![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
export type StockEventClaim = { id: string; operationId: string; productId: string; branchId: string; terminalId: string; authorId: string; kind: string;
  quantity: string; effectiveAt: string; recordedAt: string; clockState: "verified" | "unverified"; refs: Array<[string,string,string]>; localDelta: string };

/** Original immutable array bytes are hashed separately; never rebuild a claim
 * from mutable current products, rounded Date values or the uploading cashier. */
export function stockEventClaim(payloadJson: string): StockEventClaim {
  if (typeof payloadJson !== "string" || !payloadJson || encoder.encode(payloadJson).length > 126976) return denied();
  let v: unknown;
  try { v = JSON.parse(payloadJson); } catch { return denied(); }
  if (!Array.isArray(v) || v.length !== 18 || v[0] !== 1 || !uuid(v[1]) || !uuid(v[2]) || !uuid(v[3]) ||
      !label(v[4],128) || !label(v[5],128) || !uuid(v[6]) || !["sale","refund","receiving","stock","product","transfer","sponsorship","missed_bill"].includes(v[7]) || !integer(v[8]) || BigInt(v[8]) === 0n ||
      !integer(v[17]) || typeof v[12] !== "string" || !(v[13] === null || typeof v[13] === "string") ||
      !(v[14] === null || typeof v[14] === "string") || !["verified","unverified"].includes(v[15])) return denied();
  try {
    if (canonicalStockInstant(v[9]) !== v[9] || canonicalStockInstant(v[11]) !== v[11] ||
        String(stockInstant(v[9])) !== v[10] || stockInstant(v[9]) > stockInstant(v[11])) return denied();
  } catch { return denied(); }
  if (!Array.isArray(v[16]) || v[16].length > 2000) return denied();
  const seen = new Set<string>(), totals = new Map<string,bigint>();
  for (const ref of v[16]) {
    if (!Array.isArray(ref) || ref.length !== 3 || !["item_activity_logs","stock_adjustments","stock_delta_applied"].includes(ref[0]) || !uuid(ref[1]) || !integer(ref[2])) return denied();
    const id = `${ref[0]}:${ref[1]}`; if (seen.has(id)) return denied(); seen.add(id);
    totals.set(ref[0], (totals.get(ref[0]) ?? 0n) + BigInt(ref[2]));
  }
  if ([...totals.values()].some(value => value !== BigInt(v[8])) || (BigInt(v[17]) !== 0n && BigInt(v[17]) !== BigInt(v[8]))) return denied();
  return { id:v[1], operationId:v[2], productId:v[3], branchId:v[4], terminalId:v[5], authorId:v[6], kind:v[7], quantity:v[8],
    effectiveAt:v[9], recordedAt:v[11], clockState:v[15], refs:v[16], localDelta:v[17] };
}

/** This verifies authorship, not accepted stock effects, permission to mutate
 * stock, complete history, nor the physical accuracy of a device clock. */
export async function verifyStockEventAuthor(input: { proof: unknown; payloadJson: string; terminal: VerifiedTerminalDescriptor; branchId: string },request?:object) {
  let normalized: StockEventProof;
  try { normalized = normalizeStockEvent(input.proof); } catch { return denied(); }
  const claim = stockEventClaim(input.payloadJson);
  if (input.terminal.platform !== "pc" || input.terminal.mode !== "operations" || !input.terminal.branchId ||
      normalized.terminalId !== input.terminal.id || canonicalBranchId(normalized.branchId) !== canonicalBranchId(input.terminal.branchId) || canonicalBranchId(normalized.branchId) !== canonicalBranchId(input.branchId) ||
      normalized.terminalId !== claim.terminalId || normalized.branchId !== claim.branchId || normalized.authorId !== claim.authorId ||
      normalized.operationId !== claim.operationId || normalized.movementId !== claim.id || ACTIONS[normalized.action].kind !== claim.kind) return denied();
  let source:StockSourceManifest|undefined;
  if(normalized.sourceManifestJson!=null){
    try{source=normalizeStockSourceManifest(JSON.parse(normalized.sourceManifestJson));}catch{return denied();}
    if(stockSourceManifestJson(source)!==normalized.sourceManifestJson||source.operationId!==claim.operationId||source.action!==normalized.action||
      source.authorId!==claim.authorId||source.terminalId!==claim.terminalId||source.branchId!==claim.branchId||source.productId!==claim.productId||
      source.delta!==claim.quantity||source.effectiveAt!==claim.effectiveAt||source.recordedAt!==claim.recordedAt||
      JSON.stringify(source.sourceRefs)!==JSON.stringify(claim.refs))return denied();
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(input.payloadJson)));
  if (normalized.payloadHash !== Array.from(digest,byte => byte.toString(16).padStart(2,"0")).join("")) return denied();
  const proof = await verifyStockEventRegistryProof(normalized,request);
  return { proof, claim, ...(source?{source}:{}), timeGrade: "author_claimed" as const };
}

/** New metadata needs current original-author rights plus the exact accepted
 * source workflow/effect. A background uploader is never the original author. */
export async function readStockEventAuthorPermission(proof: StockEventProof|StockSourceCohortProof,request?:object) {
  const current = await readVerifiedStockEventAuthor(proof,request);
  if (!current.allowed) return current;
  const rule = ACTIONS[proof.action];
  const allowed = current.authority.level === "admin" || (!rule.adminOnly && rule.permissions.every(flag => current.authority.permissions[flag] === true));
  return allowed ? current : { allowed: false as const, code: "ESTOCK_AUTHOR_PERMISSION_REVOKED" };
}
