import { z } from "zod";
import { serviceRest } from "@/core/api/pos-relay.server";
import type { RelayScope } from "@/core/api/relay-policy.server";
import { runtimeEnvValue, supabaseConfig } from "./external-supabase-config";
import { RELEASE_CHANNEL } from "./release-channel";
import type { VerifiedTerminalDescriptor } from "./terminal-binding.server";
import {
  stockHistoryProductMergeReceiptStatusSchema, validateProductMergeReceipt, type StockHistoryProductMergeRelay,
} from "./stock-history-product-merge";

const exactOrigin = z.string().max(255).refine(value => {
  try { return new URL(value).protocol === "https:" && new URL(value).origin === value; }
  catch { return false; }
});
const pilotSchema = z.object({
  backendOrigin: exactOrigin, projectOrigin: exactOrigin, branchId: z.string().min(1).max(128),
  terminalId: z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/),
}).strict();
const rpc = {
  capability: "rpc/pos_stock_history_product_merge_capability",
  merge: "rpc/pos_stock_history_merge_products",
  receipt: "rpc/pos_stock_history_product_merge_receipt",
} as const;

function enrolled(input: StockHistoryProductMergeRelay, url: string) {
  if (RELEASE_CHANNEL !== "beta") return false;
  const raw = runtimeEnvValue("POS_STOCK_HISTORY_PRODUCT_MERGE_PILOT");
  if (!raw || raw.length > 1024) return false;
  try {
    const parsed = pilotSchema.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.backendOrigin === new URL(url).origin &&
      parsed.data.projectOrigin === supabaseConfig().url &&
      parsed.data.branchId === input.branchId && parsed.data.terminalId === input.terminalId;
  } catch { return false; }
}

const reply = (value: object, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
const unverified = () => reply({
  ok: false, code: "ESYNC_PRODUCT_MERGE_UNVERIFIED", error: "The merge could not be confirmed. Retry the same merge to check its result.",
}, 503);
const denied = () => reply({
  ok: false, code: "PRODUCT_MERGE_SCOPE_DENIED", error: "Product merging requires an authorized account on the enrolled branch terminal.",
}, 403);

const failure = {
  PRODUCT_MERGE_REPLAY_MISMATCH: "These products do not match the saved merge request.",
  PRODUCT_MERGE_INVALID: "The saved product selection could not be verified. Keep this merge for review.",
  PRODUCT_MERGE_ROSTER_CHANGED: "One or more selected products changed. The saved merge needs verification.",
  PRODUCT_MERGE_MASTER_UNVERIFIED: "The product to keep has unverified stock or is no longer active.",
  PRODUCT_MERGE_MASTER_IN_USE: "Finish the master product's open booking or held ticket before merging.",
  PRODUCT_MERGE_STOCK_OVERFLOW: "The merged stock exceeds the supported quantity.",
  PRODUCT_MERGE_ALIASES_TOO_LARGE: "Too many barcode aliases would be added to the master product.",
  PRODUCT_MERGE_BUSY: "Inventory is being updated. Retry this merge after the current work finishes.",
} as const;

export async function stockHistoryProductMerge(input: StockHistoryProductMergeRelay, request: Request,
  terminal: VerifiedTerminalDescriptor | undefined, scope: RelayScope, bound: boolean) {
  if (!enrolled(input, request.url)) return input.action === "capability" ? reply({ ok: true, enabled: false }) : denied();
  if (!bound || terminal?.platform !== "pc" || terminal.mode !== "operations" || terminal.id !== input.terminalId ||
      terminal.branchId !== input.branchId || scope.terminalId !== input.terminalId || scope.storeId !== input.branchId ||
      scope.kind === "terminal" || scope.stale || scope.managementDevice || scope.managementReplica || !scope.appUserId)
    return denied();
  const admin = scope.role === "admin" || scope.roleSlug === "admin";
  if (!admin && (scope.permissions.can_merge_products !== true || scope.permissions.can_archive_product !== true))
    return denied();
  try {
    const params = { p_branch: input.branchId, p_terminal: input.terminalId, p_author: scope.appUserId };
    const response = await serviceRest(rpc[input.action], {
      method: "POST", redirect: "error", signal: request.signal,
      body: JSON.stringify(input.action === "capability" ? params : {
        ...params, p_operation: input.operationId, p_master: input.masterId, p_roster: input.roster,
      }),
    });
    const raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > 2_000_000) return unverified();
    const result: unknown = JSON.parse(raw);
    if (response.ok) {
      if (input.action === "capability") return result === true ? reply({ ok: true, enabled: true }) : unverified();
      const { action: _action, terminalId: _terminalId, ...operation } = input;
      if (input.action === "receipt") {
        const { receipt } = stockHistoryProductMergeReceiptStatusSchema.parse(result);
        return reply({ ok: true, receipt: receipt === null ? null : validateProductMergeReceipt(receipt, operation) });
      }
      return reply(validateProductMergeReceipt(result, operation));
    }
    const known = z.object({ message: z.string(), code: z.string().optional() }).safeParse(result);
    if (response.status === 401 || response.status === 403 || known.success && known.data.code === "42501") return denied();
    if (!known.success) return unverified();
    const code = ["55P03", "40P01"].includes(known.data.code ?? "") ? "PRODUCT_MERGE_BUSY" : known.data.message;
    if (!Object.hasOwn(failure, code)) return unverified();
    return reply({ ok: false, code, error: failure[code as keyof typeof failure] }, 409);
  } catch { return unverified(); }
}
