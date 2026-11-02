import { z } from "zod";
import { serviceRest, verifyRelayCaller } from "@/core/api/pos-relay.server";
import { resolveRelayScope } from "@/core/api/relay-policy.server";
import { databaseAuthority } from "./desktop-database-authority.server";
import { supabaseConfig } from "./external-supabase-config";
import type { VerifiedTerminalDescriptor } from "./terminal-binding.server";
import { normalizeBinding, normalizeEnrollment, normalizeAttestation, normalizeClosingStart, enrollmentMessage, intentMessage, closingStartMessage } from "../../electron/security/shift-author-protocol.cjs";

type Attestation = ReturnType<typeof normalizeAttestation>;
type Enrollment = ReturnType<typeof normalizeEnrollment>;
type Authority = NonNullable<Awaited<ReturnType<typeof databaseAuthority>>>;
type RegistryKey = { key_id: string; author_id: string; terminal_id: string; project_origin: string; public_key: string; subject: string; revoked_at: string | null };
const encoder = new TextEncoder();
const requestSchema = z.object({
  sessionToken: z.string().min(1).max(400).optional(),
  cashierToken: z.string().min(1).max(2000).optional(),
  accessToken: z.string().min(1).max(4000).optional(),
  terminalToken: z.string().min(1).max(200),
  deviceBindingProof: z.string().regex(/^[a-f0-9]{64}$/i),
  enrollment: z.unknown(), signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
}).strict();

export class ShiftAuthorError extends Error {
  constructor(readonly code: string, message: string, readonly status = 403) { super(message); }
}
const denied = (code = "ESHIFT_AUTHOR_INVALID", message = "The protected shift author could not be verified."): never => { throw new ShiftAuthorError(code, message); };
const unavailable = (): never => { throw new ShiftAuthorError("ESHIFT_AUTHOR_UNAVAILABLE", "Author verification is temporarily unavailable. The protected work remains pending.", 503); };
const bytes = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), character => character.charCodeAt(0));
const projectOrigin = () => normalizeBinding({ projectOrigin: supabaseConfig().url, terminalId: "project-check", authorId: "00000000-0000-4000-8000-000000000001" }).projectOrigin;
const sameId = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
const matchingKey = (saved: RegistryKey, attestation: Pick<Attestation, "keyId" | "authorId" | "terminalId" | "projectOrigin" | "subject">) => sameId(saved.key_id, attestation.keyId) && sameId(saved.author_id, attestation.authorId) &&
  sameId(saved.terminal_id, attestation.terminalId) && saved.project_origin === attestation.projectOrigin && saved.subject === attestation.subject;

