import { verifyAsync } from "@noble/ed25519";
import { compare, valid } from "semver";
import { releaseRevision } from "@/lib/release-version";
const compareRelease = (a: string, b: string) => compare(a, b) || Math.sign(releaseRevision(a) - releaseRevision(b));
import { z } from "zod";

export const MAX_MANIFEST_BYTES = 32_768;
const manifestSchema = z
  .object({
    schema: z.literal(1),
    version: z
      .string()
      .max(80)
      .refine((v) => Boolean(valid(v))),
    appId: z.string().min(1).max(120),
    platform: z.literal("ios"),
    channel: z.enum(["staging", "production"]),
    url: z.string().max(1024),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.number().int().positive().max(100_000_000),
    notes: z.string().max(8000),
    minBuild: z.number().int().positive(),
    maxBuild: z.number().int().positive(),
    issuedAt: z.number().int().positive(),
    expiresAt: z.number().int().positive(),
    rollout: z
      .object({
        percent: z.number().int().min(0).max(100),
        salt: z.string().min(1).max(80),
        stopped: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type Manifest = z.infer<typeof manifestSchema>;
export type Trust = {
  publicKey: string;
  origin: string;
  endpoint: string;
  channel: "staging" | "production";
  appId: string;
  build: string;
  nativeVersion: string;
};
export function newer(version: string, current: string) {
  return Boolean(valid(version) && valid(current) && compareRelease(version, current) > 0);
}
export function httpsUrl(value: string, origin: string) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.origin !== origin ||
    u.username ||
    u.password ||
    u.hash ||
    u.search
  )
    throw new Error("Update URL is not trusted.");
  return u;
}
const bytes = (value: string) => {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error("Invalid signature encoding.");
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
};
export async function validateManifest(
  raw: string,
  trust: Trust,
  current: string,
  highest: string,
  now = Date.now(),
): Promise<Manifest> {
  if (new TextEncoder().encode(raw).length > MAX_MANIFEST_BYTES)
    throw new Error("Update manifest is too large.");
  const envelope = z
    .object({ payload: z.string().max(24000), signature: z.string().max(100) })
    .strict()
    .parse(JSON.parse(raw));
  const payload = bytes(envelope.payload),
    signature = bytes(envelope.signature),
    key = bytes(trust.publicKey);
  if (key.length !== 32 || signature.length !== 64 || !(await verifyAsync(signature, payload, key)))
    throw new Error("Update signature is invalid.");
  const m = manifestSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload)),
  );
  if (m.appId !== trust.appId || m.channel !== trust.channel)
    throw new Error("Update belongs to another app or channel.");
  const build = Number(trust.build);
  if (
    !Number.isSafeInteger(build) ||
    build < m.minBuild ||
    build > m.maxBuild ||
    m.minBuild > m.maxBuild
  )
    throw new Error("This update needs a different native IPA build.");
  if (m.expiresAt <= now || m.issuedAt > now + 300_000 || m.expiresAt <= m.issuedAt)
    throw new Error("Update metadata has expired or the device clock is incorrect.");
  const url = httpsUrl(m.url, trust.origin);
  if (url.pathname !== `/pos-app/ios-ota/releases/${m.version}/bundle.zip`)
    throw new Error("Update bundle path is not immutable.");
  if (
    !valid(current) ||
    !valid(highest) ||
    compareRelease(m.version, current) < 0 ||
    compareRelease(m.version, highest) < 0
  )
    throw new Error("Downgrade rejected. Use the explicit recovery action instead.");
  return m;
}
export async function inRollout(m: Manifest, device: string) {
  if (m.rollout.stopped) return false;
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${m.rollout.salt}:${device}`)),
  );
  return (hash[0] * 256 + hash[1]) % 10000 < m.rollout.percent * 100;
}
export async function fetchManifest(
  endpoint: string,
  origin: string,
  fetcher: typeof fetch = fetch,
) {
  httpsUrl(endpoint, origin);
  const response = await fetcher(endpoint, {
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Update server returned HTTP ${response.status}.`);
  if (Number(response.headers.get("content-length")) > MAX_MANIFEST_BYTES)
    throw new Error("Update manifest is too large.");
  if (!response.body) throw new Error("Update manifest is empty.");
  const reader = response.body.getReader();
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_MANIFEST_BYTES) throw new Error("Update manifest is too large.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(data);
}
