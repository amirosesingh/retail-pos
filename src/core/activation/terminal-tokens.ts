import { APP_VERSION } from "@/version";
import { setManagementDevice } from "@/lib/management-device";
/**
 * Windows terminal activation tokens.
 *
 * An administrator issues one token per till from Settings → Terminal
 * Activation. The till redeems the code once, then keeps checking the token
 * status so management can disconnect a machine remotely.
 */
import {
  createTenantClient,
  resetExternalClient,
  supabaseExternal,
} from "@/integrations/supabase/external-client";
import {
  ACTIVATION_TTL_MS,
  decryptActivation,
  decryptActivationV1,
  encryptActivationV1,
  isEncryptedV1,
} from "@/lib/terminal-crypto";
import { clearDeviceSecret, getDeviceSecret, setDeviceSecret } from "@/lib/device-secrets";
import { recordActivationAttempt } from "@/core/activation/terminal-activation-log";
import { resetHealthCache } from "@/core/activation/connection-health";
import { canRelay, relayOp } from "@/core/api/sync-relay";
import { backendUrl, saveBackendUrl } from "@/lib/backend-config";
import { posFetch, serverOrigin, serverUnreachableOnDevice } from "@/lib/server-origin";
import {
  canRuntimeClaimToken,
  terminalRuntimePlatform,
  tokenPlatformForRuntime,
  type TerminalPlatform,
} from "@/core/activation/terminal-platform";

import {
  clearTerminalMembershipSupabaseOverride,
  clearTerminalSupabaseOverride,
  publicSupabaseConfig,
  setTerminalMembershipSupabaseOverride,
  setTerminalSupabaseOverride,
  supabaseConfig,
} from "@/lib/external-supabase-config";

export type TokenStatus = "active" | "used" | "revoked";

/** Company HTTPS gateway embedded in activation QR codes. */
function activationBackendUrl(): string | undefined {
  const configured = serverOrigin();
  if (configured) return configured;
  if (typeof window === "undefined") return undefined;
  const origin = window.location.origin.trim().replace(/\/+$/, "");
  return /^https:\/\//i.test(origin) ? origin : undefined;
}

/** Best-effort operating system name from the browser/shell. */
function claimOs(): string {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iOS/i.test(ua)) return "ios";
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac OS/i.test(ua)) return "macos";
  if (/Linux/i.test(ua)) return "linux";
  return "unknown";
}

/** Which kind of machine the code was issued for. */
export type { TerminalPlatform } from "@/core/activation/terminal-platform";

export type TerminalToken = {
  approvalTokenEnabled?: boolean;
  id: string;
  locationId: string | null;
  locationName: string;
  deviceName: string;
  platform: TerminalPlatform;
  status: TokenStatus;
  createdAt: string;
  activatedAt: string | null;
  revokedAt: string | null;
  lastSeenAt: string | null;
  reissuedAt: string | null;
  replacedBy: string | null;
  claimedByDevice: string | null;
  claimedAt: string | null;
  /** single-use flag — true the moment a till redeems the code */
  isClaimed: boolean;
  /** the 15 minute redemption deadline */
  expiresAt: string | null;
  /** app version reported by the device on its last check-in */
  appVersion: string | null;
  /** last time the device finished a successful sync */
  lastSyncAt: string | null;
};

/** The table is not in the generated types, so queries go through a loose view. */
type LooseClient = {
  from: (table: string) => {
    select: (cols: string) => any;
    insert: (rows: unknown) => PromiseLike<{ error: { message: string } | null }>;
    upsert: (
      rows: unknown,
      options?: { onConflict?: string },
    ) => PromiseLike<{ error: { message: string } | null }>;
    update: (values: unknown) => any;
    delete: () => any;
  };
};

const table = () => (supabaseExternal as unknown as LooseClient).from("terminal_tokens");
const storesTable = () => (supabaseExternal as unknown as LooseClient).from("stores");

/** Narrow SECURITY DEFINER helpers — the only token access an unregistered till has. */
const rpc = (fn: string, args: Record<string, unknown>) =>
  (supabaseExternal as unknown as { rpc: (n: string, a: unknown) => PromiseLike<any> }).rpc(
    fn,
    args,
  );

import { deviceProofHash, restoreVerifiedDesktopDeviceProof } from "@/core/activation/device-proof";
import { newReplicaSecret, pairingReplicaSecret, replicaSecretHash } from "@/core/activation/replica-proof";

/** Same helper against a throwaway client for a tenant we are not paired to. */
const rpcOn = (client: unknown, fn: string, args: Record<string, unknown>) =>
  (client as { rpc: (n: string, a: unknown) => PromiseLike<any> }).rpc(fn, args);

/**
 * Point every later call at the tenant this till was activated against, so a
 * packaged terminal needs no environment variables of its own.
 */
function applyTenantOverride(config: TerminalConfig | null): void {
  setManagementDevice(config);
  let changed = false;
  if (config?.supabaseUrl && config?.supabaseKey) {
    changed = setTerminalSupabaseOverride(config.supabaseUrl, config.supabaseKey) || changed;
  } else {
    changed = clearTerminalSupabaseOverride() || changed;
  }
  if (config?.membershipSupabaseUrl && config?.membershipSupabaseKey) {
    changed =
      setTerminalMembershipSupabaseOverride(
        config.membershipSupabaseUrl,
        config.membershipSupabaseKey,
      ) || changed;
  } else {
    changed = clearTerminalMembershipSupabaseOverride() || changed;
  }
  if (changed) resetExternalClient();
  // A probe made for the previous tenant must never make the newly activated
  // tenant look offline for the cache window.
  resetHealthCache();
}

export type TokenLocation = {
  id: string;
  code: string;
  name: string;
  address?: string;
  phone?: string;
};

/**
 * The token row references the central stores table. Locations may still live
 * only in local state (older installs, or a queued sync that never drained),
 * so mirror them up before anything depends on the reference.
 */
export async function ensureLocations(locations: TokenLocation[]): Promise<void> {
  if (!locations.length) return;
  const rows = locations.map((l) => ({
    id: l.id,
    code: l.code,
    name: l.name,
    address: l.address || null,
    phone: l.phone || null,
  }));
  if (canRelay()) {
    const relayed = await relayOp({ kind: "upsert", table: "stores", rows, onConflict: "id" });
    if (!relayed.ok) throw new Error(relayed.error ?? "Could not save branch locations");
    return;
  }
  const { error } = await storesTable().upsert(
    rows,
    { onConflict: "id" },
  );
  if (error) throw error;
}

const asStatus = (value: unknown): TokenStatus =>
  value === "revoked" ? "revoked" : value === "used" ? "used" : "active";

/**
 * Older POS databases predate the `platform` column, and PostgREST then rejects
 * the write with "could not find the platform column ... in the schema cache".
 * Run supabase/schema25.sql to add it; until then those rows are plain PC tills.
 */
const isMissingColumn = (error: { message?: string; code?: string } | null, column: string) =>
  !!error &&
  (error.code === "PGRST204" || /schema cache|does not exist/i.test(error.message ?? "")) &&
  (error.message ?? "").includes(column);

/**
 * Insert a token row, dropping columns an older database does not have yet
 * (`platform`, `is_claimed`, `expires_at` arrive with schema25/schema26).
 */
const UNSUPPORTED_KEY = "pos.terminal_tokens.unsupported.v1";

