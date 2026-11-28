import { z } from "zod";
import { runtimeEnvValue } from "./external-supabase-config";

const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const sequence = z.string().regex(/^[1-9][0-9]{0,18}$/)
  .refine(value => value.length < 19 || value <= "9223372036854775807");

export const groupedSettingsEditSchema = z.object({
  organizationId: z.literal("default"),
  branchId: z.string().min(1).max(128),
  installationGeneration: uuid,
  databaseGuid: uuid,
  feedEpoch: uuid,
  personId: uuid,
  operationId: uuid,
  expectedVersion: z.number().int().min(1).max(2147483646),
  patch: z.object({
    block_shift_close_on_hold: z.boolean().optional(),
    max_drawer_cash_limit: z.string().regex(/^(?:0|[1-9][0-9]{0,25})(?:\.[0-9]{1,12})?$/).optional(),
  }).strict().refine(patch => Object.keys(patch).length > 0),
}).strict();

const receiptContext = {
  scope_id: z.string(), epoch: uuid, operation_id: uuid, terminal_id: uuid,
  person_id: uuid, installation_generation: uuid, database_guid: uuid,
  expected_version: z.number().int(),
};
const receiptSchema = z.union([
  z.object({
    status: z.enum(["APPLIED", "ALREADY_APPLIED"]),
    result: z.object({ ...receiptContext, row_version: z.number().int(), seq: sequence }).strict(),
  }).strict(),
  z.object({
    status: z.literal("REVIEW_REQUIRED"),
    result: z.object({ ...receiptContext, code: z.literal("STALE_RULES") }).strict(),
  }).strict(),
  z.object({ status: z.literal("INTEGRITY_CONFLICT") }).strict(),
]);

type SettingsEdit = z.infer<typeof groupedSettingsEditSchema>;
type Proof = { terminalToken?: string; deviceBindingProof?: string; accessToken?: string };
const reply = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });
const unavailable = () => reply({ ok: false, code: "SETTINGS_EDIT_UNAVAILABLE", error: "Settings upload is unavailable." }, 503);
const denied = () => reply({ ok: false, code: "SETTINGS_EDIT_FORBIDDEN", error: "This settings edit requires the enrolled till and authorized operator." }, 403);
const protocol = () => reply({ ok: false, code: "SETTINGS_EDIT_PROTOCOL", error: "The database did not confirm this settings edit." }, 502);

export async function applyGroupedSettingsEdit(
  edit: SettingsEdit, proof: Proof, pilotTerminals: () => string[] | undefined, signal: AbortSignal,
): Promise<Response> {
  const terminals = pilotTerminals();
  if (!terminals || runtimeEnvValue("POS_GROUPED_SETTINGS_EDIT_PILOT_ENABLED") !== "true") return unavailable();
  const { terminalToken, deviceBindingProof, accessToken } = proof;
  if (!terminalToken || !terminals.includes(terminalToken) || !deviceBindingProof || !accessToken) return denied();

  const { verifyRelayCaller, serviceRest } = await import("@/core/api/pos-relay.server");
  const { resolveRelayScope } = await import("@/core/api/relay-policy.server");
  try {
    const caller = await verifyRelayCaller({ terminalToken, deviceBindingProof, accessToken }, { strictAvailability: true });
    const terminal = caller.terminal;
    if (caller.kind !== "staff" || caller.authUserId !== edit.personId || !caller.email ||
        caller.email.trim().toLowerCase().endsWith("@pos.local") || !terminal || terminal.id !== terminalToken ||
        terminal.platform !== "pc" || terminal.mode !== "operations" || terminal.branchId !== edit.branchId)
      return denied();
    const scope = await resolveRelayScope(caller, { strictAvailability: true });
    if (scope.stale || scope.managementDevice || scope.managementReplica || scope.terminalId !== terminal.id ||
        scope.storeId !== terminal.branchId || !(scope.isSupervisor || scope.permissions.can_access_pos_settings === true))
      return denied();
  } catch (error) {
    return (error as { status?: number })?.status === 503 ? unavailable() : denied();
  }

  let response: Response;
  try {
    if (runtimeEnvValue("POS_GROUPED_SETTINGS_EDIT_PILOT_ENABLED") !== "true" ||
        !pilotTerminals()?.includes(terminalToken)) return unavailable();
    response = await serviceRest("rpc/pos_sync_apply_store_settings_edit_v1", {
      method: "POST", signal, redirect: "error", headers: { "Accept-Encoding": "identity" },
      body: JSON.stringify({
        p_organization_id: edit.organizationId, p_branch_id: edit.branchId, p_terminal_id: terminalToken,
        p_binding_proof: deviceBindingProof, p_installation_generation: edit.installationGeneration,
        p_database_guid: edit.databaseGuid, p_epoch: edit.feedEpoch, p_person_id: edit.personId,
        p_operation_id: edit.operationId, p_expected_version: edit.expectedVersion, p_patch: edit.patch,
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
    const parsed = receiptSchema.safeParse(JSON.parse(await boundedText(response, 4096)));
    if (!parsed.success) return protocol();
    const receipt = parsed.data;
    if (receipt.status === "INTEGRITY_CONFLICT") return reply(receipt);
    const result = receipt.result;
    if (result.scope_id !== edit.branchId || result.epoch !== edit.feedEpoch ||
        result.operation_id !== edit.operationId || result.terminal_id !== terminalToken || result.person_id !== edit.personId ||
        result.installation_generation !== edit.installationGeneration || result.database_guid !== edit.databaseGuid ||
        result.expected_version !== edit.expectedVersion ||
        ("row_version" in result && result.row_version !== edit.expectedVersion + 1)) return protocol();
    return reply(receipt);
  } catch { return protocol(); }
}
