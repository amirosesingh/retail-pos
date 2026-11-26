import { getPosCallerAuth } from "./pos-caller-auth";
import { hostedFunction } from "./hosted-function-client";
import { stockHistoryDesktopReader, usesLocalStockHistory } from "./stock-report-desktop-reader";
import { sessionEpoch } from "./session-epoch";
import { loadStockActivityPageDirect } from "./stock-history.functions";
import { checkedStockActivityPage, stockActivityRequestSchema, type StockActivityRequest } from "./stock-activity-query";

const hosted = hostedFunction("stock-history.activity", loadStockActivityPageDirect);
export async function loadStockActivityPage(value: StockActivityRequest) {
  const request = stockActivityRequestSchema.parse(value);
  const epoch = sessionEpoch(), native = usesLocalStockHistory();
  const assertCurrent = () => {
    if (sessionEpoch() !== epoch || usesLocalStockHistory() !== native) {
      throw Object.assign(new Error("The signed-in account or database changed. Open the stock report again."), { code: "ESTOCK_HISTORY_CONTEXT_CHANGED" });
    }
  };
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