async function validSignature(publicKey: string, signature: string, message: string): Promise<boolean> {
  try {
    const signatureBytes = bytes(signature);
    if (signatureBytes.length !== 64 || btoa(String.fromCharCode(...signatureBytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") !== signature) return false;
    const key = await crypto.subtle.importKey("spki", bytes(publicKey), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, signatureBytes, encoder.encode(message));
  } catch { return false; }
}

async function registry(binding: { projectOrigin: string; terminalId: string; authorId?: string; keyId?: string }) {
  let response: Response;
  try {
    response = await serviceRest("rpc/pos_shift_author_key", { method: "POST", body: JSON.stringify({
      p_project_origin: binding.projectOrigin, p_terminal_id: binding.terminalId,
      p_author_id: binding.authorId ?? null, p_key_id: binding.keyId ?? null,
    }) });
  } catch { return unavailable(); }
  if (!response.ok) return unavailable();
  const value: unknown = await response.json().catch(() => null);
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof (value as { terminal_enrolled?: unknown }).terminal_enrolled !== "boolean") return unavailable();
  const key = (value as { key?: unknown }).key;
  if (key !== null && (!key || typeof key !== "object" || Array.isArray(key) ||
      !["key_id", "author_id", "terminal_id", "project_origin", "public_key", "subject"].every(name => typeof (key as Record<string, unknown>)[name] === "string") ||
      !((key as RegistryKey).revoked_at === null || typeof (key as RegistryKey).revoked_at === "string"))) return unavailable();
  return { terminalEnrolled: (value as { terminal_enrolled: boolean }).terminal_enrolled, key: key as RegistryKey | null };
}

/** Enrollment establishes identity only. It never grants a shift action or adopts a session. */
export async function enrollShiftAuthor(value: unknown) {
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) throw new ShiftAuthorError("ESHIFT_AUTHOR_INVALID", "Invalid author enrollment request.", 400);
  const input = parsed.data;
  let enrollment: Enrollment;
  try { enrollment = normalizeEnrollment(input.enrollment); } catch { throw new ShiftAuthorError("ESHIFT_AUTHOR_INVALID", "Invalid author enrollment request.", 400); }
  const caller = await verifyRelayCaller(input, { strictAvailability: true });
  const scope = await resolveRelayScope(caller, { strictAvailability: true });
  if (caller.kind === "terminal" || !caller.terminal || caller.terminal.platform !== "pc") return denied();
  let stableCaller = caller;
  // Raw sessions retain their compatibility meaning. They cannot turn a username
  // into a stable signing identity; the independent cashier/Auth proof must do so.
  if (!stableCaller.appUserId && !stableCaller.authUserId && input.accessToken) {
    stableCaller = await verifyRelayCaller({ accessToken: input.accessToken, terminalToken: input.terminalToken, deviceBindingProof: input.deviceBindingProof }, { strictAvailability: true });
  }
  if (!stableCaller.appUserId && !stableCaller.authUserId) return denied("ESHIFT_AUTHOR_IDENTITY_PENDING", "Sign in online with this person's PIN or password once to prepare protected uploads.");
  const authority = await databaseAuthority({ appUserId: stableCaller.appUserId, authUserId: stableCaller.authUserId }, { strictAvailability: true });
  if (!authority?.authorId || authority.subject !== scope.staffUserId) return denied();
  if (!sameId(enrollment.authorId, authority.authorId) || !sameId(enrollment.terminalId, caller.terminal.id) || enrollment.projectOrigin !== projectOrigin()) return denied();
  if (!await validSignature(enrollment.publicKey, input.signature, enrollmentMessage(enrollment))) return denied();
  let response: Response;
  try {
    response = await serviceRest("rpc/pos_shift_author_enroll", { method: "POST", body: JSON.stringify({ p_enrollment: enrollment, p_subject: authority.subject }) });
  } catch { return unavailable(); }
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: string } | null;
    if (error?.message === "SHIFT_AUTHOR_KEY_MISMATCH") throw new ShiftAuthorError("ESHIFT_AUTHOR_KEY_MISMATCH", "The saved author key differs from the enrolled key. Existing signed work remains pending for review.", 409);
    if (error?.message === "SHIFT_AUTHOR_DENIED") return denied();
    return unavailable();
  }
  const saved: unknown = await response.json().catch(() => null);
  if (!saved || typeof saved !== "object" || Array.isArray(saved) || (saved as { ok?: unknown }).ok !== true) return unavailable();
  return { ok: true as const, enrolled: true as const, ...enrollment, subject: authority.subject };
}

/** Cryptographic history validation deliberately precedes current-grant checks. */
export async function verifyShiftAuthorAttestation(input: {
  attestation: unknown; payloadJson: string; terminal: VerifiedTerminalDescriptor;
  branchId: string; shiftId: string; intentId: string; action: "ORIGINAL" | "RECOUNT" | "VARIANCE";
}): Promise<Attestation> {
  let attestation: Attestation;
  try { attestation = normalizeAttestation(input.attestation); } catch { return denied(); }
  if (typeof input.payloadJson !== "string" || encoder.encode(input.payloadJson).byteLength > 6 * 1024 * 1024) return denied();
  if (input.terminal.platform !== "pc" || !sameId(attestation.terminalId, input.terminal.id) || attestation.projectOrigin !== projectOrigin() ||
      !sameId(attestation.branchId, input.branchId) || !sameId(attestation.shiftId, input.shiftId) || !sameId(attestation.intentId, input.intentId) || attestation.action !== input.action ||
      (input.terminal.mode === "operations" && (!input.terminal.branchId || !sameId(attestation.branchId, input.terminal.branchId)))) return denied();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(input.payloadJson)));
  if (attestation.payloadHash !== Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("")) return denied();
  const saved = (await registry(attestation)).key;
  if (!saved || !matchingKey(saved, attestation)) return denied();
  const { signature, ...unsigned } = attestation;
  if (!await validSignature(saved.public_key, signature, intentMessage(unsigned))) return denied();
  return attestation;
}

