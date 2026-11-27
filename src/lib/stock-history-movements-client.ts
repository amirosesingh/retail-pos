import { getPosCallerAuth } from "./pos-caller-auth";
import { hostedFunction } from "./hosted-function-client";
import { stockHistoryDesktopReader, usesLocalStockHistory } from "./stock-report-desktop-reader";
import { sessionEpoch } from "./session-epoch";
import { loadStockHistoryMovementsDirect } from "./stock-history.functions";
import {
  checkedStockHistoryMovementPage, stockHistoryMovementRequestSchema,
  type StockHistoryMovementPage, type StockHistoryMovementRequest,
} from "./stock-history-movements";

const hosted = hostedFunction("stock-history.movements", loadStockHistoryMovementsDirect);
export async function loadStockHistoryMovements(input: StockHistoryMovementRequest): Promise<StockHistoryMovementPage> {
  const request = stockHistoryMovementRequestSchema.parse(input);
  const epoch = sessionEpoch(), native = usesLocalStockHistory();
  const assertCurrent = () => {
    if (sessionEpoch() !== epoch || usesLocalStockHistory() !== native) {
      throw Object.assign(new Error("The signed-in account or database changed. Open the stock report again."), { code: "ESTOCK_HISTORY_CONTEXT_CHANGED" });
    }
  };
  if (native) {
    const bridge = stockHistoryDesktopReader();
    if (!bridge?.stockHistoryMovements) throw new Error("This desktop version cannot read stock movement details. Update the app before opening them.");
    const result = await bridge.stockHistoryMovements(request);
    assertCurrent();
    if (!result.ok) {
      throw Object.assign(new Error(result.error || "Historical movements could not be read from local SQL Server."), { code: result.code });
    }
    return checkedStockHistoryMovementPage(result.page, request);
  }
  const proof = await getPosCallerAuth();
  assertCurrent();
  const result = await hosted({ data: { ...proof, request } });
  assertCurrent();
  return checkedStockHistoryMovementPage(result, request);
}
