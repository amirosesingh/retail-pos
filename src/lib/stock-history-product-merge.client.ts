import { readTerminalConfig } from "@/core/activation/terminal-tokens";
import { localConfigurationBridge } from "@/core/local-db/local-db";
import { relayProductMerge } from "@/core/api/sync-relay";
import type { Product } from "@/core/types/pos-types";
import { clearDeviceSecret, getDeviceSecret, setDeviceSecret } from "./device-secrets";
import { supabaseConfig } from "./external-supabase-config";
import { RELEASE_CHANNEL } from "./release-channel";
import { recordId } from "./sale-identity";
import { serverOrigin } from "./server-origin";
import { sessionEpoch } from "./session-epoch";
import {
  stockHistoryProductMergeCapabilitySchema,
  stockHistoryProductMergeReceiptStatusSchema,
  stockHistoryProductMergeRequestSchema,
  validateProductMergeReceipt,
  type StockHistoryProductMergeRequest,
  type StockHistoryProductMergeFailure,
} from "./stock-history-product-merge";

const pending = new Set<string>();
const unverified = () => Object.assign(new Error("The merge could not be confirmed. Check the saved merge again after synchronization."),
  { code: "ESYNC_PRODUCT_MERGE_UNVERIFIED" });

function replyFailure(value: unknown): StockHistoryProductMergeFailure | undefined {
  if (!value || typeof value !== "object" || !("ok" in value) || value.ok !== false) return undefined;
  return {
    ok: false,
    code: "code" in value && typeof value.code === "string" ? value.code : undefined,
    error: "error" in value && typeof value.error === "string" && value.error.length <= 220 ? value.error : undefined,
  };
}

function mergeScope(branchId: string, actorId: string | null) {
  const config = readTerminalConfig();
  const terminalId = recordId(config?.tokenId ?? "");
  const assignedBranch = recordId(config?.locationId ?? "");
  if (!terminalId || config?.deviceUse === "management" || config?.deviceType === "mobile" || assignedBranch !== branchId)
    return null;
  const project = new URL(supabaseConfig().url).origin;
  const backend = serverOrigin() || window.location.origin;
  return { terminalId, key: JSON.stringify([project, backend, terminalId, branchId, actorId]) };
}

async function attemptKey(scope: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(scope));
  return "product-merge-attempt:" + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function readPendingProductMerge(branchId: string, actorId: string | null) {
  if (RELEASE_CHANNEL !== "beta" || !actorId) return null;
  const scope = mergeScope(branchId, actorId);
  if (!scope) return null;
  const epoch = sessionEpoch();
  const saved = await getDeviceSecret<unknown>(await attemptKey(scope.key), true);
  if (saved === null || sessionEpoch() !== epoch || mergeScope(branchId, actorId)?.key !== scope.key) return null;
  const request = stockHistoryProductMergeRequestSchema.parse(saved);
  if (request.branchId !== branchId) throw unverified();
  return request;
}

export async function tryPilotProductMerge(input: {
  branchId: string;
  actorId: string | null;
  masterId: string;
  duplicateIds: string[];
  products: Product[];
  resumeOperationId?: string;
  isCurrent: () => boolean;
}) {
  if (RELEASE_CHANNEL !== "beta") return null;
  const { branchId, actorId, masterId } = input;
  const bridge = localConfigurationBridge();
  const scope = mergeScope(branchId, actorId);
  if (!scope) {
    if (bridge?.productMergeCapability) {
      const native = stockHistoryProductMergeCapabilitySchema.safeParse(await bridge.productMergeCapability({ branchId }));
      if (!native.success || native.data.enabled) throw unverified();
    }
    return null;
  }
  const epoch = sessionEpoch();
  const assertCurrent = () => {
    if (!input.isCurrent() || sessionEpoch() !== epoch || mergeScope(branchId, actorId)?.key !== scope.key ||
        localConfigurationBridge() !== bridge) throw unverified();
  };
  const key = await attemptKey(scope.key);
  assertCurrent();
  if (pending.has(key)) throw unverified();
  pending.add(key);
  try {
    const stored = await getDeviceSecret<unknown>(key, true);
    assertCurrent();
    const previous = stored === null ? null : stockHistoryProductMergeRequestSchema.parse(stored);
    if (input.resumeOperationId && previous?.operationId !== input.resumeOperationId) throw unverified();
    if (bridge && !bridge.productMergeCapability) {
      if (previous) throw unverified();
      return null;
    }
    if (!previous) {
      const capability = bridge?.productMergeCapability
        ? await bridge.productMergeCapability({ branchId })
        : await relayProductMerge({ version: 1, action: "capability", branchId, terminalId: scope.terminalId });
      assertCurrent();
      const checked = stockHistoryProductMergeCapabilitySchema.safeParse(capability);
      if (!checked.success) throw unverified();
      if (!checked.data.enabled) return null;
    }
    if (!actorId) throw unverified();
    const ids = [...new Set([masterId, ...input.duplicateIds])].sort();
    if (previous && (previous.branchId !== branchId || previous.masterId !== masterId ||
      previous.roster.map(product => product.id).sort().join(",") !== ids.join(",")))
      throw new Error("A product merge is still waiting for confirmation. Use Check saved merge in Inventory.");
    const parsed = stockHistoryProductMergeRequestSchema.safeParse(previous ?? {
      version: 1, branchId, operationId: crypto.randomUUID(), masterId,
      roster: ids.map(id => ({ id, ...input.products.find(product => product.id === id)?.mergeRevision })),
    });
    if (!parsed.success) throw new Error("The selected product revisions could not be verified. Refresh Inventory and select them again.");
    const request = parsed.data;
    if (!previous) await setDeviceSecret(key, request);
    assertCurrent();
    if (bridge && !bridge.mergeProducts) throw unverified();
    let raw: unknown;
    try {
      if (bridge?.mergeProducts) {
        raw = await bridge.mergeProducts(request);
      } else {
        const command = { ...request, terminalId: scope.terminalId };
        if (previous) {
          const status = stockHistoryProductMergeReceiptStatusSchema.parse(await relayProductMerge({ ...command, action: "receipt" }));
          assertCurrent();
          raw = status.receipt;
        }
        if (!raw) raw = await relayProductMerge({ ...command, action: "merge" });
      }
    } catch { throw unverified(); }
    assertCurrent();
    const failure = replyFailure(raw);
    if (failure) throw Object.assign(new Error(failure.error || unverified().message), { code: failure.code });
    let result;
    try { result = validateProductMergeReceipt(raw, request, !!bridge); }
    catch { throw unverified(); }
    clearDeviceSecret(key);
    return result;
  } finally {
    pending.delete(key);
  }
}
