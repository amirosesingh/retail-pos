import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { serviceRest } from "@/core/api/pos-relay.server";
import { publicSupabaseConfig, supabaseConfig } from "@/lib/external-supabase-config";
import { corsPreflight, withCors } from "@/lib/public-cors";
import { terminalDescriptor,terminalProofMatches,type TerminalBindingRow } from "@/lib/terminal-binding.server";

const body = z.object({
  tokenId: z.string().uuid(),
  proofHash: z.string().regex(/^[0-9a-f]{64}$/i),
});

type PairingRow = TerminalBindingRow & {
  id: string;
  status: "active" | "used" | "revoked";
  location_id: string | null;
  location_name: string | null;
  device_name: string | null;
  expires_at: string | null;
  claim_proof: string | null;
  revoked_at: string | null;
};

/**
 * A fresh Electron till knows only the company's HTTPS POS address. It posts
 * the UUID and sealed-device proof displayed in its pairing QR here. The
 * service-key lookup releases the public Supabase connection pair only after
 * an administrator has created the matching, proof-bound terminal row.
 */
export async function handlePost(request: Request): Promise<Response> {
  const { callerVerifiedDownstream } = await import("@/lib/public-api-guard.server");
  const denied = callerVerifiedDownstream(
    "the UUID and sealed device proof are matched server-side before connection details are returned",
  );
  if (denied) return denied;
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ approved: false, error: "Invalid pairing request" }, { status: 400 });
  }

  const { tokenId, proofHash } = parsed.data;
  const query =
    `terminal_tokens?id=eq.${encodeURIComponent(tokenId)}` +
    "&select=id,status,location_id,location_name,device_name,expires_at,claim_proof,claimed_proof_hash,revoked_at,is_claimed,claimed_at,platform,claimed_platform,management_registration&limit=1";
  const result = await serviceRest(query, { method: "GET" });
  if (!result.ok) {
    return Response.json(
      { approved: false, error: "Could not verify the pairing approval" },
      { status: 502 },
    );
  }

  const rows = (await result.json()) as PairingRow[];
  const row = rows[0];
  // A missing row is the normal waiting state. Do not reveal whether the UUID
  // exists without the matching proof.
  if (!row || !terminalProofMatches(row,proofHash)) return Response.json({ approved: false }, { headers: { "Cache-Control": "no-store" } });

  if (row.status === "revoked" || row.revoked_at) {
    return Response.json(
      { approved: true, status: "revoked" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  let terminal:ReturnType<typeof terminalDescriptor>|undefined;
  if(row.is_claimed || row.claimed_at || row.status==="used"){
    try{terminal=terminalDescriptor(row);}
    catch{return Response.json({approved:false,error:"This terminal activation requires review."},{status:409,headers:{"Cache-Control":"no-store"}});}
  }

  const { url, key } = supabaseConfig();
  const membership = publicSupabaseConfig("membership");
  return Response.json(
    {
      approved: true,
      status: row.status,
      ...(terminal ? {terminal}: {}),
      locationId: row.location_id,
      managementDevice: row.location_id === null,
      locationName: row.location_name ?? "",
      deviceName: row.device_name ?? "",
      expiresAt: row.expires_at,
      supabaseUrl: url,
      supabaseKey: key,
      membershipSupabaseUrl: membership?.url,
      membershipSupabaseKey: membership?.key,
      backendUrl: new URL(request.url).origin,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export const Route = createFileRoute("/api/public/terminal-pairing")({
  server: {
    handlers: {
      POST: async ({ request }) => withCors(await handlePost(request), request),
      OPTIONS: async ({ request }) => corsPreflight(request),
    },
  },
});