/** Columns this database has already rejected — remembered so we ask once. */
function unsupportedColumns(): Set<string> {
  const url = supabaseConfig().url;
  if (typeof window === "undefined") return new Set();
  try {
    const saved = JSON.parse(window.localStorage.getItem(UNSUPPORTED_KEY) ?? "{}") as Record<
      string,
      string[]
    >;
    return new Set(saved[url] ?? []);
  } catch {
    return new Set();
  }
}

function rememberUnsupported(column: string): void {
  if (typeof window === "undefined") return;
  const url = supabaseConfig().url;
  try {
    const saved = JSON.parse(window.localStorage.getItem(UNSUPPORTED_KEY) ?? "{}") as Record<
      string,
      string[]
    >;
    const list = new Set(saved[url] ?? []);
    list.add(column);
    saved[url] = [...list];
    window.localStorage.setItem(UNSUPPORTED_KEY, JSON.stringify(saved));
  } catch {
    /* storage unavailable */
  }
}

async function insertTokenRow(row: Record<string, unknown>): Promise<void> {
  const optional = ["platform", "is_claimed", "expires_at"];
  const attempt: Record<string, unknown> = { ...row };
  // Skip straight past the columns this database told us it does not have.
  for (const column of unsupportedColumns()) delete attempt[column];
  for (let i = 0; i <= optional.length; i += 1) {
    const { error } = await table().insert([attempt]);
    if (!error) return;
    const missing = optional.find((c) => c in attempt && isMissingColumn(error, c));
    if (!missing) {
      if (isMissingColumn(error, "approval_token_enabled")) throw new Error("Apply the terminal approval-token migration before saving device token options.");
      throw error;
    }
    rememberUnsupported(missing);
    delete attempt[missing];
  }
  throw new Error("Could not save the activation token");
}

const rowToToken = (r: Record<string, any>): TerminalToken => ({
  approvalTokenEnabled: r.approval_token_enabled === true || (r.approval_token_enabled == null && ["mobile", "android", "ios"].includes(String(r.platform))),
  id: r.id,
  locationId: r.location_id ?? null,
  locationName: r.location_name ?? "",
  deviceName: r.device_name ?? "",
  platform: r.platform === "mobile" || r.platform === "android" || r.platform === "ios" ? "mobile" : "pc",
  status: asStatus(r.status),
  createdAt: r.created_at,
  activatedAt: r.activated_at ?? null,
  revokedAt: r.revoked_at ?? null,
  lastSeenAt: r.last_seen_at ?? null,
  reissuedAt: r.reissued_at ?? null,
  replacedBy: r.replaced_by ?? null,
  claimedByDevice: r.claimed_by_device ?? null,
  claimedAt: r.claimed_at ?? null,
  isClaimed: r.is_claimed === true || asStatus(r.status) === "used",
  expiresAt: r.expires_at ?? null,
  appVersion: r.app_version ?? null,
  lastSyncAt: r.last_sync_at ?? null,
});

/* ----------------------------- admin surface ---------------------------- */

export async function listTerminalTokens(includeRevoked = false): Promise<TerminalToken[]> {
  const columns = "id,location_id,location_name,device_name,platform,status,created_at,activated_at,revoked_at,last_seen_at,reissued_at,replaced_by,claimed_by_device,claimed_at,is_claimed,expires_at,app_version,last_sync_at";
  const read = (withOptions: boolean) => {
    let query = table().select(columns + (withOptions ? ",approval_token_enabled" : "")).is("replaced_by", null);
    if (!includeRevoked) query = query.is("revoked_at", null);
    return query.in("status", includeRevoked ? ["active", "used", "revoked"] : ["active", "used"]).order("created_at", { ascending: false });
  };
  let result = await read(true);
  if (result.error && isMissingColumn(result.error, "approval_token_enabled")) result = await read(false);
  if (result.error) throw result.error;
  return (result.data ?? []).map(rowToToken);
}

/** Create the token row and return the base64 activation code for the till. */
export async function issueTerminalToken(input: {
  location: TokenLocation | null;
  management?: boolean;
  approvalTokenEnabled?: boolean;
  locationName: string;
  deviceName: string;
  /** Defaults to a desktop till. */
  platform?: TerminalPlatform;
  /** reserved id when approving a pairing request scanned off a PC screen */
  tokenId?: string;
  /** sealed device proof captured from a phone-scanned pairing QR */
  claimProof?: string;
  replicaProofHash?: string;
}): Promise<{ token: TerminalToken; code: string }> {
  // Self-healing: guarantee the referenced location row exists.
  if (!input.location && !input.management) throw new Error("Operations terminals require a branch.");
  if (input.management && input.location) throw new Error("Management devices use the signed-in user’s branches.");
  if (input.location) await ensureLocations([input.location]);
  const id = input.tokenId || crypto.randomUUID();
  const issuedAt = Date.now();
  const replica = Boolean(input.management && (input.platform ?? "pc") === "pc");
  if (replica && input.claimProof && !/^[a-f0-9]{64}$/.test(input.replicaProofHash ?? ""))
    throw new Error("Update the PC app and scan its new pairing QR before approving management replication.");
  const replicaSecret = replica && !input.claimProof ? newReplicaSecret() : undefined;
  const replicaHash = replica ? input.claimProof ? input.replicaProofHash : await replicaSecretHash(replicaSecret!) : null;
  const row = {
    id,
    location_id: input.location?.id ?? null,
    approval_token_enabled: input.approvalTokenEnabled ?? Boolean(input.management),
    ...(replica ? { management_sync_enabled: true, management_sync_proof_hash: replicaHash } : {}),
    location_name: input.locationName,
    device_name: input.deviceName,
    platform: input.platform ?? "pc",
    status: "active" as const,
    created_at: new Date(issuedAt).toISOString(),
    is_claimed: false,
    expires_at: new Date(issuedAt + ACTIVATION_TTL_MS).toISOString(),
    ...(input.claimProof ? { claim_proof: input.claimProof } : {}),
  };
  await insertTokenRow(row);
  const membership = publicSupabaseConfig("membership");

  return {
    token: rowToToken(row),
    code: await encryptActivationV1({
      managementSyncSecret: replicaSecret,
      supabaseUrl: supabaseConfig().url,
      supabaseAnonKey: supabaseConfig().key,
      membershipSupabaseUrl: membership?.url,
      membershipSupabaseKey: membership?.key,
      backendUrl: activationBackendUrl(),
      pairToken: id,
      ts: issuedAt,
      deviceName: input.deviceName,
      platform: input.platform ?? "pc",
    }),
  };
}

export async function revokeTerminalToken(id: string): Promise<void> {
  const { data, error } = await table()
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("That terminal registration no longer exists.");
}

/** Device capability is independent of staff permission. No user is granted approval rights here. */
export async function setTerminalApprovalEnabled(id: string, enabled: boolean): Promise<void> {
  const { data, error } = await table().update({ approval_token_enabled: enabled }).eq("id", id).select("id").maybeSingle();
  if (error) {
    if (isMissingColumn(error, "approval_token_enabled")) throw new Error("Apply the terminal approval-token migration before changing this option.");
    throw error;
  }
  if (!data) throw new Error("Terminal was not found or you cannot change it.");
}

/**
 * Replace the code of an existing terminal without creating a second entry for
 * the same counter: the old row is retired and a new row inherits the device
 * name and location, so the branch keeps one row in the table.
 */
