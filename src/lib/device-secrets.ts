/**
 * Encrypted store for anything sensitive this device has to keep — terminal
 * account credentials, cached tokens and the like.
 *
 * Values are sealed with AES-256-GCM using a random key generated once per
 * device, so nothing readable is left lying in browser storage. The desktop
 * shell mirrors the same ciphertext, never the plain value.
 */
const KEY_NAME = "pos.device.key";
const PREFIX = "pos.secure.";
const revisions = new Map<string, number>();

const enc = new TextEncoder();
const dec = new TextDecoder();

const subtle = () => {
  const c = globalThis.crypto?.subtle;
  if (!c) throw new Error("Secure storage is unavailable on this device");
  return c;
};

const toB64 = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

const fromB64 = (value: string) => {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
};

function deviceKeyMaterial(): Uint8Array {
  const existing = window.localStorage.getItem(KEY_NAME);
  if (existing) return fromB64(existing);
  const fresh = crypto.getRandomValues(new Uint8Array(32));
  window.localStorage.setItem(KEY_NAME, toB64(fresh));
  return fresh;
}

let keyPromise: Promise<CryptoKey> | null = null;

const deviceKey = () => {
  if (!keyPromise) {
    keyPromise = subtle().importKey("raw", deviceKeyMaterial() as BufferSource, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
  }
  return keyPromise;
};

/** Seal a value under a name. Nothing readable reaches browser storage. */
export async function setDeviceSecret(name: string, value: unknown): Promise<void> {
  if (typeof window === "undefined") return;
  const revision = (revisions.get(name) ?? 0) + 1;
  revisions.set(name,revision);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await subtle().encrypt(
      { name: "AES-GCM", iv },
      await deviceKey(),
      enc.encode(JSON.stringify(value)),
    ),
  );
  const packed = new Uint8Array(iv.length + cipher.length);
  packed.set(iv, 0);
  packed.set(cipher, iv.length);
  if (revisions.get(name) === revision) window.localStorage.setItem(PREFIX + name, toB64(packed));
}

/** Read a sealed value back, or null when it is absent or unreadable. */
export async function getDeviceSecret<T>(name: string): Promise<T | null> {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(PREFIX + name);
  if (!raw) return null;
  try {
    const packed = fromB64(raw);
    const plain = await subtle().decrypt(
      { name: "AES-GCM", iv: packed.slice(0, 12) },
      await deviceKey(),
      packed.slice(12),
    );
    return JSON.parse(dec.decode(plain)) as T;
  } catch {
    return null;
  }
}

export function clearDeviceSecret(name: string): void {
  revisions.set(name,(revisions.get(name) ?? 0) + 1);
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(PREFIX + name); } catch { /* storage unavailable */ }
}

let macPromise: Promise<CryptoKey> | null = null;

const macKey = () => {
  if (!macPromise) {
    macPromise = subtle().importKey(
      "raw",
      deviceKeyMaterial() as BufferSource,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
  }
  return macPromise;
};

/**
 * Sign a string with this device's key. Used to make small local records
 * tamper-evident: editing the stored fields by hand invalidates the tag.
 */
export async function deviceHmac(payload: string): Promise<string> {
  const sig = new Uint8Array(await subtle().sign("HMAC", await macKey(), enc.encode(payload)));
  return toB64(sig);
}
