/**
 * Activation-code cipher.
 *
 * The payload handed to a Windows till is encrypted with AES-256-GCM using the
 * browser's built-in Web Crypto (crypto-js has no GCM mode). The key is derived
 * with PBKDF2 from an application passphrase, so any terminal running this
 * build can open a code an administrator generated.
 *
 * The cipher keeps the payload unreadable to anyone glancing at the QR image —
 * the real enforcement is the server-side token status check plus the
 * revocation heartbeat, never the secrecy of this key.
 */
const PASSPHRASE = "northwind-pos::terminal-activation::v1";
const SALT = "northwind-pos-activation-salt";
const ITERATIONS = 120_000;

export type ActivationPayload = {
  token_id: string;
  location_id: string;
  location_name: string;
  supabase_url: string;
  supabase_key: string;
  membership_supabase_url?: string;
  membership_supabase_key?: string;
};

/**
 * Current format. The code an administrator hands out is a single string
 * `ENC_V1:<iv-base64>:<ciphertext-base64>` wrapping this payload, so a till
 * learns which database to talk to and which one-time claim id to redeem.
 */
export type ActivationPayloadV1 = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Public connection pair for the isolated customer-auth project. */
  membershipSupabaseUrl?: string;
  membershipSupabaseKey?: string;
  /** Hosted POS origin that serves privileged sync and sign-in routes. */
  backendUrl?: string;
  /** one-time claim id (the terminal_tokens row id) */
  pairToken: string;
  /** Display name and intended shell, so activation needs no extra table read. */
  deviceName?: string;
  platform?: "pc" | "mobile";
  /** issue time in ms, used for the 15 minute window */
  ts: number;
};

export const ENC_V1_PREFIX = "ENC_V1:";
export const ACTIVATION_TTL_MS = 15 * 60 * 1000;

export const isEncryptedV1 = (code: string) => code.trim().startsWith(ENC_V1_PREFIX);

const enc = new TextEncoder();
const dec = new TextDecoder();

let keyPromise: Promise<CryptoKey> | null = null;

function subtle(): SubtleCrypto {
  const c = globalThis.crypto?.subtle;
  if (!c) throw new Error("Secure crypto is unavailable in this browser");
  return c;
}

async function getKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    keyPromise = (async () => {
      const base = await subtle().importKey("raw", enc.encode(PASSPHRASE), "PBKDF2", false, [
        "deriveKey",
      ]);
      return subtle().deriveKey(
        { name: "PBKDF2", salt: enc.encode(SALT), iterations: ITERATIONS, hash: "SHA-256" },
        base,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
    })();
  }
  return keyPromise;
}

const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};

const fromBase64 = (value: string) => {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/** Encrypt an activation payload into a single base64 activation code. */
export async function encryptActivation(payload: ActivationPayload): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await subtle().encrypt(
      { name: "AES-GCM", iv },
      await getKey(),
      enc.encode(JSON.stringify(payload)),
    ),
  );
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv, 0);
  out.set(cipher, iv.length);
  return toBase64(out);
}

/** Reverse of {@link encryptActivation}. Throws when the code is not ours. */
export async function decryptActivation(code: string): Promise<ActivationPayload> {
  const raw = fromBase64(code.trim());
  if (raw.length < 29) throw new Error("Activation code is incomplete");
  const plain = await subtle().decrypt(
    { name: "AES-GCM", iv: raw.slice(0, 12) },
    await getKey(),
    raw.slice(12),
  );
  const parsed = JSON.parse(dec.decode(plain)) as ActivationPayload;
  if (!parsed.token_id || !parsed.location_id) throw new Error("Activation code is malformed");
  return parsed;
}

/** Encrypt the current payload into an `ENC_V1:<iv>:<data>` activation token. */
export async function encryptActivationV1(payload: ActivationPayloadV1): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await subtle().encrypt(
      { name: "AES-GCM", iv },
      await getKey(),
      enc.encode(JSON.stringify(payload)),
    ),
  );
  return `${ENC_V1_PREFIX}${toBase64(iv)}:${toBase64(cipher)}`;
}

/** Reverse of {@link encryptActivationV1}. Throws when the code is not ours. */
export async function decryptActivationV1(code: string): Promise<ActivationPayloadV1> {
  const body = code.trim().slice(ENC_V1_PREFIX.length);
  const [ivPart, dataPart] = body.split(":");
  if (!ivPart || !dataPart) throw new Error("Activation code is incomplete");
  const plain = await subtle().decrypt(
    { name: "AES-GCM", iv: fromBase64(ivPart) },
    await getKey(),
    fromBase64(dataPart),
  );
  const parsed = JSON.parse(dec.decode(plain)) as ActivationPayloadV1;
  if (!parsed.pairToken || !parsed.supabaseUrl) throw new Error("Activation code is malformed");
  return parsed;
}
