import { z } from "zod";
import { runtimeEnvValue } from "./external-supabase-config";
import { safeReceiptNo } from "./report-data-safety";

const uuid = z.string().regex(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
const version = z.number().int().min(1).max(2147483647);
const linesSchema = z.array(z.object({
  item_id: uuid,
  qty: z.number().int().min(1).max(999999999),
  expected_refunded_qty: z.number().int().min(0).max(999999999),
  expected_row_version: version,
}).strict()).min(1).max(100).refine(lines => new Set(lines.map(line => line.item_id)).size === lines.length);

export const groupedRefundUploadSchema = z.object({
  branchId: z.string().min(1).max(128),
  operationId: uuid,
  refundKey: z.string().min(1).max(128).refine(key => key.trim() === key && !/\p{Cc}/u.test(key)),
  saleId: uuid,
  expectedSaleVersion: version,
  lines: linesSchema,
  reason: z.string().max(400).nullable(),
  grantToken: z.string().min(1).max(4096).nullish(),
}).strict();

const context = { operation_id: uuid, sale_id: uuid };
const approvalBasis = z.object({
  bill_number: z.string().max(400).nullable(),
  total: z.string().regex(/^\d{1,80}(?:\.\d{1,80})?$/),
  row_version: version,
}).strict();
const dbReply = z.discriminatedUnion("status", [
  z.object({ ...context, status: z.literal("APPROVAL_CHECK_REQUIRED"), basis: approvalBasis }).strict(),
  z.object({ ...context, status: z.literal("REVIEW_REQUIRED"),
    code: z.enum(["LEGACY_REFUND_MOVEMENT", "REFUND_MOVEMENT_COLLISION"]) }).strict(),
  z.object({
    ...context, status: z.literal("APPLIED"), sale_row_version: version, fully_refunded: z.boolean(),
    effects: z.array(z.object({
      item_id: uuid, product_id: uuid, movement_id: uuid, branch_id: z.string(),
      delta: z.number().int().positive(), refunded_qty: z.number().int().nonnegative(), row_version: version,
    }).strict()).min(1).max(100),
    stock: z.array(z.object({
      product_id: uuid, branch_id: z.string(), balance: z.number().int().min(-2147483648).max(2147483647),
    }).strict()).min(1).max(100),
  }).strict(),
]);

type Command = z.infer<typeof groupedRefundUploadSchema>;
type Receipt = Extract<z.infer<typeof dbReply>, { status: "APPLIED" }>;
type Proof = {
  terminalToken?: string;
  deviceBindingProof?: string;
  sessionToken?: string;
  cashierToken?: string;
  accessToken?: string;
};

const reply = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });
const failure = (code: string, status: number) => reply({ ok: false, code }, status);
const unavailable = () => failure("REFUND_UPLOAD_UNAVAILABLE", 503);
const forbidden = () => failure("REFUND_UPLOAD_FORBIDDEN", 403);
const protocol = () => failure("REFUND_UPLOAD_PROTOCOL", 502);

function matchesEffects(command: Command, receipt: Receipt): boolean {
  const expected = new Map(command.lines.map(line => [line.item_id, line]));
  const products = new Set(receipt.effects.map(effect => effect.product_id));
  const movements = new Set(receipt.effects.map(effect => effect.movement_id));
  return receipt.sale_row_version === command.expectedSaleVersion + Number(receipt.fully_refunded) &&
    receipt.effects.length === expected.size && movements.size === expected.size &&
    receipt.stock.length === products.size &&
    receipt.stock.every(row => row.branch_id === command.branchId && products.delete(row.product_id)) &&
    receipt.effects.every(effect => {
      const line = expected.get(effect.item_id);
      return line && expected.delete(effect.item_id) && effect.branch_id === command.branchId &&
        effect.delta === line.qty && effect.refunded_qty === line.expected_refunded_qty + line.qty &&
        effect.row_version === line.expected_row_version + 1;
    });
}