export async function reissueTerminalToken(
  token: TerminalToken,
  scope: { locationId: string | null; locationName: string; approvalTokenEnabled: boolean } = { locationId: token.locationId, locationName: token.locationName, approvalTokenEnabled: token.approvalTokenEnabled !== false },
): Promise<{ token: TerminalToken; code: string }> {
  const id = crypto.randomUUID();
  const issuedAt = Date.now();
  const replicaSecret = token.platform === "pc" && !scope.locationId ? newReplicaSecret() : undefined;
  const { data, error } = await rpc("terminal_token_reissue_scoped", {
    p_old_id: token.id, p_new_id: id,
    p_location_id: scope.locationId, p_location_name: scope.locationName,
    p_approval_token_enabled: scope.approvalTokenEnabled,
    p_replica_hash: replicaSecret ? await replicaSecretHash(replicaSecret) : null,
  });
  if (error) {
    if (/terminal_token_reissue_scoped/.test(error.message || "")) throw new Error("Apply the terminal reissue migration before changing a registration’s branch or device use.");
    throw error;
  }
  if (!data) throw new Error("The replacement terminal registration was not returned.");
  const replacement = rowToToken(data as Record<string, unknown>);
  const membership = publicSupabaseConfig("membership");

  return {
    token: replacement,
    code: await encryptActivationV1({
      managementSyncSecret: replicaSecret,
      supabaseUrl: supabaseConfig().url,
      supabaseAnonKey: supabaseConfig().key,
      membershipSupabaseUrl: membership?.url,
      membershipSupabaseKey: membership?.key,
      backendUrl: activationBackendUrl(),
      pairToken: id,
      ts: issuedAt,
      deviceName: token.deviceName,
      platform: token.platform,
    }),
  };
}

/* --------------------------- terminal surface --------------------------- */

export type TerminalConfig = {
  deviceClaimProof?: string | null;
  deviceBindingProof?: string | null;
  tokenId: string;
  deviceUse?: "operations" | "management";
  /** human-readable name of this physical machine, shown everywhere */
  deviceName?: string;
  /** pc or mobile, as recorded when the code was issued */
  deviceType?: "pc" | "mobile";
  locationId: string;
  locationName: string;
  supabaseUrl: string;
  supabaseKey: string;
  membershipSupabaseUrl?: string;
  membershipSupabaseKey?: string;
  backendUrl?: string;
  activatedAt: string;
};

const CONFIG_KEY = "pos.terminal.config";
const EVENT = "pos:terminal-config-changed";

/**
 * The activation is device identity, so it is kept sealed (AES-256-GCM with
 * the per-device key) instead of readable text, and mirrored into the phone's
 * persistent store. Readers stay synchronous through this in-memory copy,
 * which `hydrateTerminalConfig()` fills before the first screen renders.
 */
const SEALED_NAME = "terminal.config";
let cachedConfig: TerminalConfig | null = null;
let hydrated = false;
let hydration: Promise<TerminalConfig | null> | null = null;

const parseConfig = (raw: string | null): TerminalConfig | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TerminalConfig;
    if (!parsed?.tokenId) return null;
    const shell = tokenPlatformForRuntime(terminalRuntimePlatform());
    return {
      ...parsed,
      deviceType: shell ?? parsed.deviceType,
    };
  } catch {
    return null;
  }
};

/** True once the sealed activation has been read back into memory. */
export const isTerminalConfigHydrated = () => hydrated;

/**
 * Unseal the saved activation (migrating an older plain copy) so the till
 * comes back registered after a relaunch, an update or an Android low-memory
 * restart. Safe to call repeatedly.
 */
export async function hydrateTerminalConfig(): Promise<TerminalConfig | null> {
  // A browser is management access, never a registered native terminal. Leave
  // any old saved activation untouched; only the matching native shell may use it.
  if (typeof window === "undefined" || terminalRuntimePlatform() === "web") return null;
  if (hydrated) return cachedConfig;
  if (hydration) return hydration;
  hydration = restoreSavedTerminalConfig();
  try { return await hydration; }
  finally { hydration = null; }
}

async function restoreSavedTerminalConfig(): Promise<TerminalConfig | null> {
  const bridge = desktopBridge();
  if (bridge) {
    let native: Awaited<ReturnType<TerminalBridge["readTerminalConfig"]>>;
    try { native = await bridge.readTerminalConfig(); }
    catch { throw new ActivationError("Could not restore the saved terminal registration. Retry opening the app.", true, "EACTIVATION_STORE"); }
    if (!native?.ok) throw new ActivationError("Could not restore the saved terminal registration. Retry opening the app.", true, "EACTIVATION_STORE");
    if (native.config?.tokenId) {
      publishTerminalConfig(native.config);
      return native.config;
    }
  }
  const legacyRaw = window.localStorage.getItem(CONFIG_KEY);
  const legacy = parseConfig(legacyRaw);
  if (bridge) {
    // An older renderer could publish a registration before Windows accepted
    // it. Either retained format may be stale: sealing can leave an older
    // plaintext fallback, and a failed seal can leave a newer fallback. Main
    // must choose the original binding/proof; storage format is not authority.
    let sealed: TerminalConfig | null = null;
    let sealedUnreadable = false;
    try { sealed = await getDeviceSecret<TerminalConfig>(SEALED_NAME, true); }
    catch { sealedUnreadable = true; }
    const usable = (value: TerminalConfig | null | undefined): value is TerminalConfig => typeof value?.tokenId === "string" && Boolean(value.tokenId.trim());
    const malformed = (legacyRaw != null && !usable(legacy)) || (sealed != null && !usable(sealed));
    const candidates = [sealed, legacy].filter(usable);
    const attempted = new Set<string>();
    let refusal: ActivationError | null = null;
    for (const candidate of candidates) {
      // The two saved objects can have different property order. Distinct
      // candidates are bounded by the two retained formats, not a retry loop.
      const identity = JSON.stringify(Object.entries(candidate).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)));
      if (attempted.has(identity)) continue;
      attempted.add(identity);
      try {
        const restored = await persistDesktopTerminalConfig(candidate, true);
        publishTerminalConfig(restored);
        return restored;
      } catch (error) {
        const candidateFailure = error instanceof ActivationError && error.code && Object.hasOwn(RESTORE_CANDIDATE_FAILURES, error.code);
        // Changed native context, failed vault/read-back, close refusal and
        // transport failures stop recovery. Another copy cannot bypass them.
        if (!candidateFailure) throw error;
        const next = error as ActivationError & { code: keyof typeof RESTORE_CANDIDATE_FAILURES };
        if (!refusal || RESTORE_CANDIDATE_FAILURES[next.code] > RESTORE_CANDIDATE_FAILURES[refusal.code as keyof typeof RESTORE_CANDIDATE_FAILURES]) refusal = next;
      }
    }
    // An unreadable retained copy may be the only current registration. Keep
    // it intact and unknown when no available copy passed native verification.
    if (sealedUnreadable) throw new ActivationError("The encrypted retained registration could not be read. Your saved registration has not been removed. Retry recovery.", true, "EACTIVATION_STORE");
    if (refusal) throw refusal;
    if (malformed) throw new ActivationError("A retained terminal registration is incomplete. Your saved registration has not been removed. Retry recovery.", false, "EBADARG");
    hydrated = true;
    return null;
  }
  if (legacy) {
    cachedConfig = legacy;
    hydrated = true;
    applyTenantOverride(legacy);
    // One-time upgrade: seal it and drop the readable copy.
    try {
      await setDeviceSecret(SEALED_NAME, legacy);
      window.localStorage.removeItem(CONFIG_KEY);
    } catch {
      /* keep the plain copy rather than losing the activation */
    }
    window.dispatchEvent(new CustomEvent(EVENT));
    return cachedConfig;
  }
  let restoreError: unknown;
  try {
    const sealed = await getDeviceSecret<TerminalConfig>(SEALED_NAME, true);
    if (sealed?.tokenId) {
      const shell = tokenPlatformForRuntime(terminalRuntimePlatform());
      cachedConfig = {
        ...sealed,
        deviceType: shell ?? sealed.deviceType,
      };
      applyTenantOverride(cachedConfig);
    }
  } catch (error) {
    restoreError = error;
  }
  if (restoreError) throw new Error("Could not restore the saved terminal registration. Your registration has not been removed.");
  hydrated = true;
  window.dispatchEvent(new CustomEvent(EVENT));
  return cachedConfig;
}

