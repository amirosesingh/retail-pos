import { z } from "zod";
import { RelayAuthenticationError, verifyRelayCaller } from "@/core/api/pos-relay.server";
import { resolveRelayScope } from "@/core/api/relay-policy.server";
import { runtimeEnvValue, supabaseConfig } from "./external-supabase-config";
import { sameBranchId } from "./branch-id";
import { sameRecordId } from "./sale-identity";

const grantSchema = z.object({
  action: z.literal("pin_approval_wake_grant"),
  projectUrl: z.string().url().max(400),
  sessionToken: z.string().min(10).max(400),
  terminalToken: z.string().min(1).max(200),
  deviceBindingProof: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();

function readPilot() {
  const project = runtimeEnvValue("POS_PIN_APPROVAL_WAKE_PROJECT_URL");
  const signingKey = runtimeEnvValue("POS_PIN_APPROVAL_WAKE_SIGNING_JWK");
  const terminals = runtimeEnvValue("POS_PIN_APPROVAL_WAKE_TERMINAL_IDS")?.split(",").map(id => id.trim());
  if (!project || !signingKey || signingKey.length > 2048 || !terminals?.length || terminals.length > 2 ||
      terminals.some(id => !id || id.length > 200)) return undefined;
  try {
    const url = new URL(project);
    const jwk = JSON.parse(signingKey) as JsonWebKey & { kid?: string };
    if (url.protocol === "https:" && url.origin === project && supabaseConfig().url === project &&
        jwk.kty === "EC" && jwk.crv === "P-256" && typeof jwk.kid === "string" &&
        /^[A-Za-z0-9_.-]{1,100}$/.test(jwk.kid) && [jwk.d, jwk.x, jwk.y].every(value =>
          typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value)))
      return { project, signingKey, jwk, kid: jwk.kid, terminals };
  } catch { /* The relay must serve the same configured project. */ }
  return undefined;
}

const base64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

export async function issuePinApprovalWakeGrant(body: unknown, signal: AbortSignal) {
  const parsed = grantSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { ok: false } };
  const pilot = readPilot();
  if (!pilot) return { status: 404, body: { ok: false } };
  const input = parsed.data;
  if (input.projectUrl !== pilot.project || !pilot.terminals.some(id => sameRecordId(id, input.terminalToken)))
    return { status: 403, body: { ok: false, enabled: false } };
  try {
    const caller = await verifyRelayCaller(input, { strictAvailability: true, requireBoundCashier: true });
    const terminal = caller.terminal;
    if (caller.kind !== "cashier" || !terminal?.branchId || terminal.mode !== "operations" ||
        !sameRecordId(terminal.id, input.terminalToken) || !sameBranchId(caller.storeId, terminal.branchId))
      return { status: 403, body: { ok: false } };
    const scope = await resolveRelayScope(caller, { strictAvailability: true });
    const current = readPilot();
    if (scope.stale || !scope.staffUserId || !sameBranchId(scope.storeId, terminal.branchId) ||
        !scope.terminalId || !sameRecordId(scope.terminalId, terminal.id) || !current ||
        current.project !== pilot.project || current.signingKey !== pilot.signingKey || signal.aborted ||
        !current.terminals.some(id => sameRecordId(id, terminal.id)))
      return { status: 403, body: { ok: false } };

    const identity = [terminal.branchId, scope.staffUserId].map(value => value.trim().toLowerCase());
    if (identity.some(value => !value || value.includes("\x1f"))) return { status: 403, body: { ok: false } };
    const encoder = new TextEncoder();
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(identity.join("\x1f")));
    const topic = "pos-pin-approval-wake:v1:" + Buffer.from(digest).toString("hex");
    const issuedAt = Math.floor(Date.now() / 1000);
    const expires = issuedAt + 120;
    // No Auth subject, email, staff role, service key or Data API authority.
    // The prepared policy grants this anon bearer one private Broadcast topic.
    const signed = `${base64({ alg: "ES256", kid: pilot.kid, typ: "JWT" })}.${base64({
      role: "anon", iat: issuedAt, exp: expires, pos_pin_approval_wake_topic: topic,
    })}`;
    const key = await crypto.subtle.importKey("jwk", pilot.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const bytes = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(signed));
    const signature = Buffer.from(bytes).toString("base64url");
    if (signal.aborted) return { status: 503, body: { ok: false } };
    return { status: 200, body: {
      ok: true, protocol: "pin-approval-wake-v1", projectUrl: pilot.project, terminalId: terminal.id,
      branchId: terminal.branchId, topic, bearer: `${signed}.${signature}`, expiresAt: expires * 1000,
    } };
  } catch (error) {
    const status = error instanceof RelayAuthenticationError || (error as { status?: number })?.status === 401 ? 403 : 503;
    return { status, body: { ok: false } };
  }
}