export async function applyGroupedRefundUpload(
  command: Command, proof: Proof, pilotTerminals: () => string[] | undefined, signal: AbortSignal,
): Promise<Response> {
  const enabled = () => runtimeEnvValue("POS_GROUPED_CASH_SETTINGS_PILOT_ENABLED") === "true" &&
    runtimeEnvValue("POS_GROUPED_REFUND_UPLOAD_PILOT_ENABLED") === "true";
  const terminals = pilotTerminals();
  if (!enabled() || !terminals) return unavailable();
  const { terminalToken, deviceBindingProof } = proof;
  if (!terminalToken || !terminals.includes(terminalToken) || !deviceBindingProof ||
      (!proof.sessionToken && !proof.accessToken)) return forbidden();

  const { verifyRelayCaller, serviceRest } = await import("@/core/api/pos-relay.server");
  const { resolveRelayScope } = await import("@/core/api/relay-policy.server");
  let operator: { appUserId: string; id: string; role: string };
  try {
    const caller = await verifyRelayCaller(proof, { strictAvailability: true, rejectUnboundCashier: true });
    const terminal = caller.terminal;
    if (!terminal || terminal.id !== terminalToken || terminal.platform !== "pc" ||
        terminal.mode !== "operations" || terminal.branchId !== command.branchId ||
        caller.kind === "terminal" || (caller.kind === "cashier" && !proof.sessionToken) ||
        (caller.kind === "staff" && (!caller.email || caller.email.trim().toLowerCase().endsWith("@pos.local"))))
      return forbidden();
    const scope = await resolveRelayScope(caller, { strictAvailability: true });
    if (scope.stale || scope.managementDevice || scope.managementReplica || scope.terminalId !== terminal.id ||
        scope.storeId !== terminal.branchId || !scope.appUserId || !scope.staffUserId ||
        (scope.role !== "admin" && scope.roleSlug !== "admin" && scope.permissions.can_process_refund !== true))
      return forbidden();
    operator = { appUserId: scope.appUserId, id: scope.staffUserId, role: scope.roleSlug || scope.role || "staff" };
  } catch (error) {
    return (error as { status?: number })?.status === 503 ? unavailable() : forbidden();
  }

  const { boundedText } = await import("../../electron/sync/shift-recovery-exact.mjs");
  async function submit(basis: z.infer<typeof approvalBasis> | null) {
    if (!enabled() || !pilotTerminals()?.includes(terminalToken!) || signal.aborted) return unavailable();
    let response: Response;
    try {
      response = await serviceRest("rpc/pos_sync_refund_v1", {
        method: "POST", signal, redirect: "error", headers: { "Accept-Encoding": "identity" },
        body: JSON.stringify({
          p_author: operator.appUserId, p_branch: command.branchId, p_terminal: terminalToken,
          p_operation: command.operationId, p_refund_key: command.refundKey, p_sale: command.saleId,
          p_expected_sale_version: command.expectedSaleVersion, p_lines: command.lines,
          p_reason: command.reason, p_approval_basis: basis,
        }),
      });
    } catch { return unavailable(); }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel().catch(() => undefined);
        return forbidden();
      }
      try {
        const error = z.object({ message: z.string(), code: z.string() })
          .parse(JSON.parse(await boundedText(response, 4096)));
        if (error.code === "42501" || (error.code === "P0001" && [
          "FIN62_LIVE_AUTHOR_INVALID", "FIN62_LIVE_PERMISSION_DENIED", "FIN62_LIVE_BRANCH_DENIED",
        ].includes(error.message))) return forbidden();
        if (error.code === "22023" && error.message === "POS_REFUND_V1_INVALID_COMMAND")
          return failure("REFUND_UPLOAD_INVALID", 400);
        if (error.code === "22023" && error.message === "POS_REFUND_V1_REPLAY_MISMATCH")
          return failure("REFUND_UPLOAD_REPLAY_MISMATCH", 409);
        if (error.code === "40001" && error.message === "POS_REFUND_V1_STALE_COMMAND")
          return failure("REFUND_UPLOAD_STALE", 409);
      } catch { /* Keep upstream failures opaque. */ }
      return unavailable();
    }
    if (response.status !== 200 || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "") ||
        ![null, "identity"].includes(response.headers.get("content-encoding"))) {
      await response.body?.cancel().catch(() => undefined);
      return protocol();
    }
    try {
      const result = dbReply.parse(JSON.parse(await boundedText(response, 65536)));
      if (result.operation_id !== command.operationId || result.sale_id !== command.saleId ||
          (result.status === "APPLIED" && !matchesEffects(command, result))) return protocol();
      return result;
    } catch { return protocol(); }
  }

  const first = await submit(null);
  if (first instanceof Response) return first;
  if (first.status !== "APPROVAL_CHECK_REQUIRED") return reply(first);
  if (first.basis.row_version !== command.expectedSaleVersion) return failure("REFUND_UPLOAD_STALE", 409);

  const amount = Number(first.basis.total);
  if (!Number.isFinite(amount)) return protocol();
  try {
    const { checkBusinessAuthorization } = await import("./business-authorization.server");
    const authorization = await checkBusinessAuthorization(operator, {
      actionKey: "refund", storeId: command.branchId, requestedAmount: amount, grantToken: command.grantToken,
      payload: { sale_id: command.saleId, receipt_no: safeReceiptNo(first.basis.bill_number, command.saleId), total: amount },
    });
    if (!authorization.ok) return failure("REFUND_APPROVAL_REQUIRED", 403);
  } catch { return unavailable(); }

  const result = await submit(first.basis);
  if (result instanceof Response) return result;
  return result.status === "APPROVAL_CHECK_REQUIRED" ? protocol() : reply(result);
}