export function readTerminalConfig(): TerminalConfig | null {
  if (typeof window === "undefined" || terminalRuntimePlatform() === "web") return null;
  if (cachedConfig) return cachedConfig;
  if (desktopBridge()) return null;
  // Before hydration finishes an older plain copy is still authoritative.
  return parseConfig(window.localStorage.getItem(CONFIG_KEY));
}

export function writeTerminalConfig(config: TerminalConfig) {
  if (typeof window === "undefined") return;
  publishTerminalConfig(config);
  void setDeviceSecret(SEALED_NAME, config).catch(() => {
    // Last resort so the till is not left unregistered after a restart.
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  });
}

function publishTerminalConfig(config: TerminalConfig) {
  cachedConfig = config;
  hydrated = true;
  if (desktopBridge()) restoreVerifiedDesktopDeviceProof(config.deviceBindingProof);
  applyTenantOverride(config);
  window.dispatchEvent(new CustomEvent(EVENT));
}

export type TerminalClearContext = {
  config: TerminalConfig | null;
  reason: "revoked" | "missing" | "unpair";
  verificationProjectUrl?: string;
  /** Renderer-only guard across async sign-out, restore and native IPC. */
  isCurrent?: () => boolean;
};

const registrationIdentity = (config: TerminalConfig | null) => JSON.stringify([
  config?.tokenId, config?.supabaseUrl?.replace(/\/+$/, ""), config?.locationId,
  config?.deviceUse, config?.deviceBindingProof,
]);

function registrationChanged() {
  return Object.assign(new Error("The terminal registration changed. Its saved credentials were kept. Retry with the current registration."),
    { code: "EACTIVATION_CONTEXT_CHANGED" });
}

/** Clear only the captured registration after native storage confirms it. */
export async function clearTerminalConfig(expected?: TerminalClearContext) {
  if (typeof window === "undefined") return;
  // Finish an already-started restore before deleting its result.
  if (hydration) await hydration.catch(() => undefined);
  const bridge = desktopBridge();
  let current = readTerminalConfig();
  if (!expected && !current && bridge) {
    const saved = await bridge.readTerminalConfig();
    if (!saved?.ok) throw new Error("Could not read the saved terminal registration before clearing it.");
    current = saved.config ?? null;
  }
  const context = expected ?? { config: current, reason: "unpair" as const };
  const identity = registrationIdentity(context.config);
  const rendererIdentity = registrationIdentity(readTerminalConfig());
  if (expected && (identity !== rendererIdentity || expected.isCurrent?.() === false)) throw registrationChanged();
  const request = {
    tokenId: context.config?.tokenId,
    projectUrl: context.config?.supabaseUrl,
    reason: context.reason,
    verificationProjectUrl: context.verificationProjectUrl,
  };
  const cleared = bridge?.clearTerminalConfig ? await bridge.clearTerminalConfig(request) : await bridge?.writeTerminalConfig(null);
  if (bridge && !cleared?.ok) {
    if (cleared?.code === "EACTIVATION_CONTEXT_CHANGED") throw registrationChanged();
    throw new Error(cleared?.error || "Could not clear the saved terminal registration.");
  }
  // The IPC reply may arrive after a fresh activation. Keep that new identity.
  if (registrationIdentity(readTerminalConfig()) !== rendererIdentity || context.isCurrent?.() === false) throw registrationChanged();
  cachedConfig = null;
  hydrated = true;
  const mobile = ["android", "ios"].includes(terminalRuntimePlatform());
  if (mobile) setManagementDevice(null);
  else applyTenantOverride(null);
  clearDeviceSecret(SEALED_NAME);
  clearDeviceSecret("activation.record.v1");
  window.localStorage.removeItem(CONFIG_KEY);
  window.dispatchEvent(new CustomEvent(EVENT));
}

/* --------------- desktop mirror (survives app updates) ------------------ */

type TerminalBridge = {
  readTerminalConfig: () => Promise<{ ok: boolean; config?: TerminalConfig | null }>;
  writeTerminalConfig: (config: TerminalConfig | null) => Promise<{ ok: boolean; code?: string; error?: string }>;
  restoreTerminalConfig?: (config: TerminalConfig) => Promise<{ ok: boolean; config?: TerminalConfig | null; code?: string; error?: string }>;
  clearTerminalConfig?: (expected: {
    tokenId?: string; projectUrl?: string; reason: "revoked" | "missing" | "unpair"; verificationProjectUrl?: string;
  }) => Promise<{ ok: boolean; code?: string; error?: string }>;
};

const desktopBridge = (): TerminalBridge | null => {
  if (typeof window === "undefined") return null;
  const api = (window as unknown as { pos?: Partial<TerminalBridge> }).pos;
  return api && typeof api.writeTerminalConfig === "function" ? (api as TerminalBridge) : null;
};

/**
 * Repair the Electron main-process activation mirror after the signed-in POS
 * administrator has been adopted. Boot hydration happens before that adoption
 * and its protected `terminal:write` can therefore be refused legitimately.
 * Database and sync actions call this again inside their authorised click so a
 * terminal that is already activated never needs a second activation code.
 */
export async function mirrorTerminalConfigToDesktop(): Promise<void> {
  if (!desktopBridge()) return;
  const config = readTerminalConfig() ?? (await hydrateTerminalConfig());
  if (!config?.tokenId) {
    throw new Error("The POS activation could not be read on this device. Sign out and reopen the POS before retrying.");
  }
  await persistDesktopTerminalConfig(config);
}

async function persistDesktopTerminalConfig(config: TerminalConfig, restoring = false): Promise<TerminalConfig> {
  const bridge = desktopBridge();
  if (!bridge) throw new ActivationError("Windows secure storage is unavailable. Reopen Retail and retry.");
  const proof = config.deviceBindingProof || await deviceProofHash();
  if (restoring && !bridge.restoreTerminalConfig) {
    throw new ActivationError("This Windows app cannot restore the retained registration. Update the beta app and retry; the saved registration has not been removed.", true);
  }
  const savedConfig = { ...config, deviceBindingProof: proof };
  let result: { ok: boolean; code?: string; error?: string } | undefined;
  try { result = await (restoring ? bridge.restoreTerminalConfig!(savedConfig) : bridge.writeTerminalConfig(savedConfig)); }
  catch {
    throw new ActivationError("Could not reach Windows secure storage. Retry on this device with the same activation.", true, restoring ? "EACTIVATION_STORE" : undefined);
  }
  if (!result?.ok) {
    throw new ActivationError(
      result?.error ??
        "Windows secure storage could not save the existing terminal activation.",
      false,
      restoring ? terminalRecoveryCode(result?.code) ?? "EACTIVATION_STORE" : undefined,
    );
  }
  const verified = await bridge.readTerminalConfig().catch(() => null);
  if (!verified?.ok || verified.config?.tokenId !== config.tokenId || verified.config?.deviceBindingProof !== proof) {
    throw new ActivationError("Windows could not confirm the saved registration. Retry on this device with the same activation.", true, restoring ? "EACTIVATION_STORE" : undefined);
  }
  return verified.config;
}

