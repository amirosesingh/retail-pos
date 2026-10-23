import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  createPublicKey,
  publicEncrypt,
} from "node:crypto";
import { serviceRest, verifyRelayCaller } from "@/core/api/pos-relay.server";
import { requireCallerScope, type CallerProof } from "./privileged-caller.server";
import { approvalMethods, APPROVAL_TOKEN_LEASE_MS, OFFLINE_APPROVAL_TOKEN_LEASE_MS } from "./approval-credentials";
import { matchingTotpStep } from "./approval-totp";
import type { AuthorizationRule } from "./authorization";
import { approvalPinEligible } from "./approval-pin-eligibility";
import { loadRuleRows } from "./authorization.server";

type Person = {
  id: string;
  user_id: string;
  full_name: string;
  role: string;
  role_slug: string;
  store_id: string | null;
  is_active: boolean;
  permissions: Record<string, boolean>;
};
type Device = {
  id: string;
  user_id: string;
  terminal_id: string;
  secret_ciphertext: string;
  last_used_step: number;
};
async function rows<T>(path: string): Promise<T[]> {
  const response = await serviceRest(path);
  if (!response.ok) throw new Error("Approval credential records could not be read");
  return (await response.json()) as T[];
}
async function state(
  op: string,
  userId: string,
  terminalId: string | null = null,
  secret: string | null = null,
  step: number | null = null,
) {
  const response = await serviceRest("rpc/approval_token_state", {
    method: "POST",
    body: JSON.stringify({
      p_op: op,
      p_user_id: userId,
      p_terminal_id: terminalId,
      p_secret: secret,
      p_step: step,
    }),
  });
  if (!response.ok) throw new Error("Approval token service needs its database migration");
  return await response.json();
}
function key() {
  const value = process.env["SETTINGS_ENCRYPTION_KEY"];
  if (!value) throw new Error("Approval credential encryption is not configured");
  return createHash("sha256").update(`pos-approval-token-v1:${value}`).digest();
}
function seal(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  return Buffer.concat([
    iv,
    cipher.update(secret, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
}
function unseal(packed: string) {
  const bytes = Buffer.from(packed, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString(
    "utf8",
  );
}
export async function approvalPerson(userId: string) {
  const escaped = userId.replace(/[\\%_]/g, "\\$&");
  return (
    await rows<Person>(
      `app_users?user_id=ilike.${encodeURIComponent(escaped)}&select=id,user_id,full_name,role,role_slug,store_id,is_active,permissions&limit=2`,
    )
  ).find((person) => person.user_id.toLowerCase() === userId.toLowerCase());
}
async function eligible(person: Person, branch: string, rules?: AuthorizationRule[]) {
  return (
    person.is_active &&
    (!person.store_id || person.store_id.toLowerCase() === branch.toLowerCase()) &&
    approvalPinEligible(rules ?? await loadRuleRows(branch), {
      userId: person.user_id,
      role: person.role_slug || person.role,
      storeId: branch,
      active: person.is_active,
    })
  );
}
export async function manageApprovalMethods(
  proof: CallerProof,
  userId: string,
  pinEnabled: boolean,
  totpEnabled: boolean,
) {
  const actor = await requireCallerScope(proof, { permission: "can_manage_staff" });
  const person = await approvalPerson(userId);
  if (!person) throw new Error("Staff account not found");
  if (
    (pinEnabled || totpEnabled) &&
    !(await eligible(person, person.store_id || actor.storeId || ""))
  )
    throw new Error("Assign this user to an approval rule first");
  await state(
    "set_methods",
    person.user_id,
    null,
    JSON.stringify({ pin: pinEnabled, totp: totpEnabled }),
  );
  const { writeSystemAudit } = await import("./system-audit.server");
  await writeSystemAudit({
    actorId: actor.staffUserId || actor.label,
    actorName: actor.actorName || actor.label,
    actorRole: actor.roleSlug || actor.role || "staff",
    actionType: "staff.approval_methods_updated",
    entityAffected: "app_users",
    entityId: person.user_id,
    oldValue: approvalMethods(person.permissions),
    newValue: { pin: pinEnabled, totp: totpEnabled },
  });
  return { ok: true as const };
}
async function issuerOptions(id: string) {
  const path = `terminal_tokens?id=eq.${encodeURIComponent(id)}&select=`;
  const response = await serviceRest(path + "platform,approval_token_enabled");
  const result = await response.json();
  if (response.ok) return result as { platform: string; approval_token_enabled?: boolean }[];
  if (["42703", "PGRST204"].includes(result?.code) && /approval_token_enabled/.test(result?.message || ""))
    return (await rows<{ platform: string }>(path + "platform")).map(row => ({ ...row, approval_token_enabled: ["mobile", "android", "ios"].includes(row.platform) }));
  throw new Error("Approval credential records could not be read");
}
export async function enrollApprovalToken(proof: CallerProof) {
  const actor = await requireCallerScope(proof);
  if (!actor.staffUserId || actor.stale || actor.kind === "terminal" || !proof.terminalToken)
    throw new Error("Sign in on a registered terminal first");
  const terminal = await verifyRelayCaller({ terminalToken: proof.terminalToken });
  if (!terminal.terminalId) throw new Error("Terminal registration is required");
  const deviceOptions = await issuerOptions(terminal.terminalId);
  if (!["ios", "android", "mobile", "pc", "windows"].includes(deviceOptions[0]?.platform) || deviceOptions[0]?.approval_token_enabled === false)
    return { ok: true as const, credential: null };
  if (actor.storeId && terminal.storeId && actor.storeId.toLowerCase() !== terminal.storeId.toLowerCase())
    throw new Error("Terminal branch does not match the user");
  const person = await approvalPerson(actor.staffUserId);
  if (
    !person ||
    !approvalMethods(person.permissions).totp ||
    !(await eligible(person, terminal.storeId || person.store_id || actor.storeId || ""))
  )
    return { ok: true as const, credential: null };
  const proposed = seal(randomBytes(20).toString("base64"));
  const device = (await state("enroll", person.user_id, terminal.terminalId, proposed)) as Device;
  return {
    ok: true as const,
    credential: {
      id: device.id,
      userId: person.user_id,
      name: person.full_name,
      terminalId: terminal.terminalId,
      branchId: terminal.storeId || person.store_id || "",
      secret: unseal(device.secret_ciphertext),
      validUntil: Date.now() + APPROVAL_TOKEN_LEASE_MS,
    },
  };
}
export async function verifyApprovalTotp(
  userId: string,
  code: string,
  branch: string,
  receiverToken?: string,
) {
  if (!receiverToken) return null;
  const receiver = await verifyRelayCaller({ terminalToken: receiverToken }).catch(() => null);
  if (!receiver?.terminalId || (receiver.storeId && receiver.storeId.toLowerCase() !== branch.toLowerCase()))
    return null;
  const receiverRows = await rows<{ platform: string }>(
    `terminal_tokens?id=eq.${encodeURIComponent(receiverToken)}&select=platform`,
  );
  if (!["windows", "android", "ios", "pc", "mobile"].includes(receiverRows[0]?.platform)) return null;
  const person = await approvalPerson(userId);
  if (!person || !approvalMethods(person.permissions).totp || !(await eligible(person, branch)))
    return null;
  const devices = (await state("read", person.user_id)) as Device[];
  for (const device of devices) {
    try {
      const terminal = await verifyRelayCaller({ terminalToken: device.terminal_id });
      if (
        !terminal.terminalId ||
        (person.store_id && terminal.storeId && terminal.storeId.toLowerCase() !== branch.toLowerCase())
      )
        continue;
      const issuer = await issuerOptions(device.terminal_id);
      if (!["ios", "android", "mobile", "pc", "windows"].includes(issuer[0]?.platform) || issuer[0]?.approval_token_enabled === false) continue;
      const step = await matchingTotpStep(unseal(device.secret_ciphertext), code);
      if (step === null || step <= Number(device.last_used_step)) continue;
      if (!(await state("consume", person.user_id, device.terminal_id, null, step))) continue;
      return {
        userId: person.user_id,
        name: person.full_name,
        role: person.role_slug || person.role,
      };
    } catch {
      /* A revoked issuer never supplies a valid approval credential. */
    }
  }
  return null;
}
/** Resolve an eight-digit token only within the receiver's authorized branch.
 * Never pick the first match: short codes are not globally unique identities.
 * This lookup does not consume; the existing verifier performs final validation.
 */
export async function identifyApprovalTotp(code: string, branch: string, receiverToken?: string) {
  if (!/^\d{8}$/.test(code) || !receiverToken) return null;
  const receiver = await verifyRelayCaller({ terminalToken: receiverToken }).catch(() => null);
  if (!receiver?.terminalId || (receiver.storeId && receiver.storeId.toLowerCase() !== branch.toLowerCase())) return null;
  const devices = await state("read_branch", branch) as Device[];
  if (devices.length > 1000) return null; // fail closed, never partially search a large scope
  const matches: Device[] = [];
  for (const device of devices) {
    // A corrupt record makes identity resolution incomplete; fail closed.
    const step = await matchingTotpStep(unseal(device.secret_ciphertext), code);
    if (step !== null) matches.push(device);
  }
  return matches.length === 1 ? matches[0].user_id : null;
}
/** Revalidate one saved device enrollment without a staff login or exposing its secret. */
export async function approvalTokenStatus(terminalToken: string, userId: string, credentialId: string) {
  const terminal = await verifyRelayCaller({ terminalToken });
  if (!terminal.terminalId || !credentialId) return { ok: true as const, active: false };
  const issuer = await issuerOptions(terminal.terminalId);
  if (!["ios", "android", "mobile", "pc", "windows"].includes(issuer[0]?.platform) ||
      issuer[0]?.approval_token_enabled === false) return { ok: true as const, active: false };
  const person = await approvalPerson(userId);
  if (!person?.is_active || !approvalMethods(person.permissions).totp)
    return { ok: true as const, active: false };
  // An all-branch management device has no branch at sign-out. Its code is
  // still checked against the selected branch's rules when it is used.
  const branch = terminal.storeId || person.store_id;
  if (branch && !(await eligible(person, branch))) return { ok: true as const, active: false };
  const devices = await state("read", person.user_id) as Device[];
  return {
    ok: true as const,
    active: devices.some(device => device.id === credentialId && device.terminal_id === terminal.terminalId),
  };
}
export async function registerApprovalVerifier(proof: CallerProof, publicKey: string) {
  const actor = await requireCallerScope(proof, { permission: "can_manage_staff" });
  if (!actor.staffUserId || actor.kind === "terminal" || !proof.terminalToken)
    throw new Error("Staff manager sign-in required");
  const terminal = await verifyRelayCaller({ terminalToken: proof.terminalToken });
  if (
    !terminal.terminalId ||
    !terminal.storeId ||
    (actor.roleSlug !== "admin" && actor.storeId?.toLowerCase() !== terminal.storeId.toLowerCase())
  )
    throw new Error("Terminal branch does not match the manager");
  const registration = await rows<{ platform: string }>(
    `terminal_tokens?id=eq.${encodeURIComponent(terminal.terminalId)}&select=platform`,
  );
  if (!["windows", "pc"].includes(registration[0]?.platform))
    throw new Error("Windows terminal registration required");
  const parsed = createPublicKey(publicKey);
  if (
    parsed.asymmetricKeyType !== "rsa" ||
    Number(parsed.asymmetricKeyDetails?.modulusLength) < 2048
  )
    throw new Error("Invalid verifier key");
  const normalized = parsed.export({ type: "spki", format: "pem" }).toString();
  const previous = (await state("get_verifier", "", terminal.terminalId)) as {
    public_key?: string;
  } | null;
  if (previous?.public_key !== normalized) {
    await state("register_verifier", "", terminal.terminalId, normalized);
    const { writeSystemAudit } = await import("./system-audit.server");
    await writeSystemAudit({
      actorId: actor.staffUserId,
      actorName: actor.actorName || actor.label,
      actorRole: actor.roleSlug || actor.role || "staff",
      actionType: "terminal.approval_verifier_enrolled",
      entityAffected: "terminal_tokens",
      entityId: terminal.terminalId,
      newValue: { branchId: terminal.storeId },
    });
  }
  return { ok: true as const };
}
function encryptVerifierBundle(publicKey: string, bundle: unknown) {
  const secret = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(bundle), "utf8"), cipher.final()]);
  return {
    ok: true,
    sealedKey: publicEncrypt({ key: publicKey, oaepHash: "sha256" }, secret).toString("base64"),
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}
/** Main-process only: registered Windows tills receive branch-scoped verifier bundles. */
export async function approvalVerifierBundle(terminalToken: string) {
  const terminal = await verifyRelayCaller({ terminalToken });
  if (terminal.kind !== "terminal" || !terminal.terminalId || !terminal.storeId)
    throw new Error("Registered terminal required");
  const registration = await rows<{ platform: string }>(
    `terminal_tokens?id=eq.${encodeURIComponent(terminalToken)}&select=platform`,
  );
  if (!["windows", "pc"].includes(registration[0]?.platform))
    throw new Error("Only Windows SQL tills may receive offline verifiers");
  const verifier = (await state("get_verifier", "", terminal.terminalId)) as {
    public_key?: string;
  } | null;
  if (!verifier?.public_key)
    throw new Error("A staff manager must sign in once to enroll this Windows verifier");
  const people = await rows<Person>(
    `app_users?is_active=eq.true&or=(store_id.is.null,store_id.eq.${encodeURIComponent(terminal.storeId)})&select=id,user_id,full_name,role,role_slug,store_id,is_active,permissions`,
  );
  const branchRules = await loadRuleRows(terminal.storeId);
  const allowed = new Set<string>();
  for (const person of people)
    if (approvalMethods(person.permissions).totp && await eligible(person, terminal.storeId, branchRules)) allowed.add(person.user_id);
  const entries: { userId: string; id: string; secret: string; lastUsedStep: number }[] = [];
  // One protected SQL join validates issuer registrations; avoid a network round trip per user/device.
  for (const device of await state("read_branch", terminal.storeId) as Device[]) {
    if (!allowed.has(device.user_id)) continue;
    entries.push({ userId: device.user_id, id: device.id, secret: unseal(device.secret_ciphertext), lastUsedStep: Number(device.last_used_step) });
  }
  return encryptVerifierBundle(verifier.public_key, {
    ok: true,
    terminalId: terminal.terminalId,
    branchId: terminal.storeId,
    validUntil: Date.now() + OFFLINE_APPROVAL_TOKEN_LEASE_MS,
    entries,
  });
}
