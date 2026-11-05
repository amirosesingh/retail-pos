import { normalizeLegacyRecovery, legacyRecoveryMessage, normalizeLegacyPayload, MAX_UPLOAD_BYTES } from "../../electron/security/legacy-shift-recovery-protocol.cjs";
import { serviceRest } from "@/core/api/pos-relay.server";
import { databaseAuthority } from "./desktop-database-authority.server";
import { supabaseConfig } from "./external-supabase-config";
import type { VerifiedTerminalDescriptor } from "./terminal-binding.server";

export class LegacyRecoveryError extends Error {
  constructor(readonly code: string, readonly status = 403) { super("Legacy shift recovery remains pending administrator review."); }
}
const fail = (code = "ELEGACY_RECOVERY_INVALID", status = 403): never => { throw new LegacyRecoveryError(code, status); };
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const digest = async (raw: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))), x => x.toString(16).padStart(2, "0")).join("");
const binary = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), ch => ch.charCodeAt(0));

/** Called only AFTER the existing endpoint verifies the native device proof.
 * Returns current admin authority for NEW writes; a revoked author can only ask
 * the RPC to read an already accepted identical receipt, never create new work.
 */
export async function verifyLegacyShiftRecovery(input: { terminal: VerifiedTerminalDescriptor; branchId: string; payloadJson: string; attestation: unknown }) {
  let proof: ReturnType<typeof normalizeLegacyRecovery>;
  try { proof = normalizeLegacyRecovery(input.attestation); } catch { return fail(); }
  if (input.terminal.platform !== "pc" || input.terminal.mode !== "operations" || !input.terminal.branchId ||
    !same(input.terminal.id, proof.terminalId) || !same(input.branchId, proof.branchId) || !same(input.terminal.branchId, proof.branchId) ||
    proof.projectOrigin !== new URL(supabaseConfig().url).origin || typeof input.payloadJson !== "string" ||
    new TextEncoder().encode(input.payloadJson).byteLength > MAX_UPLOAD_BYTES || await digest(input.payloadJson) !== proof.payloadHash) return fail();
  let payload: ReturnType<typeof normalizeLegacyPayload>;
  try { payload = normalizeLegacyPayload(JSON.parse(input.payloadJson)); } catch { return fail(); }
  if (payload.recoveryId !== proof.recoveryId || payload.shiftId !== proof.shiftId || !same(payload.branchId, proof.branchId) ||
    !same(payload.terminalId, proof.terminalId) || payload.evidenceHash !== await digest(payload.localGraphText) ||
    payload.cloudWitnessHash !== await digest(payload.cloudGraphText)) return fail();
  let response: Response;
  try { response = await serviceRest("rpc/pos_shift_author_key", { method: "POST", body: JSON.stringify({ p_project_origin: proof.projectOrigin,
    p_terminal_id: proof.terminalId, p_author_id: proof.authorId, p_key_id: proof.keyId }) }); } catch { return fail("ELEGACY_RECOVERY_UNAVAILABLE", 503); }
  if (!response.ok) return fail("ELEGACY_RECOVERY_UNAVAILABLE", 503);
  const value: unknown = await response.json().catch(() => null);
  if (!value || typeof value !== "object" || Array.isArray(value) || !("key" in value)) return fail("ELEGACY_RECOVERY_UNAVAILABLE", 503);
  if (value.key === null) return fail();
  if (!value.key || typeof value.key !== "object" || Array.isArray(value.key)) return fail("ELEGACY_RECOVERY_UNAVAILABLE", 503);
  const key = value.key as Record<string, unknown>;
  if (!["key_id", "author_id", "terminal_id", "project_origin", "public_key", "subject"].every(name => typeof key[name] === "string") ||
    !(key.revoked_at === null || typeof key.revoked_at === "string")) return fail("ELEGACY_RECOVERY_UNAVAILABLE", 503);
  if (key.key_id !== proof.keyId || key.author_id !== proof.authorId || key.terminal_id !== proof.terminalId || key.project_origin !== proof.projectOrigin ||
    key.subject !== proof.subject || typeof key.public_key !== "string" || !(key.revoked_at === null || typeof key.revoked_at === "string")) return fail();
  try {
    const publicKey = await crypto.subtle.importKey("spki", binary(key.public_key), { name: "Ed25519" }, false, ["verify"]);
    const { signature, ...unsigned } = proof;
    if (!await crypto.subtle.verify({ name: "Ed25519" }, publicKey, binary(signature), new TextEncoder().encode(legacyRecoveryMessage(unsigned)))) return fail();
  } catch { return fail(); }
  let authority: Awaited<ReturnType<typeof databaseAuthority>>;
  try { authority = await databaseAuthority({ appUserId: proof.authorId }, { strictAvailability: true }); } catch { return fail("ELEGACY_RECOVERY_UNAVAILABLE", 503); }
  const allowed = key.revoked_at === null && authority?.level === "admin" && authority.authorId === proof.authorId && authority.subject === proof.subject &&
    (!authority.branchId || same(authority.branchId, proof.branchId));
  return { attestation: proof, authority: { allowed, authorId: proof.authorId, subject: proof.subject } };
}
