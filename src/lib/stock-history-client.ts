import {localDb} from '@/core/local-db/local-db';
import {effectiveDatabaseMode} from '@/core/local-db/db-mode';
import {getPosCallerAuth} from './pos-caller-auth';
import {hostedFunction} from './hosted-function-client';
import {loadStockHistoryPageDirect} from './stock-history.functions';
import {checkedStockHistoryPage,stockHistoryRequestSchema} from './stock-history-validation';
import {sessionEpoch} from './session-epoch';
import {isManagementDevice} from './management-device';
import type {StockHistoryPage,StockHistoryRequest} from './stock-history-report';
const hosted=hostedFunction('stock-history.page',loadStockHistoryPageDirect);
export async function loadStockHistoryPage(input:StockHistoryRequest):Promise<StockHistoryPage>{
 const request=stockHistoryRequestSchema.parse(input),epoch=sessionEpoch();
 const current=()=>{if(sessionEpoch()!==epoch)throw Object.assign(new Error('The signed-in account changed. Open the report again.'),{code:'SESSION_CHANGED'});};
 if(effectiveDatabaseMode()==='local'&&!isManagementDevice()){
  const bridge=localDb();
  if(!bridge?.stockHistory)throw new Error('This desktop version does not include the stock-history reader. Update the app before opening this report.');
  const result=await bridge.stockHistory(request);current();
  if(!result.ok)throw Object.assign(new Error(result.error||'Historical stock could not be read from local SQL Server.'),{code:result.code});
  return checkedStockHistoryPage(result.page,request.branchId);
 }
 const proof=await getPosCallerAuth();current();
 const page=await hosted({data:{...proof,request}});current();return checkedStockHistoryPage(page,request.branchId);
}
