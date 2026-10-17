/** RFC 6238, SHA-1, 30-second steps and eight digits. Secrets never reach browser storage. */
export async function approvalTotp(secret: string, at = Date.now()): Promise<string> {
  const bytes = Uint8Array.from(atob(secret), (character) => character.charCodeAt(0));
  if (bytes.length < 20 || !Number.isFinite(at) || at < 0)
    throw new Error("Invalid approval token");
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(Math.floor(at / 30_000)));
  const key = await crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-1" }, false, [
    "sign",
  ]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const offset = mac[mac.length - 1] & 15;
  const value =
    ((mac[offset] & 127) * 16777216 +
      mac[offset + 1] * 65536 +
      mac[offset + 2] * 256 +
      mac[offset + 3]) %
    100_000_000;
  return String(value).padStart(8, "0");
}
export async function matchingTotpStep(
  secret: string,
  code: string,
  at = Date.now(),
): Promise<number | null> {
  if (!/^\d{8}$/.test(code)) return null;
  const step = Math.floor(at / 30_000);
  for (const candidate of [step, step - 1, step + 1]) {
    if (candidate < 0) continue;
    const expected = await approvalTotp(secret, candidate * 30_000);
    let mismatch = 0;
    for (let i = 0; i < 8; i++) mismatch |= expected.charCodeAt(i) ^ code.charCodeAt(i);
    if (!mismatch) return candidate;
  }
  return null;
}
