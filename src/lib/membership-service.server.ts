import { runtimeEnvValue, supabaseConfig } from "./external-supabase-config";
import { serviceRest } from "@/core/api/pos-relay.server";
import { z } from "zod";

type MembershipRow = {
  id: string;
  member_code: string;
  full_name: string;
  loyalty_points: number | string;
  tier_name: string;
};

type MembershipDirectoryRow = MembershipRow & {
  phone: string;
  total_spent: number | string;
  is_verified: boolean;
  status: string;
  created_at: string;
  updated_at: string;
  directory_revision: number | string;
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
    membershipId: row.id,
  }));
}

export async function syncMembershipDirectory(afterRevision: number, limit: number) {
  const pageSize = Math.min(Math.max(Math.trunc(limit) || 500, 1), 1000);
  const cursorRevision = Math.max(Math.trunc(afterRevision) || 0, 0);
  const rows = (await serviceRpc("membership_directory_delta", {
    p_after_revision: cursorRevision,
    p_limit: pageSize,
  })) as MembershipDirectoryRow[];
  if (rows.length) {
    const response = await serviceRest("rpc/membership_directory_apply", {
      method: "POST",
      body: JSON.stringify({ p_rows: rows }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`POS member mirror rejected the request (${response.status}): ${detail}`);
    }
  }
  const nextRevision = rows.reduce(
    (maximum, row) => Math.max(maximum, Number(row.directory_revision) || 0),
    cursorRevision,
  );
  return {
    mirrored: rows.length,
    nextRevision,
    hasMore: rows.length === pageSize && nextRevision > cursorRevision,
  };
}

const lookupRequest = z.object({
  accessToken: z.string().min(10).max(4000).optional(),
  terminalToken: z.string().min(10).max(200).optional(),
  cashierToken: z.string().min(10).max(2000).optional(),
  query: z.string().trim().min(2).max(120),
  limit: z.number().int().min(1).max(10),
});

const directoryRequest = z.object({
  accessToken: z.string().min(10).max(4000).optional(),
  terminalToken: z.string().min(10).max(200).optional(),
  cashierToken: z.string().min(10).max(2000).optional(),
  afterRevision: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(1000).default(500),
});

async function verifyCaller(input: z.infer<typeof directoryRequest> | z.infer<typeof lookupRequest>) {
  const { verifyRelayCaller } = await import("@/core/api/pos-relay.server");
  await verifyRelayCaller(input);
}

/** Authenticated membership gateway used by Electron, Android and web POS. */
export async function handleMembershipLookupRequest(request: Request): Promise<Response> {
  const parsed = lookupRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid membership lookup" }, { status: 400 });
  }
  try {
    await verifyCaller(parsed.data);
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

/** Proof-bound bridge: membership service role stays on the server. */
export async function handleMembershipDirectoryRequest(request: Request): Promise<Response> {
  const parsed = directoryRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid membership directory request" }, { status: 400 });
  }
  try {
    await verifyCaller(parsed.data);
  } catch {
    return Response.json({ ok: false, error: "This terminal is not authorized" }, { status: 401 });
  }
  try {
    const result = await syncMembershipDirectory(parsed.data.afterRevision, parsed.data.limit);
    return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const unavailable = error instanceof Error && /not configured|rejected|fetch|timeout/i.test(error.message);
    return Response.json(
      { ok: false, error: unavailable ? "The membership directory is temporarily unavailable" : "Membership directory synchronization failed" },
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