async function desktopActivationConnection(projectUrl: string) {
  if (!desktopBridge()) return null;
  const read = window.pos?.bootstrapCloudCredentials;
  const saved = await read?.().catch(() => {
    throw new ActivationError("Could not read the saved database connection. Reopen Retail and retry.", true);
  });
  if (saved && !saved.ok && "error" in saved)
    throw new ActivationError("Could not read the saved database connection. Open Database & Cloud Connection and retry.");
  if (!saved?.ok || !saved.url || !saved.key)
    throw new ActivationError("Save the database URL and publishable key in Database & Cloud Connection before activating this Windows terminal.");
  if (saved.url.trim().replace(/\/+$/, "") !== projectUrl.trim().replace(/\/+$/, ""))
    throw new ActivationError("This activation belongs to a different database. Use a code from the POS website for the database saved on this device.");
  const backend = await backendUrl().catch(() => {
    throw new ActivationError("Could not read the saved POS website address. Open Database & Cloud Connection and retry.", true);
  });
  if (!backend)
    throw new ActivationError("Save the POS website address in Database & Cloud Connection before activating this Windows terminal.");
  return { backend, cloud: { url: saved.url, key: saved.key } };
}

async function completeDesktopActivation(
  config: TerminalConfig,
  connection: NonNullable<Awaited<ReturnType<typeof desktopActivationConnection>>>,
): Promise<TerminalConfig> {
  const verified = await persistDesktopTerminalConfig({
    ...config,
    backendUrl: connection.backend,
    supabaseUrl: connection.cloud.url,
    supabaseKey: connection.cloud.key,
  });
  publishTerminalConfig(verified);
  return verified;
}

/**
 * An installer refresh can wipe the renderer's storage. The desktop shell keeps
 * a copy of the activation in its user-data folder, so the till comes back
 * already registered instead of asking for a new code.
 */
export async function restoreTerminalConfigFromDisk(): Promise<TerminalConfig | null> {
  const bridge = desktopBridge();
  if (!bridge || readTerminalConfig()) return readTerminalConfig();
  try {
    return await hydrateTerminalConfig();
  } catch {
    return null;
  }
}

export function subscribeTerminalConfig(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

export const TERMINAL_CONFIG_EVENT = EVENT;

/**
 * Forget this machine entirely: the sealed activation, the desktop mirror, the
 * tenant connection details and the machine account session all go, so the app
 * comes back on the activation screen.
 */
export async function unpairTerminal(expected?: TerminalClearContext): Promise<void> {
  // Capture before sign-out and connection cleanup can await another session.
  if (hydration) await hydration;
  const context = expected ?? { config: readTerminalConfig() ?? await hydrateTerminalConfig(), reason: "unpair" as const };
  if (registrationIdentity(context.config) !== registrationIdentity(readTerminalConfig())) throw registrationChanged();
  // End Auth while its client still has the configured URL. Clearing first
  // used to throw during sign-out and strand the root in connection recovery.
  try { await supabaseExternal.auth.signOut({ scope: "local" }); } catch { /* revoke already confirmed */ }
  await clearTerminalConfig(context);
  const ensureUnpaired = () => { if (readTerminalConfig()) throw registrationChanged(); };
  ensureUnpaired();
  const { clearApprovalToken } = await import("@/platform-config/approval-token-client");
  ensureUnpaired();
  await clearApprovalToken(true);
  ensureUnpaired();
  const mobile = ["android", "ios"].includes(terminalRuntimePlatform());
  if (mobile) {
    const { resetMobileRegistrationIdentity } = await import("./mobile-registration-identity");
    ensureUnpaired();
    await resetMobileRegistrationIdentity(false);
  } else {
    const { removeCloudCredentials } = await import("@/lib/secure-cloud-config");
    ensureUnpaired();
    const removed = await removeCloudCredentials();
    if (!removed.ok) throw new Error(removed.error || "Could not clear the saved connection.");
    ensureUnpaired();
    const backend = await saveBackendUrl("");
    if (!backend.ok) throw new Error(backend.error || "Could not clear the backend address.");
  }
  ensureUnpaired();
  clearPairingRequest();
  clearDeviceSecret("terminal-account");
  resetHealthCache();
  const { flushConnectionProfile } = await import("@/lib/connection-profile");
  await flushConnectionProfile();
}

/** Look the token up by id. `null` means the network answered "no such token". */
export async function fetchTokenStatus(
  tokenId: string,
  client?: unknown,
): Promise<{
  status: TokenStatus;
  locationName: string;
  locationId: string;
  isClaimed: boolean;
  expiresAt: string | null;
} | null> {
  const args = { p_token_id: tokenId };
  const { data, error } = await (client ? rpcOn(client, "terminal_token_status", args) : rpc("terminal_token_status", args));
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    status: asStatus(row.status),
    locationName: row.location_name ?? "",
    locationId: row.location_id ?? "",
    isClaimed: row.is_claimed === true || asStatus(row.status) === "used",
    expiresAt: row.expires_at ?? null,
  };
}

export async function stampHeartbeat(
  tokenId: string,
  opts: { version?: string; synced?: boolean } = {},
  client?: unknown,
): Promise<void> {
  // Current heartbeat functions accept UUIDs. Old desktop profiles can carry
  // an opaque pre-v1 token; sending it to PostgREST produces a noisy 400 on
  // every revocation interval without updating anything.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tokenId)) return;
  // Named arguments keep installed databases compatible while the current
  // routine also verifies the durable proof before changing telemetry.
  const proofHash = await deviceProofHash();
  if (!proofHash) return;
  const args = {
    p_token_id: tokenId,
    p_activate: false,
    p_version: opts.version || APP_VERSION,
    p_synced: opts.synced === true,
    p_proof_hash: proofHash,
  };
  const { error } = await (client ? rpcOn(client, "terminal_token_heartbeat", args) : rpc("terminal_token_heartbeat", args));
  if (error) throw error;
}

export type TerminalRecoveryCode = "EBADARG" | "EACTIVATION_RECOVERY_BINDING" | "EACTIVATION_RECOVERY_PROJECT" |
  "EACTIVATION_RECOVERY_PROOF" | "EACTIVATION_RECOVERY_VERIFY" | "EACTIVATION_CONTEXT_CHANGED" |
  "EACTIVATION_STORE" | "EPRIVILEGE" | "EAPP_CLOSING" | "ERECOVERY_METADATA_BUSY";

const RESTORE_CANDIDATE_FAILURES = {
  EBADARG: 0,
  EACTIVATION_RECOVERY_BINDING: 1,
  EACTIVATION_RECOVERY_PROJECT: 2,
  EACTIVATION_RECOVERY_PROOF: 2,
  EACTIVATION_RECOVERY_VERIFY: 3,
} as const;
const RESTORE_FAILURE_CODES = new Set<string>([...Object.keys(RESTORE_CANDIDATE_FAILURES),
  "EACTIVATION_CONTEXT_CHANGED", "EACTIVATION_STORE", "EPRIVILEGE", "EAPP_CLOSING", "ERECOVERY_METADATA_BUSY"]);
