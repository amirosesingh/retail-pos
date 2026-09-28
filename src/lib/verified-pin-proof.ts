export type GenerateLinkPayload = {
  id?: string;
  hashed_token?: string;
  properties?: { hashed_token?: string };
  user?: { id?: string };
};

/** Accepts both raw GoTrue REST and transformed supabase-js response shapes. */
export function verifiedPinLinkProof(
  body: GenerateLinkPayload,
  expectedAuthUserId: string,
): string {
  const authUserId = body.user?.id ?? body.id ?? "";
  if (!authUserId || authUserId !== expectedAuthUserId) {
    throw new Error("The staff login identity does not match its Auth account");
  }
  const tokenHash = (body.properties?.hashed_token ?? body.hashed_token ?? "").trim();
  if (!tokenHash) throw new Error("The secure database session could not be prepared");
  return tokenHash;
}