export type ShiftAuthorAuthority = { allowed: true; authority: Authority } | { allowed: false; code: string };
/** The start domain proves only the saved start event, never a count or correction. */
export async function verifyShiftClosingStart(input: { proof: unknown; terminal: VerifiedTerminalDescriptor; branchId: string; shiftId: string }) {
  let proof: ReturnType<typeof normalizeClosingStart>;
  try { proof = normalizeClosingStart(input.proof); } catch { return denied(); }
  if (input.terminal.platform !== "pc" || !sameId(proof.terminalId, input.terminal.id) || proof.projectOrigin !== projectOrigin() ||
      !sameId(proof.branchId, input.branchId) || !sameId(proof.shiftId, input.shiftId) ||
      (input.terminal.mode === "operations" && (!input.terminal.branchId || !sameId(proof.branchId, input.terminal.branchId)))) return denied();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(proof.payloadJson)));
  if (proof.payloadHash !== Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("")) return denied();
  const saved = (await registry(proof)).key;
  if (!saved || !matchingKey(saved, proof)) return denied();
  const { signature, ...unsigned } = proof;
  if (!await validSignature(saved.public_key, signature, closingStartMessage(unsigned))) return denied();
  return proof;
}
export async function readShiftClosingStartAuthority(value: unknown): Promise<ShiftAuthorAuthority> {
  let proof: ReturnType<typeof normalizeClosingStart>;
  try { proof = normalizeClosingStart(value); } catch { return { allowed: false, code: "ESHIFT_AUTHOR_INVALID" }; }
  const key = (await registry(proof)).key;
  if (!key || !matchingKey(key, proof) || key.revoked_at !== null) return { allowed: false, code: "ESHIFT_AUTHOR_REVOKED" };
  const authority = await databaseAuthority({ appUserId: proof.authorId }, { strictAvailability: true });
  if (!authority?.authorId || authority.authorId !== proof.authorId) return { allowed: false, code: "ESHIFT_AUTHOR_REVOKED" };
  if (authority.branchId && !sameId(authority.branchId, proof.branchId)) return { allowed: false, code: "ESHIFT_AUTHOR_BRANCH_FORBIDDEN" };
  return authority.permissions.can_close_shift === true ? { allowed: true, authority } : { allowed: false, code: "ESHIFT_AUTHOR_PERMISSION_REVOKED" };
}
/** NEW writes use this result. Exact accepted receipts can acknowledge history first. */
export async function readShiftAuthorAuthority(value: unknown): Promise<ShiftAuthorAuthority> {
  let attestation: Attestation;
  try { attestation = normalizeAttestation(value); } catch { return { allowed: false, code: "ESHIFT_AUTHOR_INVALID" }; }
  const key = (await registry(attestation)).key;
  if (!key || !matchingKey(key, attestation) || key.revoked_at !== null) return { allowed: false, code: "ESHIFT_AUTHOR_REVOKED" };
  const authority = await databaseAuthority({ appUserId: attestation.authorId }, { strictAvailability: true });
  if (!authority?.authorId || authority.authorId !== attestation.authorId) return { allowed: false, code: "ESHIFT_AUTHOR_REVOKED" };
  if (authority.branchId && !sameId(authority.branchId, attestation.branchId)) return { allowed: false, code: "ESHIFT_AUTHOR_BRANCH_FORBIDDEN" };
  const permissions = authority.permissions;
  const allowed = attestation.action === "ORIGINAL" ? permissions.can_shift_cash_count === true || permissions.can_close_shift === true :
    permissions[attestation.action === "RECOUNT" ? "can_shift_cash_recount" : "can_shift_variance_approve"] === true;
  return allowed ? { allowed: true, authority } : { allowed: false, code: "ESHIFT_AUTHOR_PERMISSION_REVOKED" };
}
export async function requireCurrentShiftAuthorPermission(attestation: unknown): Promise<Authority> {
  const result = await readShiftAuthorAuthority(attestation);
  if (!result.allowed) return denied(result.code, "This author's current permission does not allow a new protected upload. The work remains pending for review.");
  return result.authority;
}
export async function shiftAuthorTerminalEnrolled(terminalId: string): Promise<boolean> {
  return (await registry({ projectOrigin: projectOrigin(), terminalId })).terminalEnrolled;
}
