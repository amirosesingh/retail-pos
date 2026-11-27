import { z } from "zod";
import type { CallerProof } from "./privileged-caller.server";
import {
  checkedStockActivityBalances,
  stockActivityBalancesRequestSchema,
  type StockActivityBalances,
  type StockActivityBalancesRequest,
} from "./stock-activity-balances";
import { stockActivityRowSchema } from "./stock-activity-query";
import { hostedActivityInstant, readBoundedActivity, readStockActivityRecords } from "./stock-activity.server";
import { authorizeStockHistoryRead } from "./stock-history.server";

const rpc = "pos_stock_activity_balances_v1";
const providerProducts = z.array(z.object({
  product_id: stockActivityRowSchema.shape.productId,
  through_activity: z.array(z.unknown()).max(3),
  through_adjustments: z.array(z.unknown()).max(3),
  after_activity: z.array(z.unknown()).max(2),
  after_adjustments: z.array(z.unknown()).max(2),
}).strict()).max(50);

export async function readStockActivityBalances(
  proof: CallerProof, value: StockActivityBalancesRequest,
): Promise<StockActivityBalances | { available: false }> {
  const request = stockActivityBalancesRequestSchema.parse(value);
  const { scope, branchId } = await authorizeStockHistoryRead(proof, request);
  const { serviceRest } = await import("@/core/api/pos-relay.server");
  const response = await serviceRest(`rpc/${rpc}`, {
    method: "POST",
    redirect: "error",
    body: JSON.stringify({
      p_branch: scope.storeId ?? branchId,
      p_cutoff: hostedActivityInstant(request.cutoff),
      p_product_ids: request.productIds,
    }),
  });
  if (!response.ok) {
    const error = await readBoundedActivity(response, 8192).catch(() => null) as { code?: string; message?: string } | null;
    if (response.status === 404 && error?.code === "PGRST202" && typeof error.message === "string" && error.message.includes(rpc)) {
      return { available: false };
    }
    if (response.status === 401 || response.status === 403 || error?.code === "42501") {
      throw new Error("The company database refused access to item activity.");
    }
    throw new Error("The company database could not read item activity. Try again shortly.");
  }
  const products = providerProducts.parse(await readBoundedActivity(response, 2 * 1024 * 1024)).map(row => {
    const query = { branchId: request.branchId, cutoff: request.cutoff, productId: row.product_id };
    return {
      productId: row.product_id,
      through: readStockActivityRecords(
        row.through_activity, row.through_adjustments, 3, { ...query, side: "through-cutoff" }, { contiguousThroughCutoff: true },
      ),
      after: readStockActivityRecords(row.after_activity, row.after_adjustments, 2, { ...query, side: "after-cutoff" }),
    };
  });
  return checkedStockActivityBalances({ branchId: request.branchId, cutoff: request.cutoff, products }, request);
}