const terminalRecoveryCode = (value: unknown): TerminalRecoveryCode | undefined =>
  typeof value === "string" && RESTORE_FAILURE_CODES.has(value) ? value as TerminalRecoveryCode : undefined;

export class ActivationError extends Error {
  constructor(message: string, readonly retryable = false, readonly code?: TerminalRecoveryCode) { super(message); }
}

const retryDelay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Only transport/service failures are safe to retry; a database verdict is final. */
export function isRetryableActivationError(error: unknown): boolean {
  const value = error as { code?: string; message?: string; status?: number } | null;
  const message = value?.message ?? "";
  if (/TERMINAL_|already.*(used|claimed)|expired|revoked/i.test(message)) return false;
  if (value?.status === 429 || (value?.status != null && value.status >= 500)) return true;
  return (
    error instanceof TypeError ||
    /failed to fetch|network|load failed|timeout|temporarily unavailable|connection reset/i.test(message)
  );
}

/** Bounded retry used by claim/status calls. A lost claim response is safe because claims are idempotent per device. */
export async function withActivationRetry<T>(
  work: () => Promise<T>,
  delays: readonly number[] = [200, 600],
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      last = error;
      if (!isRetryableActivationError(error) || attempt === delays.length) throw error;
      await retryDelay(delays[attempt]);
    }
  }
  throw last;
}

/**
 * Turn a failed status lookup into a message an operator can act on. The old
 * blanket "cannot reach the server" hid the common case: the database is
 * missing the activation helpers (PGRST202).
 */
function activationFailureMessage(e: unknown): string {
  const err = e as { code?: string; message?: string } | null;
  const code = err?.code ?? "";
  const message = err?.message ?? "";
  // Verdicts the database itself reached, so a till that skipped the client
  // pre-checks still gets refused — and still reads a plain reason.
  if (/TERMINAL_TOKEN_REVOKED/.test(message)) {
    return "This activation code has been revoked by management.";
  }
  if (/TERMINAL_PLATFORM_MISMATCH/.test(message)) {
    return "This code is for a different device type. Ask a supervisor for the correct PC or mobile activation code.";
  }
  if (/TERMINAL_TOKEN_EXPIRED/.test(message)) {
    return "This activation code has expired. Ask an administrator to generate a new one.";
  }
  if (/TERMINAL_BRANCH_INACTIVE/.test(message)) {
    return "The branch this code belongs to is no longer active. Ask an administrator for a code on a live branch.";
  }
  if (/TERMINAL_BRANCH_REQUIRED/.test(message)) {
    return "This activation code is not linked to a branch. Ask an administrator to reissue it.";
  }
  if (/TERMINAL_DEVICE_PROOF_REQUIRED/.test(message)) {
    return "Secure device storage is unavailable. Enable local storage for this app, then try again.";
  }
  if (/TERMINAL_DEVICE_PROOF_MISMATCH/.test(message)) {
    return "This approval belongs to a different device. Scan the pairing QR currently shown on this terminal.";
  }
  if (code === "PGRST203" || /could not choose the best candidate/i.test(message)) {
    return "This POS database has two versions of the terminal activation routine. Run supabase/schema33.sql on the POS database, then try again.";
  }

  if (code === "PGRST202" && /terminal_token_claim/.test(message)) {
    return "This POS database is missing the one-time terminal claim helper. Apply the pending POS migrations following docs/database-upgrade.md, then try again.";
  }
  if (code === "PGRST202" && /terminal_token_status/.test(message)) {
    return "This POS database is missing the terminal status helper. Apply the pending POS migrations following docs/database-upgrade.md, then try again.";
  }
  if (code === "PGRST202" && /terminal_token_heartbeat/.test(message)) {
    return "This POS database is missing the terminal heartbeat helper. Apply the pending POS migrations following docs/database-upgrade.md, then try again.";
  }
  if (code === "PGRST202") {
    return "This POS database has an incomplete terminal activation setup. Apply the pending POS migrations following docs/database-upgrade.md, then try again.";
  }
  if (
    e instanceof TypeError ||
    /failed to fetch|network|load failed/i.test(message)
  ) {
    return "Cannot reach the server to verify this code. Check the connection.";
  }
  return message
    ? `Could not verify this activation code: ${message}`
    : "Could not verify this activation code. Try again in a moment.";
}

