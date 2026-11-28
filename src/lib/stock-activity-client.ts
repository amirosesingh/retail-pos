import { getPosCallerAuth } from "./pos-caller-auth";
import { hostedFunction } from "./hosted-function-client";
import { stockHistoryDesktopReader, usesLocalStockHistory } from "./stock-report-desktop-reader";
import { sessionEpoch } from "./session-epoch";
import { loadStockActivityBalancesDirect, loadStockActivityPageDirect } from "./stock-history.functions";
import { checkedStockActivityPage, stockActivityRequestSchema, type StockActivityRequest } from "./stock-activity-query";
import { checkedStockActivityBalances, stockActivityBalancesRequestSchema, type StockActivityBalancesRequest } from "./stock-activity-balances";

const hosted = hostedFunction("stock-history.activity", loadStockActivityPageDirect);
const hostedBalances = hostedFunction("stock-history.activity-balances", loadStockActivityBalancesDirect);

function activityContext() {
  const epoch = sessionEpoch(), native = usesLocalStockHistory();
  return { native, assertCurrent() {
    if (sessionEpoch() !== epoch || usesLocalStockHistory() !== native) {
      throw Object.assign(new Error("The signed-in account or database changed. Open the stock report again."), { code: "ESTOCK_HISTORY_CONTEXT_CHANGED" });
    }
  } };
}

export async function loadStockActivityPage(value: StockActivityRequest) {
  const request = stockActivityRequestSchema.parse(value);
  const { native, assertCurrent } = activityContext();
  if (native) {
    const bridge = stockHistoryDesktopReader();
    if (!bridge?.stockActivity) throw new Error("This desktop version cannot read item activity in Stock Report. Update the app before opening it.");
    const result = await bridge.stockActivity(request);
    assertCurrent();
    if (!result.ok) throw Object.assign(new Error(result.error || "Item activity could not be read from local SQL Server."), { code: result.code });
    return checkedStockActivityPage(result.page, request);
  }
  const proof = await getPosCallerAuth();
  assertCurrent();
  const result = await hosted({ data: { ...proof, request } });
  assertCurrent();
  return checkedStockActivityPage(result, request);
}

export async function loadStockActivityBalances(value: StockActivityBalancesRequest) {
  const request = stockActivityBalancesRequestSchema.parse(value);
  const { native, assertCurrent } = activityContext();
  if (native) {
    const bridge = stockHistoryDesktopReader();
    if (!bridge?.stockActivityBalances) return null;
    const result = await bridge.stockActivityBalances(request);
    assertCurrent();
    if (!result.ok) throw Object.assign(new Error(result.error || "Stock balance evidence could not be read from local SQL Server."), { code: result.code });
    return checkedStockActivityBalances(result.page, request);
  }
  const proof = await getPosCallerAuth();
  assertCurrent();
  const result = await hostedBalances({ data: { ...proof, request } });
  assertCurrent();
  return result && "available" in result && result.available === false ? null : checkedStockActivityBalances(result, request);
}
