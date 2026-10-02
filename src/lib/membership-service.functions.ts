import { z } from "zod";
import { posFetch } from "@/lib/server-origin";

const caller = z.object({
  accessToken: z.string().min(10).max(4000).optional(),
  terminalToken: z.string().min(10).max(200).optional(),
  cashierToken: z.string().min(10).max(2000).optional(),
});

const member = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  phone: z.string(),
  email: z.string(),
  tier: z.enum(["Bronze", "Silver", "Gold"]),
  points: z.number(),
  totalSpend: z.number(),
  joinedAt: z.string(),
  verified: z.boolean(),
});

const input = caller.extend({
  query: z.string().trim().min(2).max(120),
  limit: z.number().int().min(1).max(10),
});

/**
 * Membership lookup always goes through the configured company HTTPS domain.
 * A packaged Electron build never receives the membership project address or
 * its service credential; it presents its existing till/person proof to the
 * hosted POS, which performs the cross-project lookup server-side.
 */
export async function searchMembershipForPos({ data }: { data: z.input<typeof input> }) {
  const payload = input.parse(data);
  const response = await posFetch("/api/v1/pos/sync?operation=membership_lookup", {
    method: "POST",
    signal: AbortSignal.timeout(8_000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => null)) as
    | { ok?: boolean; members?: unknown; error?: string }
    | null;
  if (!response.ok || !body?.ok) {
    throw new Error(body?.error || `Membership lookup failed (${response.status})`);
  }
  return z.array(member).max(10).parse(body.members);
}
