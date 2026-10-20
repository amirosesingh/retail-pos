import { deviceHmac } from "@/lib/device-secrets";

const hex = (bytes: Uint8Array) => [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
export const newReplicaSecret = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export async function replicaSecretHash(secret: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret))));
}
/** Only the hash of this secret travels in the public pairing QR. */
export async function pairingReplicaSecret(): Promise<string> {
  return hex(Uint8Array.from(atob(await deviceHmac("management-replica.v1")), char => char.charCodeAt(0)));
}
