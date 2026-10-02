import { runtimeEnvValue, supabaseConfig } from "./external-supabase-config";
import { z } from "zod";

type MembershipRow = {
  id: string;
  member_code: string;
  full_name: string;
  loyalty_points: number | string;
  tier_name: string;
};

function serviceKey(): string {
  const key =
    runtimeEnvValue("MEMBERSHIP_SUPABASE_SERVICE_ROLE_KEY") ??
    (typeof process !== "undefined"
      ? process.env["MEMBERSHIP_SUPABASE_SERVICE_ROLE_KEY"]?.trim()
      : undefined);
  if (!key) throw new Error("Membership service credentials are not configured");
  return key;
}

async function serviceRpc(name: string, body: Record<string, unknown>): Promise<unknown> {
  const { url } = supabaseConfig("membership");
  const key = serviceKey();
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    signal: AbortSignal.timeout(8_000),
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Membership service rejected the request (${response.status}): ${detail}`);
  }
  return response.status === 204 ? null : response.json();
}

export async function lookupMembership(query: string, limit: number) {
  const rows = (await serviceRpc("membership_lookup_for_pos", {
    p_query: query,
  })) as MembershipRow[];
  return rows.slice(0, Math.min(Math.max(limit, 1), 10)).map((row) => ({
    id: row.id,
    code: row.member_code,
    name: row.full_name,
    // The verified international phone number is the membership number. Keep
    // it in the local SQL member snapshot so the same member can be found when
    // the till is offline.
    phone: row.member_code,
    email: "",
    tier: row.tier_name === "Gold" || row.tier_name === "Silver" ? row.tier_name : "Bronze",
    points: Number(row.loyalty_points) || 0,
    totalSpend: 0,
    joinedAt: "",
    verified: true,
  }));
}

const lookupRequest = z.object({
  accessToken: z.string().min(10).max(4000).optional(),
  terminalToken: z.string().min(10).max(200).optional(),
  cashierToken: z.string().min(10).max(2000).optional(),
  query: z.string().trim().min(2).max(120),
  limit: z.number().int().min(1).max(10),
});

/** Authenticated membership gateway used by Electron, Android and web POS. */
export async function handleMembershipLookupRequest(request: Request): Promise<Response> {
  const parsed = lookupRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid membership lookup" }, { status: 400 });
  }
  try {
    const { verifyRelayCaller } = await import("@/core/api/pos-relay.server");
    await verifyRelayCaller(parsed.data);
  } catch {
    return Response.json({ ok: false, error: "This terminal is not authorized" }, { status: 401 });
  }
  try {
    const members = await lookupMembership(parsed.data.query, parsed.data.limit);
    return Response.json({ ok: true, members }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const unavailable =
      error instanceof Error && /not configured|rejected the request|fetch|timeout/i.test(error.message);
    return Response.json(
      {
        ok: false,
        error: unavailable
          ? "The membership service is temporarily unavailable"
          : "Membership lookup failed",
      },
      { status: unavailable ? 503 : 500 },
    );
  }
}

export function hasMembershipGatewayConfig(): boolean {
  try {
    supabaseConfig("membership");
    serviceKey();
    return true;
  } catch {
    return false;
  }
}