/** Decrypt, verify against the server and register this machine. */
export async function activateTerminal(code: string): Promise<TerminalConfig> {
  // Two shapes travel in the wild: the current `ENC_V1:` one-time token and
  // the older self-contained payload still held by tills not yet re-issued.
  let payload: {
    token_id: string;
    location_id: string;
    location_name: string;
    supabase_url: string;
    supabase_key: string;
    membership_supabase_url?: string;
    membership_supabase_key?: string;
    backend_url?: string;
    device_name?: string;
    platform?: TerminalPlatform;
    management_sync_secret?: string;
  };
  try {
    if (isEncryptedV1(code)) {
      const v1 = await decryptActivationV1(code);
      payload = {
        token_id: v1.pairToken,
        location_id: "",
        location_name: "",
        supabase_url: v1.supabaseUrl,
        supabase_key: v1.supabaseAnonKey,
        membership_supabase_url: v1.membershipSupabaseUrl,
        membership_supabase_key: v1.membershipSupabaseKey,
        backend_url: v1.backendUrl,
        device_name: v1.deviceName,
        platform: v1.platform,
        management_sync_secret: v1.managementSyncSecret,
      };
    } else {
      payload = await decryptActivation(code);
    }
  } catch (e) {
    if (e instanceof ActivationError) throw e;
    void recordActivationAttempt(null, {
      outcome: "invalid_code",
      terminalId: null,
      reason: "The activation code could not be read.",
    });
    throw new ActivationError("This activation code is not valid.");
  }

  const shell = terminalRuntimePlatform();
  if (payload.platform && !canRuntimeClaimToken(payload.platform, shell)) {
    throw new ActivationError(
      "This code is for a different device type. Ask a supervisor for the correct PC or mobile activation code.",
    );
  }
  // Every successful claim and all later credential recovery are bound to the
  // same sealed per-device key. Refuse an unbound registration instead of
  // creating a token that can never be authenticated securely.
  const proofHash = await deviceProofHash();
  if (!proofHash) {
    throw new ActivationError(
      "Secure device storage is unavailable. Enable local storage for this app, then try again.",
    );
  }

  // The claim runs against the tenant named inside the token, not against
  // whatever this machine happens to be pointed at — an unprovisioned till has
  // no connection details at all until this succeeds.
  const desktop = await desktopActivationConnection(payload.supabase_url);
  const tenant = createTenantClient(desktop?.cloud.url ?? payload.supabase_url, desktop?.cloud.key ?? payload.supabase_key);
  const note = (
    outcome: Parameters<typeof recordActivationAttempt>[1]["outcome"],
    reason: string,
    branch?: { id?: string | null; name?: string | null },
  ) =>
    void recordActivationAttempt(tenant, {
      outcome,
      terminalId: payload.token_id,
      branchId: branch?.id ?? payload.location_id ?? null,
      branchName: branch?.name ?? payload.location_name ?? null,
      reason,
    });
  const statusOf = async () => {
    const { data, error } = await rpcOn(tenant, "terminal_token_status", {
      p_token_id: payload.token_id,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return {
      status: asStatus(row.status),
      locationName: row.location_name ?? "",
      locationId: row.location_id ?? "",
      isClaimed: row.is_claimed === true || asStatus(row.status) === "used",
      expiresAt: (row.expires_at ?? null) as string | null,
    };
  };
  const remote = await withActivationRetry(statusOf).catch((e: unknown) => {
    const message = activationFailureMessage(e);
    note("unreachable", message);
    throw new ActivationError(message);
  });
  if (!remote) {
    note("invalid_code", "This activation code is not recognised.");
    throw new ActivationError("This activation code is not recognised.");
  }
  const branch = { id: remote.locationId, name: remote.locationName };
  if (remote.status === "revoked") {
    note("revoked", "This activation code has been revoked by management.", branch);
    throw new ActivationError("This activation code has been revoked by management.");
  }
  // A used token is still submitted to the atomic claim helper. It succeeds
  // only for the original device proof, which repairs the interrupted window
  // between the database claim and local secure persistence.
  if (!remote.isClaimed && remote.expiresAt && new Date(remote.expiresAt).getTime() < Date.now()) {
    note("expired", "This activation code passed its redemption deadline.", branch);
    throw new ActivationError(
      "This activation code has expired. Ask an administrator to generate a new one.",
    );
  }

  // One-time use: only the till that wins this atomic claim may register.
  const deviceName =
    typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 120) : null;
  let claimResult: { data: unknown; error: unknown };
  try {
    claimResult = await withActivationRetry(async () => {
      const result = await rpcOn(tenant, "terminal_token_claim", {
        p_token_id: payload.token_id,
        p_device: deviceName,
        p_proof_hash: proofHash,
        p_platform: shell,
        p_os: claimOs(),
      });
      if (result.error) throw result.error;
      return result;
    });
  } catch (claimError) {
    const message = activationFailureMessage(claimError);
    note("unreachable", message, branch);
    throw new ActivationError(message);
  }
  const claimed = claimResult.data;
  if (claimed !== true) {
    note("already_claimed", "Another device won the one-time claim.", branch);
    throw new ActivationError("This activation token has already been used or expired.");
  }

  let config: TerminalConfig = {
    tokenId: payload.token_id,
    deviceClaimProof: payload.management_sync_secret,
    deviceBindingProof: proofHash,
    deviceName: payload.device_name?.trim() || remote.locationName || "",
    deviceType: tokenPlatformForRuntime(shell) ?? "pc",
    deviceUse: remote.locationId ? "operations" : "management",
    locationId: remote.locationId,
    locationName: remote.locationName || payload.location_name,
    supabaseUrl: payload.supabase_url,
    supabaseKey: payload.supabase_key,
    membershipSupabaseUrl: payload.membership_supabase_url,
    membershipSupabaseKey: payload.membership_supabase_key,
    backendUrl: payload.backend_url,
    activatedAt: new Date().toISOString(),
  };
  const mobile = shell === "android" || shell === "ios";
  if (mobile) {
    // The server claim has succeeded. Persist before dropping the old session;
    // failed validation/claims above never disturb the existing registration.
    const previous = readTerminalConfig();
    const previousBackend = await backendUrl();
    try {
      await setDeviceSecret(SEALED_NAME, config);
      if (config.backendUrl) {
        const saved = await saveBackendUrl(config.backendUrl);
        if (!saved.ok) throw new ActivationError(saved.error || "Could not save the backend address.");
      }
      const { resetMobileRegistrationIdentity } = await import("./mobile-registration-identity");
      await resetMobileRegistrationIdentity(Boolean(previous?.supabaseUrl && previous.supabaseKey));
      cachedConfig = config;
      hydrated = true;
      window.localStorage.removeItem(CONFIG_KEY);
      applyTenantOverride(config);
      const { flushConnectionProfile } = await import("@/lib/connection-profile");
      await flushConnectionProfile();
      window.dispatchEvent(new CustomEvent(EVENT));
    } catch (error) {
      cachedConfig = previous;
      applyTenantOverride(previous);
      if (previous) await setDeviceSecret(SEALED_NAME, previous);
      else clearDeviceSecret(SEALED_NAME);
      const restored = await saveBackendUrl(previousBackend);
      if (!restored.ok) throw new ActivationError("Could not restore the saved backend address. Open connection settings before retrying.");
      const { flushConnectionProfile } = await import("@/lib/connection-profile");
      await flushConnectionProfile();
      throw error;
    }
  } else if (desktop) {
    config = await completeDesktopActivation(config, desktop);
  } else {
    if (config.backendUrl) {
      const saved = await saveBackendUrl(config.backendUrl);
      if (!saved.ok) throw new ActivationError(saved.error || "Could not save the backend address.");
    }
    writeTerminalConfig(config);
  }
  note("succeeded", "This till claimed the code and registered.", {
    id: config.locationId,
    name: config.locationName,
  });
  void Promise.resolve().then(() => rpcOn(tenant, "terminal_token_heartbeat", {
    p_token_id: config.tokenId,
    p_activate: true,
    p_proof_hash: proofHash,
  })).then(({ error }) => {
    if (error) note("unreachable", activationFailureMessage(error), branch);
  }).catch(error => note("unreachable", activationFailureMessage(error), branch));
  // Give this till its own machine account so its writes are accepted by the
  // central database even when a cashier signs in with a PIN.
  if (config.locationId) void import("@/lib/terminal-session").then((m) => m.provisionTerminalAccount(config.tokenId)).catch(() => null);
  return config;
}


/* ------------------------- phone-assisted pairing ------------------------ */

export type PairingRequest = {
  replicaProofHash?: string;
  /** the token id the terminal reserved for itself */
  tokenId: string;
  deviceName: string;
  /** SHA-256 proof derived from this device's sealed key. */
  proofHash: string;
};

const PAIR_KEY = "pos.terminal.pairing";
const PAIR_PREFIX = "POSPAIR1:";
const COMPACT_PAIR_PREFIX = "POSPAIR2:";
const TERMINAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const validProofHash = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);

/** Stable pairing request for this machine — reused across reloads. */
export async function getPairingRequest(): Promise<PairingRequest> {
  const suggested =
    typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent)
      ? "Windows till"
      : "POS terminal";
  const proofHash = await deviceProofHash();
  const replicaProofHash = await replicaSecretHash(await pairingReplicaSecret());
  if (!proofHash) {
    throw new ActivationError(
      "Secure device storage is unavailable. Enable local storage for this app, then try again.",
    );
  }
  if (typeof window === "undefined") {
    return { tokenId: crypto.randomUUID(), deviceName: suggested, proofHash, replicaProofHash };
  }
  try {
    const raw = window.localStorage.getItem(PAIR_KEY);
    const parsed = raw ? (JSON.parse(raw) as PairingRequest) : null;
    // Old builds could persist an opaque id which the UUID-only hosted
    // verifier must reject. Replace it with a fresh proof-bound request.
    if (parsed?.tokenId && TERMINAL_UUID.test(parsed.tokenId) && parsed.proofHash === proofHash && parsed.replicaProofHash === replicaProofHash)
      return parsed;
  } catch {
    /* fall through and mint a new request */
  }
  const request: PairingRequest = { tokenId: crypto.randomUUID(), deviceName: suggested, proofHash, replicaProofHash };
  try {
    window.localStorage.setItem(PAIR_KEY, JSON.stringify(request));
  } catch {
    /* non-fatal: the request simply changes on the next reload */
  }
  return request;
}

export function clearPairingRequest() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PAIR_KEY);
}

