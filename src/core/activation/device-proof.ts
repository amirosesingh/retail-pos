/**
 * A stable, non-reversible fingerprint of this device, used to bind a claimed
 * activation token to the machine that claimed it.
 *
 * It is an HMAC under the per-device key, so it cannot be copied out of one
 * till and replayed from another without also stealing the sealed device key.
 * Nothing identifying travels: the server stores the digest only.
 */
import { deviceHmac } from "@/lib/device-secrets";

const PURPOSE = "terminal-claim-proof.v1";

let cached: string | null = null;

const base64ToHex = (value: string): string => {
  const bytes = atob(value);
  let hex = "";
  for (let index = 0; index < bytes.length; index += 1)
    hex += bytes.charCodeAt(index).toString(16).padStart(2, "0");
  return hex;
};

/** The fingerprint this terminal presents when claiming or re-presenting a token. */
export async function deviceProofHash(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (cached) return cached;
  try {
    // deviceHmac is intentionally base64 for local tamper tags. The pairing
    // API and database contract use a normalized 64-character SHA-256 hex
    // digest, so convert only this externally transmitted proof.
    cached = base64ToHex(await deviceHmac(PURPOSE));
    return cached;
  } catch {
    // No device key available (a browser with storage blocked): the claim
    // still works, it simply carries no binding.
    return null;
  }
}
