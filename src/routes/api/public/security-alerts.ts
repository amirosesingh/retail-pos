/**
 * POST /api/public/security-alerts — deployment scanners post their findings
 * here. Callers must sign the raw body with the shared ingest secret; the
 * signed payload is forwarded to the database, which de-duplicates findings and
 * closes ones that no longer appear.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { runtimeEnvValue } from "@/lib/external-supabase-config";

const payload = z.object({
  deploymentRef: z.string().max(200).default(""),
  findings: z
    .array(
      z.object({
        id: z.string().max(160).optional(),
        severity: z.enum(["critical", "high", "medium", "low", "info"]).optional(),
        title: z.string().min(1).max(200),
        detail: z.string().max(4000).optional(),
      }),
    )
    .max(200),
});

async function handle({ request }: { request: Request }) {
  const raw = await request.text();
  // Shared caller check for every /api/public/* endpoint.
  const { verifyHmacSignature } = await import("@/lib/public-api-guard.server");
  const denied = verifyHmacSignature({
    raw,
    signature: request.headers.get("x-security-signature"),
    secret:
      runtimeEnvValue("SECURITY_ALERT_INGEST_SECRET") ??
      process.env["SECURITY_ALERT_INGEST_SECRET"],
    label: "Security alert ingest",
  });
  if (denied) return denied;

  let parsed;
  try {
    parsed = payload.safeParse(JSON.parse(raw));
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!parsed.success) return Response.json({ error: "Invalid payload" }, { status: 400 });

  const { serviceRest } = await import("@/core/api/pos-relay.server");
  const res = await serviceRest("rpc/security_report_findings", {
    method: "POST",
    body: JSON.stringify({
      _source: "ci",
      _deployment_ref: parsed.data.deploymentRef,
      _findings: parsed.data.findings,
    }),
  });

  const body = await res.text();
  if (!res.ok) {
    console.error(`Security finding ingest failed [${res.status}]`);
    return Response.json({ error: "Security finding ingest failed" }, { status: res.status });
  }
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/security-alerts")({
  server: { handlers: { POST: handle } },
});