/** Text placed in the QR shown on the terminal for the phone to scan. */
export function encodePairingRequest(request: PairingRequest): string {
  // Keep the proof, but omit JSON property names and base64 expansion so the
  // on-screen QR has fewer modules and remains scannable by phone cameras.
  return `${COMPACT_PAIR_PREFIX}${JSON.stringify([
    request.tokenId,
    request.proofHash,
    request.replicaProofHash ?? "",
    request.deviceName,
  ])}`;
}

export function decodePairingRequest(value: string): PairingRequest | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const fromJson = (raw: string): PairingRequest | null => {
    try {
      const parsed = JSON.parse(raw) as PairingRequest;
      return TERMINAL_UUID.test(parsed?.tokenId ?? "") && validProofHash(parsed.proofHash)
        ? {
            tokenId: parsed.tokenId,
            deviceName: parsed.deviceName ?? "",
            proofHash: parsed.proofHash.toLowerCase(),
            ...(validProofHash(parsed.replicaProofHash) ? { replicaProofHash: parsed.replicaProofHash.toLowerCase() } : {}),
          }
        : null;
    } catch {
      return null;
    }
  };

  if (trimmed.startsWith(COMPACT_PAIR_PREFIX)) {
    try {
      const parts = JSON.parse(trimmed.slice(COMPACT_PAIR_PREFIX.length));
      if (!Array.isArray(parts) || parts.length !== 4) return null;
      const [tokenId, proofHash, replicaProofHash, deviceName] = parts;
      if (!TERMINAL_UUID.test(tokenId) || !validProofHash(proofHash) ||
          (replicaProofHash && !validProofHash(replicaProofHash)) ||
          typeof deviceName !== "string") return null;
      return { tokenId, proofHash: proofHash.toLowerCase(), deviceName,
        ...(replicaProofHash ? { replicaProofHash: replicaProofHash.toLowerCase() } : {}) };
    } catch { return null; }
  }

  // Preferred form: the prefixed base64 payload the till renders.
  if (trimmed.startsWith(PAIR_PREFIX)) {
    const body = trimmed.slice(PAIR_PREFIX.length);
    try {
      const decoded = fromJson(atob(body));
      if (decoded) return decoded;
    } catch {
      /* fall through to the tolerant paths below */
    }
    return null;
  }

  // A phone camera sometimes hands back the raw JSON, a bare token id, or a
  // link that carries the token. Accept all of them rather than failing.
  const asJson = fromJson(trimmed);
  if (asJson) return asJson;
  // Bare UUIDs and arbitrary URLs are deliberately rejected: they do not bind
  // approval to the device that displayed the QR.
  return null;
}

/**
 * Register this machine against a token id an administrator approved from the
 * phone. Same claim-once rules as pasting a code by hand.
 */
type PairingApproval = {
  approved: boolean;
  terminal?: { id: string };
  managementDevice?: boolean;
  status?: TokenStatus;
  locationId?: string;
  locationName?: string;
  deviceName?: string;
  expiresAt?: string | null;
  supabaseUrl?: string;
  supabaseKey?: string;
  membershipSupabaseUrl?: string;
  membershipSupabaseKey?: string;
  backendUrl?: string;
};

async function fetchPairingApproval(request: PairingRequest): Promise<PairingApproval> {
  if (serverUnreachableOnDevice())
    throw new ActivationError("Save the POS website address in Database & Cloud Connection before pairing.");
  const response = await posFetch("/api/public/terminal-pairing", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tokenId: request.tokenId, proofHash: request.proofHash }),
  });
  const body = (await response.json().catch(() => null)) as (PairingApproval & { error?: string }) | null;
  if (!response.ok) throw Object.assign(new Error(body?.error || `Pairing check failed (${response.status})`), { status: response.status });
  if (typeof body?.approved !== "boolean")
    throw new ActivationError("The saved website did not return a POS pairing response. Check the POS website address in Database & Cloud Connection.");
  return body;
}

export async function activateWithTokenId(request: PairingRequest, onApproved?: () => void): Promise<TerminalConfig | null> {
  const shell = terminalRuntimePlatform();
  const approval = await withActivationRetry(() => fetchPairingApproval(request)).catch((e: unknown) => {
    if (e instanceof ActivationError) throw e;
    throw new ActivationError(activationFailureMessage(e), isRetryableActivationError(e));
  });
  if (!approval.approved) return null;
  if (approval.status === "revoked") {
    throw new ActivationError(
      "This terminal has been revoked by management.",
    );
  }
  if ((!approval.locationId && !approval.managementDevice) || !approval.supabaseUrl || !approval.supabaseKey) {
    throw new ActivationError(
      "The POS server returned an incomplete pairing approval. Ask an administrator to check the hosted database settings.",
    );
  }
  // Once claimed, the server will accept a retry only with the original
  // device proof. The deadline applies to first redemption.
  const alreadyClaimed = approval.status === "used" || approval.terminal?.id === request.tokenId;
  if (!alreadyClaimed && approval.expiresAt && new Date(approval.expiresAt).getTime() < Date.now()) {
    throw new ActivationError("This pairing request has expired. Ask an administrator to approve it again.");
  }
  const desktop = await desktopActivationConnection(approval.supabaseUrl);
  onApproved?.();
  const tenant = createTenantClient(desktop?.cloud.url ?? approval.supabaseUrl, desktop?.cloud.key ?? approval.supabaseKey);
  const deviceName = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 120) : null;
  let claimed: unknown;
  try {
    const result = await withActivationRetry(async () => {
      const response = await rpcOn(tenant, "terminal_token_claim", {
        p_token_id: request.tokenId,
        p_device: deviceName,
        p_proof_hash: request.proofHash,
        p_platform: shell,
        p_os: claimOs(),
      });
      if (response.error) throw response.error;
      return response;
    });
    claimed = result.data;
  } catch (error) {
    throw new ActivationError(activationFailureMessage(error), isRetryableActivationError(error));
  }
  if (claimed !== true) {
    throw new ActivationError("This pairing request was already used on another terminal.");
  }
  let config: TerminalConfig = {
    tokenId: request.tokenId,
    deviceClaimProof: approval.managementDevice ? await pairingReplicaSecret() : undefined,
    deviceBindingProof: request.proofHash,
    deviceName: approval.deviceName || request.deviceName,
    deviceType: tokenPlatformForRuntime(shell) ?? "pc",
    deviceUse: approval.managementDevice ? "management" : "operations",
    locationId: approval.locationId || "",
    locationName: approval.locationName || "",
    supabaseUrl: approval.supabaseUrl,
    supabaseKey: approval.supabaseKey,
    membershipSupabaseUrl: approval.membershipSupabaseUrl,
    membershipSupabaseKey: approval.membershipSupabaseKey,
    backendUrl: approval.backendUrl,
    activatedAt: new Date().toISOString(),
  };
  if (desktop) {
    config = await completeDesktopActivation(config, desktop);
  } else {
    if (config.backendUrl) {
      const saved = await saveBackendUrl(config.backendUrl);
      if (!saved.ok) throw new ActivationError(saved.error || "Could not securely save the POS website address.");
    }
    writeTerminalConfig(config);
  }
  try { clearPairingRequest(); } catch { /* Windows already confirmed the registration. */ }
  void Promise.resolve().then(() => rpcOn(tenant, "terminal_token_heartbeat", {
    p_token_id: request.tokenId,
    p_activate: true,
    p_proof_hash: request.proofHash,
  })).catch(() => undefined);
  if (config.locationId) void import("@/lib/terminal-session")
    .then((m) => m.provisionTerminalAccount(request.tokenId))
    .catch(() => null);
  return config;
}
