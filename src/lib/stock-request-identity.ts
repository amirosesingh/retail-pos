/** A fulfilment header must retain entropy from the complete request UUID.
 * The checkout child-ID formatter intentionally replaces a suffix, so nesting
 * it would make the request and fulfilment line primary keys identical.
 */
export async function stockRequestFulfilmentId(requestId: string): Promise<string> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))
    throw new Error("The stock request identity is invalid.");
  if (!globalThis.crypto?.subtle)
    throw new Error("Safe stock-transfer identity generation is unavailable.");
  const input = new TextEncoder().encode(`retail-pos:stock-request-fulfilment:v1:${requestId.toLowerCase()}`);
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", input)).slice(0, 16);
  // UUIDv8 is the application-defined format; preserve the standard variant.
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
