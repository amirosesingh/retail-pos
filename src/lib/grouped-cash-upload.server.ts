import { createHash } from "node:crypto";
import { z } from "zod";
import { runtimeEnvValue } from "./external-supabase-config";

const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const sequence = z.string().regex(/^[1-9][0-9]{0,18}$/)
  .refine(value => value.length < 19 || value <= "9223372036854775807");
export const groupedCashUploadSchema = z.object({
  organizationId: z.literal("default"),
  branchId: z.string().min(1).max(128),
  installationGeneration: uuid,
  databaseGuid: uuid,
  feedEpoch: uuid,
  operationId: uuid,
  checkoutJson: z.string().min(2).max(512 * 1024),
  checkoutSha256: digest,
  attestation: z.object({}).passthrough(),
}).strict();
const applied = z.object({
  status: z.enum(["APPLIED", "ALREADY_APPLIED"]),
  result: z.object({
    scope_id: z.string(), epoch: uuid, seq: sequence, sale_id: uuid, operation_id: uuid, terminal_id: uuid,
    installation_generation: uuid, database_guid: uuid, checkout_sha256: digest, author_id: uuid, author_key_id: uuid,
  }).strict(),
}).strict();
const held = z.union([
  z.object({ status: z.literal("WAITING_DEPENDENCY"), result: z.object({ reason: z.literal("SHIFT_MISSING") }).strict() }).strict(),
  z.object({ status: z.literal("REVIEW_REQUIRED"), result: z.object({ reason: z.literal("LEGACY_OR_CONFLICTING_IDENTITY") }).strict() }).strict(),
  z.object({ status: z.enum(["INTEGRITY_CONFLICT", "IN_PROGRESS"]) }).strict(),
]);
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const unavailable = () => reply({ ok: false, code: "CASH_UPLOAD_UNAVAILABLE" }, 503);
const denied = () => reply({ ok: false, code: "CASH_UPLOAD_FORBIDDEN" }, 403);
const protocol = () => reply({ ok: false, code: "CASH_UPLOAD_PROTOCOL" }, 502);

export async function applyGroupedCashUpload(
  command: z.infer<typeof groupedCashUploadSchema>,
  proof: { terminalToken?: string; deviceBindingProof?: string },
  pilotTerminals: () => string[] | undefined, signal: AbortSignal,
) {
  const enabled = () => runtimeEnvValue("POS_GROUPED_CASH_SETTINGS_PILOT_ENABLED") === "true" &&
    runtimeEnvValue("POS_GROUPED_CASH_UPLOAD_PILOT_ENABLED") === "true";
  const terminals = pilotTerminals();
  if (!enabled() || !terminals) return unavailable();
  const { terminalToken, deviceBindingProof } = proof;
  if (!terminalToken || !terminals.includes(terminalToken) || !deviceBindingProof) return denied();
  let saleId: string;
  try {
    if (new TextEncoder().encode(command.checkoutJson).byteLength > 512 * 1024 ||
        new TextEncoder().encode(JSON.stringify(command.attestation)).byteLength > 4096 ||
        createHash("sha256").update(command.checkoutJson, "utf8").digest("hex") !== command.checkoutSha256)
      throw new Error("Checkout digest mismatch");
    const checkout = JSON.parse(command.checkoutJson);
    if (Object.hasOwn(checkout ?? {}, "tenders") && runtimeEnvValue("POS_GROUPED_TENDER_UPLOAD_PILOT_ENABLED") !== "true")
      return unavailable();
    saleId = uuid.parse(checkout?.sale?.id);
  } catch { return reply({ ok: false, code: "CASH_UPLOAD_INVALID" }, 400); }

  const { verifyRelayCaller, serviceRest } = await import("@/core/api/pos-relay.server");
  const { resolveRelayScope } = await import("@/core/api/relay-policy.server");
  const { verifyCashCheckoutAttestation } = await import("./shift-author-verification.server");
  let author;
  try {
    const caller = await verifyRelayCaller({ terminalToken, deviceBindingProof }, { strictAvailability: true });
    const terminal = caller.terminal;
    if (!terminal || terminal.id !== terminalToken || terminal.platform !== "pc" || terminal.mode !== "operations" ||
        terminal.branchId !== command.branchId) return denied();
    const scope = await resolveRelayScope(caller, { strictAvailability: true });
    if (scope.stale || scope.managementDevice || scope.managementReplica || scope.terminalId !== terminal.id ||
        scope.storeId !== terminal.branchId) return denied();
    author = await verifyCashCheckoutAttestation({ ...command, terminal });
  } catch (error) {
    return (error as { status?: number })?.status === 503 ? unavailable() : denied();
  }
  if (!enabled() || !pilotTerminals()?.includes(terminalToken) || signal.aborted) return unavailable();
  let response: Response;
  try {
    response = await serviceRest("rpc/pos_sync_cash_checkout_attested_v1", {
      method: "POST", redirect: "error", signal, headers: { "Accept-Encoding": "identity" },
      body: JSON.stringify({
        p_organization_id: command.organizationId, p_branch_id: command.branchId, p_terminal_id: terminalToken,
        p_binding_proof: deviceBindingProof, p_installation_generation: command.installationGeneration,
        p_database_guid: command.databaseGuid, p_operation_id: command.operationId, p_epoch: command.feedEpoch,
        p_checkout_json: command.checkoutJson, p_checkout_sha256: command.checkoutSha256,
        p_author_key_id: author.keyId, p_author_id: author.authorId, p_author_subject: author.subject,
        p_project_origin: author.projectOrigin,
      }),
    });
  } catch { return unavailable(); }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return response.status === 401 || response.status === 403 ? denied() : unavailable();
  }
  if (response.status !== 200 || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "") ||
      ![null, "identity"].includes(response.headers.get("content-encoding"))) {
    await response.body?.cancel().catch(() => undefined);
    return protocol();
  }
  try {
    const { boundedText } = await import("../../electron/sync/shift-recovery-exact.mjs");
    const data: unknown = JSON.parse(await boundedText(response, 4096));
    const disposition = held.safeParse(data);
    if (disposition.success) return reply(disposition.data);
    const receipt = applied.parse(data);
    const result = receipt.result;
    if (result.scope_id !== command.branchId || result.epoch !== command.feedEpoch || result.sale_id !== saleId ||
        result.operation_id !== command.operationId || result.terminal_id !== terminalToken ||
        result.installation_generation !== command.installationGeneration || result.database_guid !== command.databaseGuid ||
        result.checkout_sha256 !== command.checkoutSha256 || result.author_id !== author.authorId ||
        result.author_key_id !== author.keyId) return protocol();
    return reply(receipt);
  } catch { return protocol(); }
}
