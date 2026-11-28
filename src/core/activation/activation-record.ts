/**
 * Minimal, tamper-evident record of "this terminal is registered".
 *
 * It exists so the app can answer "is this till registered?" without a
 * network call, and without confusing a dead connection for a bad activation
 * code. Nothing else is cached here: no API keys, no user rows, no tables.
 *
 * The record is sealed in the per-device secure store (AES-GCM under the
 * device key, mirrored by the platform vault) and carries an HMAC over its
 * fields, so hand-editing local storage invalidates it rather than granting
 * access.
 */
import { clearDeviceSecret, deviceHmac, getDeviceSecret, setDeviceSecret } from "@/lib/device-secrets";
import { readTerminalConfig } from "@/core/activation/terminal-tokens";
import { terminalRuntimePlatform } from "@/core/activation/terminal-platform";

const RECORD = "activation.record.v1";
export type ActivationRecord = {
  /** the existing terminal token id — the device identity */
  tokenId: string;
  activated: boolean;
  /** ISO timestamp of the last successful cloud verification */
  verifiedAt: string;
  /** server-issued verification token/stamp, when the RPC returns one */
  stamp: string | null;
  mac: string;
};

export type RegistrationState = "registered" | "not-registered";

const body = (r: Omit<ActivationRecord, "mac">) =>
  JSON.stringify([r.tokenId, r.activated, r.verifiedAt, r.stamp ?? ""]);

/** Write (or refresh) the record after a successful verification. */
export async function writeActivationRecord(input: {
  tokenId: string;
  stamp?: string | null;
  verifiedAt?: Date;
  /** Do not publish a response from a retired registration or connection. */
  isCurrent?: () => boolean;
}): Promise<ActivationRecord> {
  const at = input.verifiedAt ?? new Date();
  const fields: Omit<ActivationRecord, "mac"> = {
    tokenId: input.tokenId,
    activated: true,
    verifiedAt: at.toISOString(),
    stamp: input.stamp ?? null,
  };
  const record: ActivationRecord = { ...fields, mac: await deviceHmac(body(fields)) };
  if (input.isCurrent && !input.isCurrent()) throw new Error("The terminal registration changed before verification was saved.");
  await setDeviceSecret(RECORD, record);
  return record;
}

/** Read the record back, or null when absent, unreadable or tampered with. */
export async function readActivationRecord(): Promise<ActivationRecord | null> {
  const raw = await getDeviceSecret<ActivationRecord & { graceUntil?: string }>(RECORD);
  if (!raw || typeof raw.tokenId !== "string" || typeof raw.mac !== "string") return null;
  const { mac } = raw;
  const fields = {
    tokenId: raw.tokenId,
    activated: raw.activated,
    verifiedAt: raw.verifiedAt,
    stamp: raw.stamp ?? null,
  };
  const expected = await deviceHmac(body(fields));
  if (mac === expected) return { ...fields, mac };
  // One-time compatibility read for records sealed before expiry-based offline
  // access was removed. The date is authenticated but is no longer enforced.
  if (raw.graceUntil) {
    const legacy = JSON.stringify([
      raw.tokenId,
      raw.activated,
      raw.verifiedAt,
      raw.graceUntil,
      raw.stamp ?? "",
    ]);
    if (mac === (await deviceHmac(legacy))) {
      const migrated = { ...fields, mac: await deviceHmac(body(fields)) };
      await setDeviceSecret(RECORD, migrated);
      return migrated;
    }
  }
  return null;
}

export function clearActivationRecord(): void {
  clearDeviceSecret(RECORD);
}

/**
 * Local-only registration verdict. Never touches the network.
 *
 * A device activated before this record existed still has its sealed terminal
 * config; that counts as registered and the record is written on the next
 * successful heartbeat.
 */
export async function isRegistered(): Promise<RegistrationState> {
  // A legacy renderer receipt alone cannot establish a Windows registration.
  if (terminalRuntimePlatform() === "electron") return readTerminalConfig() ? "registered" : "not-registered";
  const record = await readActivationRecord();
  if (record?.activated) return "registered";
  return readTerminalConfig() ? "registered" : "not-registered";
}
